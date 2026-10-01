// Siguiente · servidor del Worker: estáticos de public/ y la API /api/state
// respaldada por un Durable Object con SQLite. La revisión la asigna el servidor,
// todo PUT exige If-Match y el estado entrante se valida con SiguienteCore,
// así la nube nunca guarda datos rotos. Espera globalThis.SiguienteCore cargado:
// build.py concatena src/core.js delante para generar worker.dist.js.

const MAX_BYTES = 32 * 1024 * 1024; // techo tras descomprimir: core.js admite hasta 50 000 sesiones
const MAX_ATTEMPTS = 8; // intentos de token fallidos tolerados por ventana
const ATTEMPT_WINDOW_MS = 60 * 1000;

// entrada del Worker: sirve estáticos y deriva /api/state al objeto durable único
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/state') {
      return env.ASSETS.fetch(request);
    }
    // sin almacén o sin token configurado la API queda cerrada: nunca abierta por descuido
    if (!env.STATE_STORE || !env.SYNC_TOKEN) {
      return fail('sincronización no configurada', 503);
    }
    const stub = env.STATE_STORE.get(env.STATE_STORE.idFromName('estado'));
    return stub.fetch(request);
  },
};

// objeto durable con SQLite: comprobar la versión y escribir ocurre en un solo paso
// y las lecturas siempre ven lo último, sin la ventana de propagación de KV
export class StateStore {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.failed = []; // marcas de los intentos de token fallidos recientes
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS backups (day TEXT PRIMARY KEY, body TEXT NOT NULL, revision INTEGER NOT NULL)',
    );
  }

  async fetch(request) {
    return handleApi(request, sqlStore(this.ctx.storage.sql), this.env, this);
  }
}

// adaptador sobre el SQLite del objeto durable; las pruebas usan memoryStore con el mismo contrato
function sqlStore(sql) {
  return {
    read() {
      const body = sql.exec("SELECT v FROM meta WHERE k = 'state'").toArray();
      const rev = sql.exec("SELECT v FROM meta WHERE k = 'revision'").toArray();
      return { body: body.length ? body[0].v : null, revision: rev.length ? Number(rev[0].v) : 0 };
    },
    write(body, revision) {
      sql.exec('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', 'state', body);
      sql.exec('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', 'revision', String(revision));
    },
    backup(day, body, revision) {
      sql.exec('INSERT OR IGNORE INTO backups (day, body, revision) VALUES (?, ?, ?)', day, body, revision);
    },
    pruneBackups(cutoffDay) {
      sql.exec('DELETE FROM backups WHERE day < ?', cutoffDay);
    },
    // dentro del objeto durable cada fetch corre en un hilo único, así que leer la
    // revisión y escribir ya es atómico; transactionSync lo deja explícito
    atomic(fn) {
      return sql.database ? sql.database.transactionSync(fn) : fn();
    },
  };
}

// almacén en memoria con el mismo contrato que sqlStore: sirve a las pruebas en Node
export function memoryStore(initial = {}) {
  const meta = Object.assign({ state: null, revision: 0 }, initial);
  const backups = new Map();
  return {
    meta,
    backups,
    read() {
      return { body: meta.state, revision: meta.revision };
    },
    write(body, revision) {
      meta.state = body;
      meta.revision = revision;
    },
    backup(day, body, revision) {
      if (!backups.has(day)) backups.set(day, { body, revision });
    },
    pruneBackups(cutoffDay) {
      for (const day of backups.keys()) {
        if (day < cutoffDay) backups.delete(day);
      }
    },
    atomic(fn) {
      return fn();
    },
  };
}

// lógica de la API, independiente del almacén: la prueba el objeto durable y los tests
export async function handleApi(request, store, env, holder = { failed: [] }) {
  if (!authorized(request, env)) {
    if (throttled(holder)) return fail('demasiados intentos', 429, { 'Retry-After': '60' });
    holder.failed.push(Date.now());
    return fail('no autorizado', 401);
  }
  if (request.method === 'GET') return readState(request, store, env);
  if (request.method === 'PUT') return writeState(request, store, env);
  return fail('método no permitido', 405, { Allow: 'GET, PUT' });
}

// true cuando la ventana reciente ya juntó demasiados intentos fallidos
function throttled(holder) {
  const cutoff = Date.now() - ATTEMPT_WINDOW_MS;
  holder.failed = holder.failed.filter((t) => t >= cutoff);
  return holder.failed.length >= MAX_ATTEMPTS;
}

// devuelve el estado guardado con su ETag de servidor; con If-None-Match igual responde 304
async function readState(request, store, env) {
  // primera lectura con el almacén vacío: adopta lo que hubiera en KV como revision 1
  if (store.read().body === null && env.SIGUIENTE_KV) {
    await adoptLegacy(store, env);
  }
  const { body, revision } = store.read();
  const etag = body === null ? '"empty"' : '"' + revision + '"';
  if (request.headers.get('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'no-store' } });
  }
  if (body === null) {
    log('state_read', { found: false });
    return json({ state: null }, 200, { ETag: etag });
  }
  try {
    const state = JSON.parse(body);
    log('state_read', { found: true, revision });
    return json({ state }, 200, { ETag: etag });
  } catch (e) {
    log('state_read', { found: true, corrupt: true });
    return json({ state: null }, 200, { ETag: '"empty"' });
  }
}

// trae el blob viejo de KV una sola vez si encaja con el esquema: lo valida igual que
// un PUT y lo guarda como revision 1; KV queda intacto como respaldo
async function adoptLegacy(store, env) {
  try {
    const legacy = await env.SIGUIENTE_KV.get('state');
    if (!legacy) return;
    const parsed = parseState(legacy);
    if (!parsed.ok) return;
    // un PUT pudo ganar durante la espera a KV: solo se adopta si sigue vacío
    const current = store.read();
    if (current.body !== null) return;
    const revision = current.revision + 1;
    store.write(JSON.stringify(parsed.value), revision);
    log('legacy_adopted', { revision });
  } catch (e) {}
}

// valida y guarda el estado recibido: exige If-Match con la revisión que el cliente
// conoce, la nueva revisión la asigna siempre el servidor
async function writeState(request, store, env) {
  const declared = Number(request.headers.get('Content-Length'));
  if (declared > MAX_BYTES) return fail('estado demasiado grande', 413);
  const body = await readBody(request);
  if (body.tooBig || (body.text !== undefined && byteLength(body.text) > MAX_BYTES)) {
    return fail('estado demasiado grande', 413);
  }
  if (body.text === undefined) return fail('el cuerpo no se pudo leer', 400);
  const parsed = parseState(body.text);
  if (!parsed.ok) return fail(parsed.error, 400);

  const ifMatch = request.headers.get('If-Match');
  if (ifMatch === null) return fail('falta la cabecera If-Match', 428);
  const expected = parseIfMatch(ifMatch);
  if (!expected.ok) return fail(expected.error, 400);

  // con el almacén vacío se adopta primero lo que hubiera en KV, también cuando
  // el primer acceso es un PUT: el cliente lo recibe como 409 y fusiona
  if (store.read().body === null && env.SIGUIENTE_KV) {
    await adoptLegacy(store, env);
  }

  // un cuerpo guardado que ya no se puede leer cuenta como vacío: con If-Match
  // "empty" la copia local se recupera en vez de chocar siempre con el 409
  const current = store.read();
  let currentState = null;
  if (current.body !== null) {
    try {
      currentState = JSON.parse(current.body);
    } catch (e) {
      currentState = undefined;
    }
  }
  const effectivelyEmpty = current.body === null || currentState === undefined;
  const matches = expected.empty
    ? effectivelyEmpty
    : !effectivelyEmpty && current.revision === expected.revision;
  if (!matches) {
    const etag = effectivelyEmpty ? '"empty"' : '"' + current.revision + '"';
    log('conflict', { status: 409, expected: ifMatch, current: effectivelyEmpty ? 'empty' : current.revision });
    return json({ error: 'conflicto de revisión', state: effectivelyEmpty ? null : currentState }, 409, {
      ETag: etag,
    });
  }

  const revision = current.revision + 1;
  const text = JSON.stringify(parsed.value);
  store.atomic(() => {
    backupBeforeWrite(store, current);
    store.write(text, revision);
  });
  log('state_written', { bytes: byteLength(text), revision });
  return json({ ok: true, revision }, 200, { ETag: '"' + revision + '"' });
}

// antes del primer guardado de cada día conserva el estado vigente en la tabla de
// copias: un "borrar todo" o un error sincronizado se puede recuperar de la víspera
function backupBeforeWrite(store, current) {
  if (current.body === null) return;
  try {
    const today = new Date(Date.now());
    store.backup(today.toISOString().slice(0, 10), current.body, current.revision);
    // mismo criterio que el TTL anterior de KV: solo se conservan 30 días
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    store.pruneBackups(cutoff);
    log('backup_written', { revision: current.revision });
  } catch (e) {
    log('backup_failed');
  }
}

// cuerpo de la petición como texto; acepta gzip cuando viene declarado y lo
// descomprime por partes cortando en MAX_BYTES: un archivo muy comprimido no
// puede inflar la memoria del objeto durable
async function readBody(request) {
  try {
    if ((request.headers.get('Content-Encoding') || '').toLowerCase() === 'gzip') {
      const reader = request.body.pipeThrough(new DecompressionStream('gzip')).getReader();
      const chunks = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) {
          await reader.cancel();
          return { tooBig: true };
        }
        chunks.push(value);
      }
      return { text: await new Response(new Blob(chunks)).text() };
    }
    return { text: await request.text() };
  } catch (e) {
    return {};
  }
}

// el estado entrante debe pasar la misma validación del cliente: migra lo que toque
// y verifica con SiguienteCore; la nube nunca guarda datos rotos
function parseState(body) {
  let value;
  try {
    value = JSON.parse(body);
  } catch (e) {
    return { ok: false, error: 'el cuerpo no es JSON válido' };
  }
  const migrated = globalThis.SiguienteCore.migrate(value);
  const checked = globalThis.SiguienteCore.validateState(migrated);
  return checked.ok ? { ok: true, value: migrated } : { ok: false, error: checked.error };
}

// cabecera If-Match: "empty" o la revisión numérica entre comillas que sirve el ETag
function parseIfMatch(raw) {
  const m = /^"([^"]*)"$/.exec(raw);
  if (!m) return { ok: false, error: 'If-Match no válido' };
  if (m[1] === 'empty') return { ok: true, empty: true };
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(m[1]) && Number.isFinite(Number(m[1]))) {
    return { ok: true, revision: Number(m[1]) };
  }
  return { ok: false, error: 'If-Match no válido' };
}

// token compartido obligatorio en Authorization; nunca se lee de la URL
function authorized(request, env) {
  const header = request.headers.get('Authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  return timingSafeEqual(bearer, env.SYNC_TOKEN);
}

// compara dos cadenas sin salida temprana para no filtrar el token por tiempos;
// mitigación en JavaScript, no garantía, porque el motor puede introducirlas
function timingSafeEqual(a, b) {
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// registro de una línea JSON por petición: solo resultado y tamaños, nunca token ni contenido
function log(event, fields = {}) {
  console.log(JSON.stringify(Object.assign({ event }, fields)));
}

// respuesta de error con su registro
function fail(error, status, extra = {}) {
  log('rejected', { status, reason: error });
  return json({ error }, status, extra);
}

// respuesta JSON sin caché
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign(
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
      extra,
    ),
  });
}

// tamaño real del cuerpo en bytes UTF-8, que es lo que viaja y lo que se cuenta aquí
function byteLength(text) {
  return new TextEncoder().encode(text).byteLength;
}
