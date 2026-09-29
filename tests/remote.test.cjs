/* Contrato del adaptador real del frontend, con fetch simulado; no hay red. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const Core = require('../src/core.js');
const source = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
const from = source.indexOf('function usableRemote(');
const to = source.indexOf('// ---------- copia base:', from);
assert.ok(from > 0 && to > from, 'El adaptador debe existir en el frontend real');
const snippet = source.slice(from, to);
function mock(replies) {
  const calls = [];
  let n = 0;
  const context = vm.createContext({
    Core,
    authHeaders: () => ({}),
    SYNC_PATH: '/api/state',
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      const r = replies[n++];
      if (!r) throw Error('Sin respuestas simuladas');
      if (r.error) throw Error(r.error);
      const headers = r.etag === null ? {} : { ETag: r.etag || '"r1"' };
      return new Response(r.raw === undefined ? JSON.stringify(r.body) : r.raw, {
        status: r.status || 200,
        headers,
      });
    },
  });
  vm.runInContext(snippet + '\nglobalThis.adapter=RemoteAdapter;', context);
  return { adapter: context.adapter, calls };
}
test('GET válido conserva la revisión del servidor', async () => {
  const s = Core.emptyState();
  const { adapter } = mock([{ body: { state: s }, etag: '"a"' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(await adapter.load())), s);
  assert.equal(adapter.etag, '"a"');
});
test('GET con estado null reconoce una nube vacía', async () => {
  const { adapter } = mock([{ body: { state: null }, etag: '"empty"' }]);
  assert.equal(await adapter.load(), null);
  assert.equal(adapter.etag, '"empty"');
});
test('GET sin campo state no se interpreta como nube vacía', async () => {
  const { adapter } = mock([{ body: { wrong: [] } }]);
  await assert.rejects(adapter.load());
  assert.equal(adapter.etag, null);
});
test('GET de una versión incompatible invalida la revisión', async () => {
  const { adapter } = mock([{ body: { state: { schemaVersion: 99 } } }]);
  await assert.rejects(adapter.load());
  assert.equal(adapter.etag, null);
});
test('GET con JSON roto no deja una revisión reutilizable', async () => {
  const { adapter } = mock([{ raw: 'not json' }]);
  await assert.rejects(adapter.load());
  assert.equal(adapter.etag, null);
});
test('GET con error de autenticación no habilita escrituras', async () => {
  const { adapter, calls } = mock([{ body: { error: 'unauthorized' }, status: 401 }]);
  await assert.rejects(adapter.load());
  assert.equal(adapter.etag, null);
  assert.ok(calls.every((x) => x.options.method !== 'PUT'));
});
test('PUT sin revisión sondea primero, sin escritura ciega', async () => {
  const s = Core.emptyState();
  const { adapter, calls } = mock([{ body: { state: s }, etag: '"b"' }]);
  await assert.rejects(
    adapter.save(s),
    (e) => e.conflict === true && Core.validateState(e.state).ok,
  );
  assert.equal(calls.length, 1);
  assert.notEqual(calls[0].options.method, 'PUT');
});
test('PUT utiliza If-Match y actualiza el ETag', async () => {
  const s = Core.emptyState();
  const { adapter, calls } = mock([{ body: { ok: true }, etag: '"b"' }]);
  adapter.etag = '"a"';
  assert.equal(await adapter.save(s), s);
  assert.equal(calls[0].options.headers['If-Match'], '"a"');
  assert.equal(calls[0].options.method, 'PUT');
  assert.deepEqual(JSON.parse(calls[0].options.body), s);
  assert.equal(adapter.etag, '"b"');
});
test('409 válido devuelve el estado vigente para la fusión', async () => {
  const s = Core.emptyState();
  const { adapter } = mock([{ body: { state: s }, status: 409, etag: '"c"' }]);
  adapter.etag = '"a"';
  await assert.rejects(
    adapter.save(s),
    (e) => e.conflict === true && Core.validateState(e.state).ok,
  );
  assert.equal(adapter.etag, '"c"');
});
test('409 incompatible no se reintenta como si estuviera vacío', async () => {
  const { adapter, calls } = mock([
    { body: { state: { schemaVersion: 99 } }, status: 409, etag: '"c"' },
  ]);
  adapter.etag = '"a"';
  await assert.rejects(adapter.save(Core.emptyState()), (e) => !e.conflict);
  assert.equal(adapter.etag, null);
  assert.equal(calls.length, 1);
});
test('409 con JSON roto tampoco permite sobrescribir', async () => {
  const { adapter } = mock([{ raw: 'bad json', status: 409 }]);
  adapter.etag = '"a"';
  await assert.rejects(adapter.save(Core.emptyState()), (e) => !e.conflict);
  assert.equal(adapter.etag, null);
});
test('un servidor no disponible informa el fallo', async () => {
  const { adapter } = mock([{ body: { error: 'unavailable' }, status: 503 }]);
  adapter.etag = '"a"';
  await assert.rejects(adapter.save(Core.emptyState()));
});
