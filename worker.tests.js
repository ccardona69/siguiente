/* worker.tests.js — pruebas del Worker de "Siguiente" con un KV simulado.
   Se ejecuta con "node worker.tests.js" y termina con código 1 si algo falla.
   Sin dependencias: Request, Response y Headers vienen de Node. */
'use strict';

const registry = [];

// registra una prueba asíncrona
function test(name, fn) {
  registry.push({ name, fn });
}

// aserción simple
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'condición falsa');
}

// igualdad estricta con mensaje
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error((msg || 'no coinciden') + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b));
}

// KV simulado con el mismo contrato asíncrono que Workers KV; permite forzar fallos
function makeKv() {
  const kv = {
    store: new Map(),
    options: new Map(),
    failGet: false,
    failPut: false,
    failPutPrefix: null,
    async get(key) {
      if (kv.failGet) throw new Error('KV get caído');
      return kv.store.has(key) ? kv.store.get(key) : null;
    },
    async put(key, value, options) {
      if (kv.failPut || (kv.failPutPrefix && key.startsWith(kv.failPutPrefix))) throw new Error('KV put caído');
      kv.store.set(key, value);
      kv.options.set(key, options);
    }
  };
  return kv;
}

// entorno del Worker: KV, estáticos simulados y token opcional
function makeEnv(options = {}) {
  const env = {
    ASSETS: { fetch: async (req) => new Response('asset:' + new URL(req.url).pathname) }
  };
  if (options.kv !== false) env.SIGUIENTE_KV = options.kv || makeKv();
  if (options.token) env.SYNC_TOKEN = options.token;
  return env;
}

// estado mínimo válido para el Worker
function validState(extra = {}) {
  return Object.assign({ schemaVersion: 1, revision: 3, savedAt: null, tasks: [], plans: [], planItems: [], sessions: [] }, extra);
}

// llama al Worker con una petición real a /api/state
async function call(worker, env, method, body, headers = {}, path = '/api/state') {
  const init = { method, headers };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return worker.fetch(new Request('https://siguiente.test' + path, init), env);
}

// ejecuta fn con el reloj del Worker fijado en una fecha ISO
async function atTime(iso, fn) {
  const real = Date.now;
  Date.now = () => new Date(iso).getTime();
  try {
    await fn();
  } finally {
    Date.now = real;
  }
}

// ejecuta fn con console.log capturado y devuelve las líneas emitidas
async function captureLogs(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.map(String).join(' '));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines;
}

async function main() {
  const worker = (await import('./worker.js')).default;

  // --- rutas y estáticos ---

  test('una ruta que no es /api/state se sirve como estático', async () => {
    const res = await call(worker, makeEnv(), 'GET', undefined, {}, '/index.html');
    assertEqual(await res.text(), 'asset:/index.html');
  });

  test('sin KV configurado la API responde 503 con JSON', async () => {
    const res = await call(worker, makeEnv({ kv: false }), 'GET');
    assertEqual(res.status, 503);
    assert(typeof (await res.json()).error === 'string', 'error descriptivo');
  });

  test('métodos distintos de GET y PUT dan 405 con Allow', async () => {
    for (const method of ['POST', 'DELETE', 'PATCH']) {
      const res = await call(worker, makeEnv(), method, method === 'DELETE' ? undefined : '{}');
      assertEqual(res.status, 405, method);
      assertEqual(res.headers.get('Allow'), 'GET, PUT', method);
    }
  });

  test('las respuestas JSON no se guardan en caché', async () => {
    const res = await call(worker, makeEnv(), 'GET');
    assertEqual(res.headers.get('Cache-Control'), 'no-store');
    assert(res.headers.get('Content-Type').startsWith('application/json'), 'tipo JSON');
  });

  // --- token ---

  test('con SYNC_TOKEN, sin cabecera o con token incorrecto da 401', async () => {
    const env = makeEnv({ token: 'frase-larga-secreta' });
    assertEqual((await call(worker, env, 'GET')).status, 401, 'sin cabecera');
    assertEqual((await call(worker, env, 'GET', undefined, { Authorization: 'Bearer otro' })).status, 401, 'incorrecto');
    assertEqual((await call(worker, env, 'GET', undefined, { Authorization: 'frase-larga-secreta' })).status, 401, 'sin Bearer');
  });

  test('con SYNC_TOKEN, el token correcto en Authorization da acceso', async () => {
    const env = makeEnv({ token: 'frase-larga-secreta' });
    const res = await call(worker, env, 'GET', undefined, { Authorization: 'Bearer frase-larga-secreta' });
    assertEqual(res.status, 200);
  });

  test('el token en la URL no da acceso', async () => {
    const env = makeEnv({ token: 'frase-larga-secreta' });
    const res = await call(worker, env, 'GET', undefined, {}, '/api/state?token=frase-larga-secreta');
    assertEqual(res.status, 401);
  });

  test('un PUT sin token válido no escribe nada', async () => {
    const kv = makeKv();
    const env = makeEnv({ kv, token: 'frase-larga-secreta' });
    const res = await call(worker, env, 'PUT', validState());
    assertEqual(res.status, 401);
    assertEqual(kv.store.size, 0, 'KV intacto');
  });

  // --- lectura y escritura ---

  test('GET con KV vacío devuelve state null', async () => {
    const body = await (await call(worker, makeEnv(), 'GET')).json();
    assertEqual(body.state, null);
  });

  test('PUT guarda el estado y GET lo devuelve idéntico', async () => {
    const env = makeEnv();
    const state = validState({ tasks: [{ id: 'a', title: 'Física II' }] });
    const put = await call(worker, env, 'PUT', state);
    assertEqual(put.status, 200);
    const got = await (await call(worker, env, 'GET')).json();
    assertEqual(JSON.stringify(got.state), JSON.stringify(state));
  });

  test('PUT acepta un schemaVersion futuro: el Worker no juzga versiones', async () => {
    const res = await call(worker, makeEnv(), 'PUT', validState({ schemaVersion: 99 }));
    assertEqual(res.status, 200);
  });

  test('PUT rechaza cuerpos que no son JSON, arrays o sin schemaVersion numérico', async () => {
    const bad = ['no es json', '[]', 'null', '"texto"', '{}', JSON.stringify({ schemaVersion: '1' }), JSON.stringify({ schemaVersion: null })];
    for (const body of bad) {
      const kv = makeKv();
      const res = await call(worker, makeEnv({ kv }), 'PUT', body);
      assertEqual(res.status, 400, body);
      assertEqual(kv.store.size, 0, 'nada guardado: ' + body);
    }
  });

  test('PUT mide el límite en bytes UTF-8, no en caracteres', async () => {
    // 600 000 caracteres de 2 bytes: 600 000 < 1 MB en caracteres, pero 1 200 000 bytes > 1 MB
    const heavy = JSON.stringify(validState({ note: 'ñ'.repeat(600000) }));
    assert(heavy.length < 1024 * 1024, 'cuenta como caracteres cabe');
    const kv = makeKv();
    const res = await call(worker, makeEnv({ kv }), 'PUT', heavy);
    assertEqual(res.status, 413);
    assertEqual(kv.store.size, 0, 'nada guardado');
  });

  // --- blob corrupto ---

  test('GET con un blob ilegible lo aparta en state.corrupt y devuelve state null', async () => {
    const kv = makeKv();
    kv.store.set('state', '{roto');
    const body = await (await call(worker, makeEnv({ kv }), 'GET')).json();
    assertEqual(body.state, null);
    assertEqual(kv.store.get('state.corrupt'), '{roto');
  });

  test('si falla el respaldo del blob ilegible, GET responde igual con state null', async () => {
    const kv = makeKv();
    kv.store.set('state', '{roto');
    kv.failPut = true;
    const res = await call(worker, makeEnv({ kv }), 'GET');
    assertEqual(res.status, 200);
    assertEqual((await res.json()).state, null);
  });

  // --- errores del almacén y límites tempranos ---

  test('si KV falla al leer, GET responde 503 con JSON en vez de lanzar', async () => {
    const kv = makeKv();
    kv.failGet = true;
    const res = await call(worker, makeEnv({ kv }), 'GET');
    assertEqual(res.status, 503);
    assert(typeof (await res.json()).error === 'string', 'error descriptivo');
  });

  test('si KV falla al escribir, PUT responde 503 con JSON en vez de lanzar', async () => {
    const kv = makeKv();
    kv.failPut = true;
    const res = await call(worker, makeEnv({ kv }), 'PUT', validState());
    assertEqual(res.status, 503);
    assert(typeof (await res.json()).error === 'string', 'error descriptivo');
  });

  test('un Content-Length mayor al límite se rechaza con 413 sin leer el cuerpo', async () => {
    let bodyRead = false;
    const request = {
      url: 'https://siguiente.test/api/state',
      method: 'PUT',
      headers: new Headers({ 'Content-Length': String(2 * 1024 * 1024) }),
      text: async () => { bodyRead = true; return '{}'; }
    };
    const res = await worker.fetch(request, makeEnv());
    assertEqual(res.status, 413);
    assertEqual(bodyRead, false, 'el cuerpo no se leyó');
  });

  // --- cabeceras de seguridad ---

  test('las respuestas de la API llevan X-Content-Type-Options: nosniff, también las de error', async () => {
    const ok = await call(worker, makeEnv(), 'GET');
    const bad = await call(worker, makeEnv(), 'PUT', 'no es json');
    assertEqual(ok.headers.get('X-Content-Type-Options'), 'nosniff');
    assertEqual(bad.headers.get('X-Content-Type-Options'), 'nosniff');
  });

  test('public/_headers protege los estáticos y su política permite lo que la app usa', async () => {
    const fs = require('node:fs');
    const text = fs.readFileSync(__dirname + '/public/_headers', 'utf8');
    const csp = (text.match(/Content-Security-Policy:\s*(.+)/) || [])[1] || '';
    assert(/^\/\*\s*$/m.test(text), 'aplica a todas las rutas');
    assert(/X-Content-Type-Options:\s*nosniff/.test(text), 'nosniff');
    assert(/Referrer-Policy:\s*no-referrer/.test(text), 'referrer');
    assert(csp.includes("default-src 'none'"), 'política cerrada por defecto');
    assert(csp.includes("frame-ancestors 'none'"), 'sin marcos');
    assert(csp.includes("connect-src 'self'"), 'la sincronización solo va al mismo origen');
    assert(csp.includes("base-uri 'none'") && csp.includes("form-action 'none'"), 'sin base ni formularios');
    // index.html lleva un <script> y un <style> en línea: sin unsafe-inline la app no arrancaría
    assert(/script-src[^;]*'self'[^;]*'unsafe-inline'/.test(csp), 'script propio y en línea');
    assert(/style-src[^;]*'self'[^;]*'unsafe-inline'/.test(csp), 'estilo propio y en línea');
    assert(!/https?:|\*/.test(csp), 'sin orígenes externos ni comodines');
  });

  // --- copias diarias ---

  test('el primer PUT del día guarda una copia del estado anterior que caduca a los 30 días', async () => {
    const kv = makeKv();
    const env = makeEnv({ kv });
    await atTime('2026-09-27T10:00:00Z', () => call(worker, env, 'PUT', validState({ revision: 1 })));
    await atTime('2026-09-28T08:00:00Z', () => call(worker, env, 'PUT', validState({ revision: 2 })));
    assertEqual(kv.store.get('backup.2026-09-28'), JSON.stringify(validState({ revision: 1 })), 'copia = estado previo');
    assertEqual(kv.options.get('backup.2026-09-28').expirationTtl, 30 * 24 * 60 * 60);
    assertEqual(JSON.parse(kv.store.get('state')).revision, 2, 'el estado nuevo sí se guardó');
  });

  test('un segundo PUT el mismo día no reemplaza la copia', async () => {
    const kv = makeKv();
    const env = makeEnv({ kv });
    await atTime('2026-09-27T10:00:00Z', () => call(worker, env, 'PUT', validState({ revision: 1 })));
    await atTime('2026-09-28T08:00:00Z', () => call(worker, env, 'PUT', validState({ revision: 2 })));
    await atTime('2026-09-28T20:00:00Z', () => call(worker, env, 'PUT', validState({ revision: 3 })));
    assertEqual(JSON.parse(kv.store.get('backup.2026-09-28')).revision, 1, 'sigue siendo la del inicio del día');
  });

  test('al cambiar de día se guarda otra copia con el estado de ese momento', async () => {
    const kv = makeKv();
    const env = makeEnv({ kv });
    await atTime('2026-09-28T10:00:00Z', () => call(worker, env, 'PUT', validState({ revision: 1 })));
    await atTime('2026-09-28T20:00:00Z', () => call(worker, env, 'PUT', validState({ revision: 2 })));
    await atTime('2026-09-29T08:00:00Z', () => call(worker, env, 'PUT', validState({ revision: 3 })));
    assertEqual(JSON.parse(kv.store.get('backup.2026-09-29')).revision, 2);
  });

  test('el primer PUT de todos no crea copia porque no hay estado anterior', async () => {
    const kv = makeKv();
    await atTime('2026-09-28T10:00:00Z', () => call(worker, makeEnv({ kv }), 'PUT', validState()));
    assertEqual([...kv.store.keys()].join(','), 'state');
  });

  test('si falla guardar la copia, el estado nuevo se guarda igual', async () => {
    const kv = makeKv();
    const env = makeEnv({ kv });
    await atTime('2026-09-27T10:00:00Z', () => call(worker, env, 'PUT', validState({ revision: 1 })));
    kv.failPutPrefix = 'backup.';
    await atTime('2026-09-28T08:00:00Z', async () => {
      const r = await call(worker, env, 'PUT', validState({ revision: 2 }));
      assertEqual(r.status, 200);
    });
    assertEqual(JSON.parse(kv.store.get('state')).revision, 2);
    assert(!kv.store.has('backup.2026-09-28'), 'sin copia');
  });

  test('si no se puede leer el estado previo, el PUT se guarda igual sin copia', async () => {
    const kv = makeKv();
    const env = makeEnv({ kv });
    await atTime('2026-09-27T10:00:00Z', () => call(worker, env, 'PUT', validState({ revision: 1 })));
    kv.failGet = true;
    await atTime('2026-09-28T08:00:00Z', async () => {
      const r = await call(worker, env, 'PUT', validState({ revision: 2 }));
      assertEqual(r.status, 200);
    });
    assertEqual(JSON.parse(kv.store.get('state')).revision, 2);
    assert(!kv.store.has('backup.2026-09-28'), 'sin copia');
  });

  test('un blob previo ilegible también se conserva tal cual en la copia', async () => {
    const kv = makeKv();
    kv.store.set('state', '{roto');
    await atTime('2026-09-28T08:00:00Z', () => call(worker, makeEnv({ kv }), 'PUT', validState()));
    assertEqual(kv.store.get('backup.2026-09-28'), '{roto');
  });

  // --- observabilidad ---

  test('los registros describen el resultado sin incluir el token ni el contenido del estado', async () => {
    const env = makeEnv({ token: 'frase-larga-secreta' });
    const auth = { Authorization: 'Bearer frase-larga-secreta' };
    const lines = await captureLogs(async () => {
      await call(worker, env, 'PUT', validState({ tasks: [{ id: 'a', title: 'Contenido privado' }] }), auth);
      await call(worker, env, 'GET', undefined, auth);
      await call(worker, env, 'GET', undefined, { Authorization: 'Bearer intento-fallido' });
    });
    assert(lines.length >= 3, 'hay una línea por petición a la API');
    const all = lines.join('\n');
    assert(!all.includes('frase-larga-secreta'), 'sin el token válido');
    assert(!all.includes('intento-fallido'), 'sin el token recibido');
    assert(!all.includes('Contenido privado'), 'sin contenido del estado');
    lines.forEach((line) => JSON.parse(line));
  });

  // --- ETag e If-Match ---

  test('GET devuelve ETag con la revisión y "empty" cuando no hay estado', async () => {
    const env = makeEnv();
    const empty = await call(worker, env, 'GET');
    assertEqual(empty.headers.get('ETag'), '"empty"');
    await call(worker, env, 'PUT', validState({ revision: 3 }));
    const res = await call(worker, env, 'GET');
    assertEqual(res.headers.get('ETag'), '"3"');
    assertEqual((await res.json()).state.revision, 3);
  });

  test('GET con blob ilegible devuelve state null y ETag "empty"', async () => {
    const kv = makeKv();
    kv.store.set('state', '{roto');
    const res = await call(worker, makeEnv({ kv }), 'GET');
    assertEqual((await res.json()).state, null);
    assertEqual(res.headers.get('ETag'), '"empty"');
  });

  test('PUT aceptado devuelve el ETag de la revisión guardada', async () => {
    const res = await call(worker, makeEnv(), 'PUT', validState({ revision: 7 }));
    assertEqual(res.status, 200);
    assertEqual(res.headers.get('ETag'), '"7"');
  });

  test('PUT sin If-Match sigue escribiendo sobre un estado existente', async () => {
    const env = makeEnv();
    await call(worker, env, 'PUT', validState({ revision: 3 }));
    const res = await call(worker, env, 'PUT', validState({ revision: 4 }));
    assertEqual(res.status, 200);
    assertEqual(res.headers.get('ETag'), '"4"');
  });

  test('If-Match con la revisión vigente permite el guardado', async () => {
    const kv = makeKv();
    const env = makeEnv({ kv });
    await call(worker, env, 'PUT', validState({ revision: 3 }));
    const res = await call(worker, env, 'PUT', validState({ revision: 4 }), { 'If-Match': '"3"' });
    assertEqual(res.status, 200);
    assertEqual(JSON.parse(kv.store.get('state')).revision, 4);
  });

  test('If-Match "empty" permite el primer guardado y falla si ya hay estado', async () => {
    const kv = makeKv();
    const env = makeEnv({ kv });
    const first = await call(worker, env, 'PUT', validState({ revision: 1 }), { 'If-Match': '"empty"' });
    assertEqual(first.status, 200);
    const stale = await call(worker, env, 'PUT', validState({ revision: 2 }), { 'If-Match': '"empty"' });
    assertEqual(stale.status, 409);
    assertEqual(JSON.parse(kv.store.get('state')).revision, 1, 'no se sobrescribió');
  });

  test('If-Match viejo responde 409 con el estado actual y su ETag, sin escribir ni copiar', async () => {
    const kv = makeKv();
    const env = makeEnv({ kv });
    await call(worker, env, 'PUT', validState({ revision: 5, tasks: [{ id: 'a', title: 'Vigente' }] }));
    const res = await call(worker, env, 'PUT', validState({ revision: 6 }), { 'If-Match': '"3"' });
    assertEqual(res.status, 409);
    assertEqual(res.headers.get('ETag'), '"5"');
    const body = await res.json();
    assert(/conflicto/i.test(body.error), 'error de conflicto');
    assertEqual(body.state.revision, 5, 'devuelve el estado vigente');
    assertEqual(JSON.parse(kv.store.get('state')).revision, 5, 'KV intacto');
    const backups = [...kv.store.keys()].filter((k) => k.startsWith('backup.'));
    assertEqual(backups.length, 0, 'sin copia diaria: el 409 no escribe nada');
  });

  test('un blob ilegible cuenta como "empty" en la comparación condicional', async () => {
    const kv = makeKv();
    kv.store.set('state', '{roto');
    const env = makeEnv({ kv });
    const conflict = await call(worker, env, 'PUT', validState(), { 'If-Match': '"3"' });
    assertEqual(conflict.status, 409);
    assertEqual((await conflict.json()).state, null);
    assertEqual(conflict.headers.get('ETag'), '"empty"');
    const ok = await call(worker, env, 'PUT', validState({ revision: 1 }), { 'If-Match': '"empty"' });
    assertEqual(ok.status, 200, 'se recupera como vacío');
  });

  test('If-Match acepta la notación con exponente que emite String() en revisiones grandes', async () => {
    const kv = makeKv();
    const env = makeEnv({ kv });
    await call(worker, env, 'PUT', validState({ revision: 1e21 }));
    const res = await call(worker, env, 'GET');
    const etag = res.headers.get('ETag');
    assertEqual(etag, '"1e+21"');
    const put = await call(worker, env, 'PUT', validState({ revision: 3 }), { 'If-Match': etag });
    assertEqual(put.status, 200);
    assertEqual(JSON.parse(kv.store.get('state')).revision, 3);
  });

  test('If-Match malformado responde 400 sin tocar KV', async () => {
    for (const bad of ['3', 'abc', '"x"', '""', '*', '"emptyy"', '" 3"']) {
      const kv = makeKv();
      const res = await call(worker, makeEnv({ kv }), 'PUT', validState(), { 'If-Match': bad });
      assertEqual(res.status, 400, bad);
      assertEqual(kv.store.size, 0, 'nada guardado: ' + bad);
    }
  });

  test('si KV falla al leer la comparación, PUT condicional responde 503 con JSON', async () => {
    const kv = makeKv();
    kv.failGet = true;
    const res = await call(worker, makeEnv({ kv }), 'PUT', validState(), { 'If-Match': '"1"' });
    assertEqual(res.status, 503);
    assert(typeof (await res.json()).error === 'string', 'error descriptivo');
  });

  // --- ejecución y salida ---

  // los registros del Worker se silencian durante cada prueba para que la salida sea solo el resultado
  const print = console.log;
  const results = [];
  for (const item of registry) {
    console.log = () => {};
    try {
      await item.fn();
      results.push({ name: item.name, ok: true });
    } catch (e) {
      results.push({ name: item.name, ok: false, error: (e && e.message) || String(e) });
    } finally {
      console.log = print;
    }
  }
  results.forEach((r) => print((r.ok ? 'OK   ' : 'FALLA ') + r.name + (r.ok ? '' : '  ->  ' + r.error)));
  const failed = results.filter((r) => !r.ok);
  print('\n' + (results.length - failed.length) + '/' + results.length + ' pruebas en verde');
  if (failed.length) process.exit(1);
}

main();
