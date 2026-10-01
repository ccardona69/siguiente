/* worker.tests.js — pruebas del Worker de "Siguiente" con el almacén simulado.
   Ejecuta primero "python build.py" (genera worker.dist.js) y luego "node worker.tests.js";
   termina con código 1 si algo falla. Sin dependencias: Request, Response y Headers
   vienen de Node. */
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

// KV simulado para el traspaso del estado heredado
function makeKv(entries = {}) {
  const store = new Map(Object.entries(entries));
  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

// entorno del Worker: estáticos simulados, objeto durable simulado y token
function makeEnv(server, options = {}) {
  const env = {
    ASSETS: { fetch: async (req) => new Response('asset:' + new URL(req.url).pathname) },
    SYNC_TOKEN: options.token === undefined ? 'frase-larga-secreta' : options.token,
  };
  if (options.kv) env.SIGUIENTE_KV = options.kv;
  if (options.durable !== false) {
    const store = server.memoryStore();
    const holder = { failed: [] };
    env.__store = store;
    env.__holder = holder;
    env.STATE_STORE = {
      idFromName: () => 'id',
      get: () => ({ fetch: (req) => server.handleApi(req, store, env, holder) }),
    };
  }
  return env;
}

// estado v2 mínimo válido tal como lo exige SiguienteCore
function validState(extra = {}) {
  return Object.assign({ schemaVersion: 2, savedAt: null, tasks: [], plans: [], sessions: [] }, extra);
}

// tarea válida mínima
function validTask(extra = {}) {
  return Object.assign(
    {
      id: 'tarea_1',
      title: 'Física II',
      status: 'inbox',
      nextAction: null,
      outcome: null,
      completedAt: null,
      createdAt: '2026-09-01T10:00:00Z',
      updatedAt: '2026-09-01T10:00:00Z',
    },
    extra,
  );
}

// cabecera Authorization con el token de prueba
const AUTH = { Authorization: 'Bearer frase-larga-secreta' };

// llama al Worker con una petición real a /api/state
async function call(worker, env, method, body, headers = {}, path = '/api/state') {
  const init = { method, headers: Object.assign({}, AUTH, headers) };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return worker.fetch(new Request('https://siguiente.test' + path, init), env);
}

// ejecuta fn con el reloj fijado en una fecha ISO
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

// comprime un texto con gzip usando las APIs que trae Node
async function gzip(text) {
  const stream = new Response(text).body.pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

async function main() {
  const server = await import('./worker.dist.js');
  const worker = server.default;

  // --- rutas y estáticos ---

  test('una ruta que no es /api/state se sirve como estático', async () => {
    const res = await call(worker, makeEnv(server), 'GET', undefined, {}, '/index.html');
    assertEqual(await res.text(), 'asset:/index.html');
  });

  test('sin objeto durable configurado la API responde 503', async () => {
    const res = await call(worker, makeEnv(server, { durable: false }), 'GET');
    assertEqual(res.status, 503);
    assert(typeof (await res.json()).error === 'string', 'error descriptivo');
  });

  test('sin SYNC_TOKEN configurado la API queda cerrada con 503', async () => {
    const env = makeEnv(server, { token: null });
    const get = await call(worker, env, 'GET');
    const put = await call(worker, env, 'PUT', validState());
    assertEqual(get.status, 503);
    assertEqual(put.status, 503);
  });

  test('métodos distintos de GET y PUT dan 405 con Allow', async () => {
    for (const method of ['POST', 'DELETE', 'PATCH']) {
      const res = await call(worker, makeEnv(server), method, method === 'DELETE' ? undefined : '{}');
      assertEqual(res.status, 405, method);
      assertEqual(res.headers.get('Allow'), 'GET, PUT', method);
    }
  });

  test('las respuestas JSON no se guardan en caché', async () => {
    const res = await call(worker, makeEnv(server), 'GET');
    assertEqual(res.headers.get('Cache-Control'), 'no-store');
    assert(res.headers.get('Content-Type').startsWith('application/json'), 'tipo JSON');
  });

  // --- token ---

  test('sin cabecera o con token incorrecto da 401', async () => {
    const env = makeEnv(server);
    const bare = new Request('https://siguiente.test/api/state');
    assertEqual((await worker.fetch(bare, env)).status, 401, 'sin cabecera');
    const wrong = new Request('https://siguiente.test/api/state', {
      headers: { Authorization: 'Bearer otro' },
    });
    assertEqual((await worker.fetch(wrong, env)).status, 401, 'incorrecto');
    const noBearer = new Request('https://siguiente.test/api/state', {
      headers: { Authorization: 'frase-larga-secreta' },
    });
    assertEqual((await worker.fetch(noBearer, env)).status, 401, 'sin Bearer');
  });

  test('el token en la URL no da acceso', async () => {
    const env = makeEnv(server);
    const req = new Request('https://siguiente.test/api/state?token=frase-larga-secreta');
    assertEqual((await worker.fetch(req, env)).status, 401);
  });

  test('un PUT sin token válido no escribe nada', async () => {
    const env = makeEnv(server);
    const req = new Request('https://siguiente.test/api/state', {
      method: 'PUT',
      body: JSON.stringify(validState()),
    });
    const res = await worker.fetch(req, env);
    assertEqual(res.status, 401);
    assertEqual(env.__store.meta.state, null, 'almacén intacto');
  });

  test('tras demasiados intentos fallidos la API frena con 429', async () => {
    const env = makeEnv(server);
    const bad = () =>
      worker.fetch(
        new Request('https://siguiente.test/api/state', {
          headers: { Authorization: 'Bearer intento' },
        }),
        env,
      );
    for (let i = 0; i < 8; i += 1) assertEqual((await bad()).status, 401, 'intento ' + i);
    assertEqual((await bad()).status, 429);
  });

  // --- lectura y escritura con revisión del servidor ---

  test('GET vacío devuelve state null y ETag "empty"', async () => {
    const res = await call(worker, makeEnv(server), 'GET');
    assertEqual(res.headers.get('ETag'), '"empty"');
    assertEqual((await res.json()).state, null);
  });

  test('PUT con If-Match "empty" guarda y el servidor asigna la revisión 1', async () => {
    const env = makeEnv(server);
    const put = await call(worker, env, 'PUT', validState({ tasks: [validTask()] }), { 'If-Match': '"empty"' });
    assertEqual(put.status, 200);
    assertEqual(put.headers.get('ETag'), '"1"');
    assertEqual((await put.json()).revision, 1);
    const got = await call(worker, env, 'GET');
    assertEqual(got.headers.get('ETag'), '"1"');
    assertEqual(JSON.stringify((await got.json()).state), JSON.stringify(validState({ tasks: [validTask()] })));
  });

  test('PUT sin If-Match responde 428 sin escribir', async () => {
    const env = makeEnv(server);
    const res = await call(worker, env, 'PUT', validState());
    assertEqual(res.status, 428);
    assertEqual(env.__store.meta.state, null, 'nada guardado');
  });

  test('PUT con la revisión vigente escribe y sube el contador', async () => {
    const env = makeEnv(server);
    await call(worker, env, 'PUT', validState(), { 'If-Match': '"empty"' });
    const res = await call(worker, env, 'PUT', validState({ tasks: [validTask()] }), { 'If-Match': '"1"' });
    assertEqual(res.status, 200);
    assertEqual(res.headers.get('ETag'), '"2"');
    assertEqual(env.__store.meta.revision, 2);
  });

  test('PUT con revisión vieja responde 409 con el estado actual y su ETag', async () => {
    const env = makeEnv(server);
    await call(worker, env, 'PUT', validState({ tasks: [validTask()] }), { 'If-Match': '"empty"' });
    const res = await call(worker, env, 'PUT', validState(), { 'If-Match': '"empty"' });
    assertEqual(res.status, 409);
    assertEqual(res.headers.get('ETag'), '"1"');
    const body = await res.json();
    assert(/conflicto/i.test(body.error), 'error de conflicto');
    assertEqual(body.state.tasks.length, 1, 'devuelve el estado vigente');
    assertEqual(env.__store.meta.revision, 1, 'no se sobrescribió');
  });

  test('If-Match malformado responde 400 sin tocar el almacén', async () => {
    for (const bad of ['3', 'abc', '"x"', '""', '*', '"emptyy"', '" 3"']) {
      const env = makeEnv(server);
      const res = await call(worker, env, 'PUT', validState(), { 'If-Match': bad });
      assertEqual(res.status, 400, bad);
      assertEqual(env.__store.meta.state, null, 'nada guardado: ' + bad);
    }
  });

  test('GET con If-None-Match igual al ETag vigente responde 304', async () => {
    const env = makeEnv(server);
    const empty = await call(worker, env, 'GET');
    const again = await call(worker, env, 'GET', undefined, { 'If-None-Match': empty.headers.get('ETag') });
    assertEqual(again.status, 304);
    await call(worker, env, 'PUT', validState(), { 'If-Match': '"empty"' });
    const res = await call(worker, env, 'GET', undefined, { 'If-None-Match': '"1"' });
    assertEqual(res.status, 304);
    const fresh = await call(worker, env, 'GET', undefined, { 'If-None-Match': '"0"' });
    assertEqual(fresh.status, 200);
  });

  // --- validación con SiguienteCore ---

  test('PUT rechaza cuerpos que no pasan la validación del núcleo', async () => {
    const bad = [
      'no es json',
      '[]',
      'null',
      '"texto"',
      '{}',
      JSON.stringify({ schemaVersion: '2' }),
      JSON.stringify({ schemaVersion: 2 }), // sin tasks/plans/sessions
      JSON.stringify(validState({ schemaVersion: 99 })),
      JSON.stringify(validState({ tasks: [{ id: 'x' }] })), // tarea incompleta
    ];
    for (const body of bad) {
      const env = makeEnv(server);
      const res = await call(worker, env, 'PUT', body, { 'If-Match': '"empty"' });
      assertEqual(res.status, 400, body);
      assertEqual(env.__store.meta.state, null, 'nada guardado: ' + body);
    }
  });

  test('PUT migra un estado v1 del contrato conocido y lo guarda como v2', async () => {
    const env = makeEnv(server);
    const v1 = { schemaVersion: 1, tasks: [], plans: [], sessions: [] };
    const res = await call(worker, env, 'PUT', v1, { 'If-Match': '"empty"' });
    assertEqual(res.status, 200);
    const got = await (await call(worker, env, 'GET')).json();
    assertEqual(got.state.schemaVersion, 2);
  });

  test('PUT acepta el cuerpo comprimido con gzip', async () => {
    const env = makeEnv(server);
    const packed = await gzip(JSON.stringify(validState({ tasks: [validTask()] })));
    const req = new Request('https://siguiente.test/api/state', {
      method: 'PUT',
      headers: Object.assign({ 'Content-Encoding': 'gzip', 'If-Match': '"empty"' }, AUTH),
      body: packed,
    });
    const res = await worker.fetch(req, env);
    assertEqual(res.status, 200);
    const got = await (await call(worker, env, 'GET')).json();
    assertEqual(got.state.tasks.length, 1);
  });

  test('PUT mide el límite en bytes tras descomprimir y rechaza gigantes', async () => {
    const env = makeEnv(server);
    const heavy = JSON.stringify(validState({ sessions: [{ id: 'x', padding: 'ñ'.repeat(33 * 1024 * 1024) }] }));
    const res = await call(worker, env, 'PUT', heavy, { 'If-Match': '"empty"' });
    assertEqual(res.status, 413);
  });

  test('un Content-Length mayor al límite se rechaza con 413 sin leer el cuerpo', async () => {
    let bodyRead = false;
    const request = {
      url: 'https://siguiente.test/api/state',
      method: 'PUT',
      headers: new Headers(Object.assign({ 'Content-Length': String(40 * 1024 * 1024) }, AUTH)),
      text: async () => {
        bodyRead = true;
        return '{}';
      },
    };
    const res = await worker.fetch(request, makeEnv(server));
    assertEqual(res.status, 413);
    assertEqual(bodyRead, false, 'el cuerpo no se leyó');
  });

  // --- traspaso desde KV ---

  test('la primera lectura con almacén vacío adopta el estado de KV como revisión 1', async () => {
    const kv = makeKv({ state: JSON.stringify(validState({ tasks: [validTask()] })) });
    const env = makeEnv(server, { kv });
    const res = await call(worker, env, 'GET');
    assertEqual(res.headers.get('ETag'), '"1"');
    assertEqual((await res.json()).state.tasks.length, 1);
    assert(kv.store.has('state'), 'KV sigue intacto como respaldo');
  });

  test('un blob heredado que no valida no se adopta', async () => {
    const kv = makeKv({ state: '{roto' });
    const env = makeEnv(server, { kv });
    const res = await call(worker, env, 'GET');
    assertEqual((await res.json()).state, null);
    assertEqual(res.headers.get('ETag'), '"empty"');
  });

  // --- blob corrupto ---

  test('GET con un cuerpo ilegible devuelve state null y ETag "empty"', async () => {
    const env = makeEnv(server);
    env.__store.meta.state = '{roto';
    env.__store.meta.revision = 4;
    const res = await call(worker, env, 'GET');
    assertEqual((await res.json()).state, null);
    assertEqual(res.headers.get('ETag'), '"empty"');
  });

  // --- cabeceras de seguridad ---

  test('las respuestas de la API llevan X-Content-Type-Options: nosniff, también las de error', async () => {
    const env = makeEnv(server);
    const ok = await call(worker, env, 'GET');
    const bad = await call(worker, env, 'PUT', 'no es json', { 'If-Match': '"empty"' });
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

  test('el primer PUT del día guarda una copia del estado anterior', async () => {
    const env = makeEnv(server);
    await atTime('2026-09-27T10:00:00Z', () => call(worker, env, 'PUT', validState(), { 'If-Match': '"empty"' }));
    await atTime('2026-09-28T08:00:00Z', () =>
      call(worker, env, 'PUT', validState({ tasks: [validTask()] }), { 'If-Match': '"1"' }),
    );
    const copy = env.__store.backups.get('2026-09-28');
    assert(copy, 'hay copia del día');
    assertEqual(copy.revision, 1, 'la copia guarda la revisión anterior');
    assertEqual(JSON.parse(copy.body).tasks.length, 0, 'la copia tiene el estado previo');
  });

  test('un segundo PUT el mismo día no reemplaza la copia', async () => {
    const env = makeEnv(server);
    await atTime('2026-09-27T10:00:00Z', () => call(worker, env, 'PUT', validState(), { 'If-Match': '"empty"' }));
    await atTime('2026-09-28T08:00:00Z', () =>
      call(worker, env, 'PUT', validState({ tasks: [validTask()] }), { 'If-Match': '"1"' }),
    );
    await atTime('2026-09-28T20:00:00Z', () =>
      call(worker, env, 'PUT', validState({ tasks: [validTask({ id: 't2' })] }), { 'If-Match': '"2"' }),
    );
    assertEqual(env.__store.backups.get('2026-09-28').revision, 1, 'sigue siendo la del inicio del día');
  });

  test('el primer PUT de todos no crea copia porque no hay estado anterior', async () => {
    const env = makeEnv(server);
    await call(worker, env, 'PUT', validState(), { 'If-Match': '"empty"' });
    assertEqual(env.__store.backups.size, 0);
  });

  test('el primer PUT adopta el estado heredado y responde 409 con él', async () => {
    const kv = makeKv({ state: JSON.stringify(validState({ tasks: [validTask()] })) });
    const env = makeEnv(server, { kv });
    const res = await call(worker, env, 'PUT', validState(), { 'If-Match': '"empty"' });
    assertEqual(res.status, 409, 'la herencia pasa primero');
    const body = await res.json();
    assertEqual(body.state.tasks.length, 1, 'devuelve el estado adoptado');
    assertEqual(res.headers.get('ETag'), '"1"');
    assertEqual(env.__store.meta.revision, 1, 'adoptado como revisión 1');
  });

  test('un cuerpo guardado ilegible cuenta como vacío y PUT "empty" lo recupera', async () => {
    const env = makeEnv(server);
    env.__store.meta.state = '{roto';
    env.__store.meta.revision = 4;
    const res = await call(worker, env, 'PUT', validState(), { 'If-Match': '"empty"' });
    assertEqual(res.status, 200);
    assertEqual(env.__store.meta.revision, 5, 'continúa la revisión');
  });

  test('las copias con más de 30 días se eliminan', async () => {
    const env = makeEnv(server);
    await atTime('2026-08-01T10:00:00Z', () => call(worker, env, 'PUT', validState(), { 'If-Match': '"empty"' }));
    await atTime('2026-08-02T10:00:00Z', () =>
      call(worker, env, 'PUT', validState({ tasks: [validTask()] }), { 'If-Match': '"1"' }),
    );
    assert(env.__store.backups.has('2026-08-02'), 'hay copia del inicio del día');
    await atTime('2026-10-01T10:00:00Z', () =>
      call(worker, env, 'PUT', validState({ tasks: [validTask({ id: 't2' })] }), { 'If-Match': '"2"' }),
    );
    assert(!env.__store.backups.has('2026-08-02'), 'la copia vieja se borró');
    assert(env.__store.backups.has('2026-10-01'), 'la copia del día sigue');
  });

  test('un gzip que descomprime más del límite responde 413 sin guardar', async () => {
    const env = makeEnv(server);
    const packed = await gzip('x'.repeat(33 * 1024 * 1024));
    const req = new Request('https://siguiente.test/api/state', {
      method: 'PUT',
      headers: Object.assign({ 'Content-Encoding': 'gzip', 'If-Match': '"empty"' }, AUTH),
      body: packed,
    });
    const res = await worker.fetch(req, env);
    assertEqual(res.status, 413);
    assertEqual(env.__store.meta.state, null, 'nada guardado');
  });

  // --- observabilidad ---

  test('los registros describen el resultado sin incluir el token ni el contenido del estado', async () => {
    const env = makeEnv(server);
    const lines = await captureLogs(async () => {
      await call(worker, env, 'PUT', validState({ tasks: [validTask({ title: 'Contenido privado' })] }), {
        'If-Match': '"empty"',
      });
      await call(worker, env, 'GET');
      await worker.fetch(
        new Request('https://siguiente.test/api/state', {
          headers: { Authorization: 'Bearer intento-fallido' },
        }),
        env,
      );
    });
    assert(lines.length >= 3, 'hay una línea por petición a la API');
    const all = lines.join('\n');
    assert(!all.includes('frase-larga-secreta'), 'sin el token válido');
    assert(!all.includes('intento-fallido'), 'sin el token recibido');
    assert(!all.includes('Contenido privado'), 'sin contenido del estado');
    lines.forEach((line) => JSON.parse(line));
  });

  // --- ejecución ---

  let passed = 0;
  for (const { name, fn } of registry) {
    try {
      await fn();
      passed += 1;
      console.log('OK  ', name);
    } catch (error) {
      console.log('FAIL', name);
      console.log('     ' + error.message);
    }
  }
  console.log('');
  console.log(passed + '/' + registry.length + ' pruebas en verde');
  if (passed !== registry.length) process.exitCode = 1;
}

main();
