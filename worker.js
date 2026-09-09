// Worker de "Siguiente": sirve los estáticos de public/ y una única ruta /api/state
// que guarda y devuelve el estado completo como un blob JSON en KV. Sin dependencias.

const STATE_KEY = 'state';
const MAX_BYTES = 1024 * 1024; // 1 MB: el estado de un solo usuario nunca se acerca

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
      const stored = await env.SIGUIENTE_KV.get(STATE_KEY);
      if (!stored) return json({ state: null });
      try {
        return json({ state: JSON.parse(stored) });
      } catch (e) {
        return json({ error: 'el estado guardado no se puede leer' }, 500);
      }
    }

    if (request.method === 'PUT') {
      const body = await request.text();
      if (body.length > MAX_BYTES) return json({ error: 'estado demasiado grande' }, 413);
      const parsed = parseState(body);
      if (!parsed.ok) return json({ error: parsed.error }, 400);
      await env.SIGUIENTE_KV.put(STATE_KEY, JSON.stringify(parsed.value));
      return json({ ok: true });
    }

    return json({ error: 'método no permitido' }, 405, { Allow: 'GET, PUT' });
  }
};

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

// valida el token compartido solo si el Worker tiene SYNC_TOKEN
// solo por cabecera Authorization: nunca se lee de la URL, que acabaría en los logs
function authorized(request, env) {
  const expected = env.SYNC_TOKEN;
  if (!expected) return true;
  const header = request.headers.get('Authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  return bearer === expected;
}

// el cuerpo debe ser un objeto JSON con schemaVersion 1
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
  if (value.schemaVersion !== 1) {
    return { ok: false, error: 'versión de esquema incompatible' };
  }
  return { ok: true, value };
}
