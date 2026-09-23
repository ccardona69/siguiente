// Worker de "Siguiente": sirve los estáticos de public/ y una única ruta /api/state
// que guarda y devuelve el estado completo como un blob JSON en KV. Sin dependencias.

const STATE_KEY = 'state';
const CORRUPT_KEY = 'state.corrupt'; // respaldo de clave fija: sobrescribirlo es idempotente y no acumula basura
const MAX_BYTES = 1024 * 1024; // 1 MB en bytes UTF-8 reales: el estado de un solo usuario nunca se acerca

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // todo lo que no sea la API se sirve como archivo estático
    if (url.pathname !== '/api/state') {
      return env.ASSETS.fetch(request);
    }

    // la sincronización necesita el almacén KV configurado
    if (!env.SIGUIENTE_KV) {
      return json({ error: 'sincronización no configurada' }, 503);
    }

    // token compartido opcional: si SYNC_TOKEN está definido, se exige
    if (!authorized(request, env)) {
      return json({ error: 'no autorizado' }, 401);
    }

    if (request.method === 'GET') {
      return readState(env);
    }

    if (request.method === 'PUT') {
      const body = await request.text();
      // el límite se mide en bytes UTF-8, no en las unidades UTF-16 que cuenta String.length
      if (byteLength(body) > MAX_BYTES) return json({ error: 'estado demasiado grande' }, 413);
      const parsed = parseState(body);
      if (!parsed.ok) return json({ error: parsed.error }, 400);
      await env.SIGUIENTE_KV.put(STATE_KEY, JSON.stringify(parsed.value));
      return json({ ok: true });
    }

    return json({ error: 'método no permitido' }, 405, { Allow: 'GET, PUT' });
  }
};

// devuelve el estado guardado; si el blob no se puede leer, lo aparta y se declara vacío
// es la única lectura del Worker que escribe en KV: mueve los bytes ilegibles a CORRUPT_KEY
// (clave fija, así un segundo GET sobrescribe lo mismo) para que el cliente suba su copia local
// y la app se recupere sola en el siguiente guardado, sin dejar al usuario atrapado
async function readState(env) {
  const stored = await env.SIGUIENTE_KV.get(STATE_KEY);
  if (!stored) return json({ state: null });
  try {
    return json({ state: JSON.parse(stored) });
  } catch (e) {
    // si el respaldo falla se responde igual: recuperar la app importa más que conservar el blob ilegible
    try {
      await env.SIGUIENTE_KV.put(CORRUPT_KEY, stored);
    } catch (e2) {}
    return json({ state: null });
  }
}

// respuesta JSON sin caché
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
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
