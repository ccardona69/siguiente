// Worker de "Siguiente": sirve los estáticos de public/ y una única ruta /api/state
// que guarda y devuelve el estado completo como un blob JSON en KV. Sin dependencias.

const STATE_KEY = 'state';
const CORRUPT_KEY = 'state.corrupt'; // respaldo de clave fija: sobrescribirlo es idempotente y no acumula basura
const MAX_BYTES = 1024 * 1024; // 1 MB en bytes UTF-8 reales: el estado de un solo usuario nunca se acerca
const BACKUP_PREFIX = 'backup.'; // una copia por día UTC: backup.AAAA-MM-DD
const BACKUP_TTL = 30 * 24 * 60 * 60; // segundos; KV la borra sola a los 30 días

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // todo lo que no sea la API se sirve como archivo estático
    if (url.pathname !== '/api/state') {
      return env.ASSETS.fetch(request);
    }

    // la sincronización necesita el almacén KV configurado
    if (!env.SIGUIENTE_KV) {
      return fail('sincronización no configurada', 503);
    }

    // token compartido opcional: si SYNC_TOKEN está definido, se exige
    if (!authorized(request, env)) {
      return fail('no autorizado', 401);
    }

    if (request.method === 'GET') {
      return readState(env);
    }

    if (request.method === 'PUT') {
      return writeState(request, env);
    }

    return fail('método no permitido', 405, { Allow: 'GET, PUT' });
  }
};

// devuelve el estado guardado; si el blob no se puede leer, lo aparta y se declara vacío
// es la única lectura del Worker que escribe en KV: mueve los bytes ilegibles a CORRUPT_KEY
// (clave fija, así un segundo GET sobrescribe lo mismo) para que el cliente suba su copia local
// y la app se recupere sola en el siguiente guardado, sin dejar al usuario atrapado
async function readState(env) {
  let stored;
  try {
    stored = await env.SIGUIENTE_KV.get(STATE_KEY);
  } catch (e) {
    return fail('almacén no disponible', 503);
  }
  if (!stored) {
    log('state_read', { found: false });
    return json({ state: null }, 200, { ETag: '"empty"' });
  }
  try {
    const state = JSON.parse(stored);
    log('state_read', { found: true });
    return json({ state }, 200, etagOf(state));
  } catch (e) {
    // si el respaldo falla se responde igual: recuperar la app importa más que conservar el blob ilegible
    try {
      await env.SIGUIENTE_KV.put(CORRUPT_KEY, stored);
    } catch (e2) {}
    log('state_read', { found: true, corrupt: true });
    return json({ state: null }, 200, { ETag: '"empty"' });
  }
}

// cabecera ETag de un estado: la revisión entre comillas si es un número finito
function etagOf(state) {
  return state && typeof state === 'object' && Number.isFinite(state.revision)
    ? { ETag: '"' + state.revision + '"' }
    : {};
}

// etiqueta del estado vigente para comparar con If-Match: "empty" si no hay blob legible,
// si no, su revisión numérica (NaN si el blob no la trae: entonces ningún If-Match casa)
function currentTag(stored) {
  let state = null;
  if (stored) {
    try {
      state = JSON.parse(stored);
    } catch (e) {
      state = null;
    }
  }
  if (!state || typeof state !== 'object') return { empty: true, revision: NaN, state: null };
  return { empty: false, revision: state.revision, state };
}

// If-Match solo admite "empty" o la revisión entre comillas tal como sale del ETag:
// un número JSON canónico, incluida la notación con exponente que usa String() en grandes
function parseIfMatch(raw) {
  const m = /^"([^"]*)"$/.exec(raw);
  if (!m) return { ok: false, error: 'If-Match no válido' };
  if (m[1] === 'empty') return { ok: true, empty: true };
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(m[1]) && Number.isFinite(Number(m[1]))) {
    return { ok: true, revision: Number(m[1]) };
  }
  return { ok: false, error: 'If-Match no válido' };
}

// valida y guarda el estado recibido; nunca lanza: un fallo de KV se responde como 503 con JSON
async function writeState(request, env) {
  // el tamaño declarado se mira antes de leer el cuerpo para no cargar en memoria algo que se va a rechazar
  const declared = Number(request.headers.get('Content-Length'));
  if (declared > MAX_BYTES) return fail('estado demasiado grande', 413);
  const body = await request.text();
  // el límite se mide en bytes UTF-8, no en las unidades UTF-16 que cuenta String.length
  const bytes = byteLength(body);
  if (bytes > MAX_BYTES) return fail('estado demasiado grande', 413);
  const parsed = parseState(body);
  if (!parsed.ok) return fail(parsed.error, 400);

  // precondición opcional de revisión: con If-Match se compara el estado vigente antes de
  // escribir; KV no ofrece comparar-y-escribir atómico, así que es un chequeo de mejor
  // esfuerzo y un conflicto siempre puede resolverse reintentando
  const ifMatch = request.headers.get('If-Match');
  if (ifMatch !== null) {
    const expected = parseIfMatch(ifMatch);
    if (!expected.ok) return fail(expected.error, 400);
    let stored;
    try {
      stored = await env.SIGUIENTE_KV.get(STATE_KEY);
    } catch (e) {
      return fail('almacén no disponible', 503);
    }
    const current = currentTag(stored);
    const matches = expected.empty ? current.empty : current.revision === expected.revision;
    if (!matches) {
      log('conflict', { status: 409, expected: ifMatch, current: current.empty ? 'empty' : current.revision });
      return json({ error: 'conflicto de revisión', state: current.state }, 409,
        current.empty ? { ETag: '"empty"' } : etagOf(current.state));
    }
  }

  await backupBeforeWrite(env);
  try {
    await env.SIGUIENTE_KV.put(STATE_KEY, JSON.stringify(parsed.value));
  } catch (e) {
    return fail('almacén no disponible', 503);
  }
  log('state_written', { bytes, revision: parsed.value.revision });
  return json({ ok: true }, 200, etagOf(parsed.value));
}

// antes del primer guardado de cada día conserva el estado que había: así un "Borrar todo" o un error
// sincronizado se puede recuperar de la víspera; los bytes se copian tal cual, sin interpretarlos
// nunca bloquea el guardado: si algo falla se registra y el estado nuevo se guarda igual
async function backupBeforeWrite(env) {
  try {
    const previous = await env.SIGUIENTE_KV.get(STATE_KEY);
    if (!previous) return;
    const key = BACKUP_PREFIX + new Date(Date.now()).toISOString().slice(0, 10);
    if (await env.SIGUIENTE_KV.get(key)) return;
    await env.SIGUIENTE_KV.put(key, previous, { expirationTtl: BACKUP_TTL });
    log('backup_written', { key, bytes: byteLength(previous) });
  } catch (e) {
    log('backup_failed');
  }
}

// registro de una línea JSON por petición: solo resultado y tamaños, nunca el token ni el contenido
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
      { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      extra
    )
  });
}

// tamaño real del cuerpo en bytes UTF-8, que es lo que viaja y lo que se cuenta aquí
function byteLength(text) {
  return new TextEncoder().encode(text).byteLength;
}

// valida el token compartido solo si el Worker tiene SYNC_TOKEN
// solo por cabecera Authorization: nunca se lee de la URL, que acabaría en los logs
function authorized(request, env) {
  const expected = env.SYNC_TOKEN;
  if (!expected) return true;
  const header = request.headers.get('Authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  return timingSafeEqual(bearer, expected);
}

// compara dos cadenas sin salida temprana, para no filtrar el token por diferencias de tiempo de
// respuesta; en JavaScript es una mitigación y no una garantía, porque el motor puede introducirlas
function timingSafeEqual(a, b) {
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// el cuerpo debe ser un objeto JSON con schemaVersion numérico: la versión concreta la decide el
// cliente y el Worker ni la conoce ni la juzga, porque solo es un almacén de blobs
function parseState(body) {
  let value;
  try {
    value = JSON.parse(body);
  } catch (e) {
    return { ok: false, error: 'el cuerpo no es JSON válido' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'el estado no tiene la forma esperada' };
  }
  if (!isSchemaVersion(value.schemaVersion)) {
    return { ok: false, error: 'schemaVersion debe ser un número' };
  }
  return { ok: true, value };
}

// versión de esquema presente, numérica y finita; cualquier número sirve, incluidos los futuros
function isSchemaVersion(value) {
  return typeof value === 'number' && Number.isFinite(value);
}
