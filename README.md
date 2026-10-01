# Siguiente

Sistema personal de un solo usuario para **empezar, avanzar y retomar** tareas.
No responde "¿qué tengo pendiente?", responde **"¿cuál es el siguiente paso que
puedo dar ahora?"**.

HTML, CSS y JavaScript nativos; sin librerías, fuentes remotas ni servicios
externos obligatorios. La interfaz es **mobile-first**: la base es el teléfono
(320–639 px, una columna, acciones de ancho completo, navegación inferior fuera
del contenido) y las mejoras progresivas usan solo `min-width` a 640, 1024 y
1280 px. Apariencia clara, oscura o automática según el sistema.

## Uso

Abre `public/index.html` con doble clic, o entra a la URL publicada (ver
**Publicación**). No necesita instalación.

1. Captura una tarea en el campo superior.
2. Escribe una acción pequeña y concreta; elígela para hoy.
3. Empieza una sesión, pausa cuando lo necesites y registra el resultado al
   cerrarla.
4. Consulta Semana o Progreso. En Ajustes puedes exportar e importar una copia
   JSON.

**Explorar con ejemplos** es un modo temporal: no modifica los datos reales ni
persiste los cambios. Sal del modo de ejemplo antes de empezar a guardar tus
propias tareas.

## Archivos

```
siguiente/
├── src/
│   ├── core.js        # modelo puro y validación: sin DOM, sin red, reloj inyectado
│   ├── app.js         # persistencia, vistas y eventos
│   └── styles.css     # diseño mobile-first responsive y estilos de impresión
├── public/
│   ├── index.html     # versión autónoma generada por build.py (lo que se sirve)
│   └── _headers       # cabeceras de seguridad de los estáticos (las aplica Cloudflare)
├── tests/
│   ├── core.test.cjs      # pruebas del modelo (node:test)
│   ├── remote.test.cjs    # pruebas de la API con fetch simulado
│   ├── ui.test.js         # recorridos automatizados en el navegador
│   ├── make-qa-pages.py   # genera páginas aisladas de prueba en .qa/
│   └── run-qa-cdp.cjs     # abre una página de .qa/ en Chrome sin ventana y lee QA PASS/FAIL
├── build.py           # genera public/index.html desde src/ (solo concatenación)
├── previews/          # capturas de la interfaz
├── QA.md              # alcance y resultados de comprobación de la entrega
├── worker.js          # Cloudflare Worker: sirve public/ y expone /api/state
├── worker.tests.js    # pruebas del Worker con un KV simulado (solo Node)
├── wrangler.jsonc     # config de Cloudflare Workers (Worker + estáticos + KV)
└── bocetos/           # bocetos históricos de diseño
```

## Desarrollo

Edita los archivos de `src/` y reconstruye con Python 3:

```bash
python build.py          # escribe public/index.html (saltos LF)
```

Pruebas del modelo y del cliente remoto, con Node 18 o superior, sin instalar
paquetes:

```bash
node --test tests/*.test.cjs   # 57 pruebas
node worker.tests.js           # 39 pruebas del Worker
```

Las páginas de QA del navegador se generan con `python tests/make-qa-pages.py`
en `.qa/` (claves `siguiente.qa.*`, datos ficticios, sincronización
desactivada). Cada prueba se abre en un perfil temporal aislado; el marcador
`QA PASS` en el título confirma que el recorrido llegó al final. Ver `QA.md`.

Para recorrerlas sin instalar nada, sirve `.qa/` con cualquier servidor estático
y abre cada página con el ejecutor incluido (`QA_CHROME` indica la ruta de
Chrome o Chromium si no es la de Windows por defecto):

```bash
python -m http.server 8790 -d .qa
node tests/run-qa-cdp.cjs http://localhost:8790/ui-workflow.html
```

## Tus datos

El almacenamiento principal usa la clave `siguiente.frontend.v2` de
`localStorage`; el tema se guarda en `siguiente.theme`. **Nada escribe sobre la
clave anterior `siguiente.v1`**: la versión nueva empieza con datos limpios y
los antiguos quedan intactos en el navegador, pero la app no los usa ni los
importa (las copias JSON del esquema anterior no pasan la validación v2).

El almacenamiento es local al navegador y al origen. Puede desaparecer al borrar
datos del sitio, usar modo privado o cambiar de navegador/origen; en algunos
navegadores también cambia al mover o renombrar un archivo local. **Exporta
copias periódicamente.** No es almacenamiento cifrado ni una copia en la nube.

Si el navegador impide guardar, la app lo informa: los cambios quedan en memoria
y se pueden exportar mientras la página siga abierta. Un archivo incompatible
se conserva para descargarlo; si decides borrarlo, ese archivo no se puede
recuperar con el deshacer del modelo nuevo.

## Sincronización (desactivada por defecto)

El cliente remoto está incluido pero **apagado**: la app no hace peticiones a
`/api/state` a menos que se active. Para activarla, un desarrollador define
`globalThis.SiguienteConfig = { sync: true }` en `build.py` (en el `<head>`,
antes del script de la app) y reconstruye. Solo funciona sobre HTTPS y el mismo
origen; en `file://` y en HTTP sigue siendo solo local.

Contrato esperado — el que ya implementa `worker.js`:

- `GET /api/state`: responde `{ "state": <estado v2 o null> }` y cabecera
  `ETag`.
- `PUT /api/state`: recibe el estado completo y la precondición `If-Match`;
  devuelve un nuevo `ETag`. Conflicto: HTTP 409 con `{ "state": <vigente> }`.
- Autenticación opcional: token Bearer configurado desde Ajustes cuando la
  integración está activa; se guarda en `siguiente.token` y viaja solo en la
  cabecera `Authorization`, nunca en la URL.

Ojo: el esquema v2 no lleva el campo `revision` que el Worker usa hoy para el
ETag. Si se activa la sincronización hay que resolver eso primero (añadir
`revision` al estado o derivar el ETag del contenido en el Worker). Una
respuesta incompatible no se trata como nube vacía ni se sobrescribe a ciegas.

## Publicación

La app se sirve desde **Cloudflare Workers**: `worker.js` entrega los archivos
de `public/` y atiende `PUT`/`GET /api/state`, que guarda y devuelve el estado
como blob JSON en **Workers KV**. Sin base de datos ni lógica de dominio en el
servidor. Sigue sin `package.json` ni `node_modules`: `wrangler` se ejecuta con
`npx`.

Desde `C:\Users\dav\siguiente`:

1. `npx wrangler login` — se abre el navegador para autorizar. En PowerShell, si
   `npx` no carga, usa `npx.cmd`.
2. `npx wrangler kv namespace create SIGUIENTE_KV` — crea el almacén e imprime
   un `id`. Este repo ya trae el `id` del suyo en `wrangler.jsonc`; repite solo
   si despliegas en otra cuenta.
3. *(Opcional)* `npx wrangler secret put SYNC_TOKEN` para exigir
   `Authorization: Bearer <token>` en `/api/state`.
4. `npx wrangler deploy` — imprime la URL
   `https://siguiente.TU-SUBDOMINIO.workers.dev`.

El Worker escribe una línea JSON por petición a la API (evento, código, tamaño;
nunca el token ni el contenido). Se ven en el panel de Cloudflare → Workers →
siguiente → Observability, o con `npx wrangler tail`.

### Copias diarias y restauración

Antes del primer guardado de cada día (UTC), el Worker conserva en KV el estado
que había como `backup.AAAA-MM-DD`; KV las borra solas a los 30 días. Para
restaurar:

1. `npx wrangler kv key list --binding SIGUIENTE_KV --prefix backup. --remote`
2. `npx wrangler kv key get backup.AAAA-MM-DD --binding SIGUIENTE_KV --remote --text | Out-File -Encoding utf8 restaurar.json`
   (usa `Out-File`, no `>`: en PowerShell `>` guarda en UTF-16)
3. En la app: **Ajustes → Importar** y elige `restaurar.json`. Solo aplica si el
   blob guardado es del esquema v2.

### Cabeceras de seguridad

`public/_headers` añade a los estáticos `X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy` y una `Content-Security-Policy` cerrada:
solo scripts y estilos propios o en línea, imágenes propias o `data:` (el icono
de la pestaña va en línea dentro de `index.html`), `connect-src 'self'`, sin
marcos ni formularios. `index.html` además lleva la misma CSP en una etiqueta `<meta>`,
así la protección también aplica al abrirlo como archivo local. `file://` no
recibe las cabeceras: solo las aplica Cloudflare.

## Modelo de datos (esquema v2)

Estado completo: `schemaVersion` (2), `savedAt`, y las colecciones `tasks`,
`plans`, `sessions`.

- **Task**: `id`, `title`, `nextAction`, `outcome`, `status` (`inbox` ·
  `active` · `paused` · `done`), `createdAt`, `updatedAt`, `completedAt`.
- **Plan**: `date` (YYYY-MM-DD local), `taskIds` ordenados, `updatedAt`.
- **Session**: `id`, `taskId`, `title`, `action` (copia de la acción al abrir),
  `startedAt`, `endedAt`, `pausedAt`, `pausedMs`, `progress` (`yes` · `some` ·
  `no`), `nextStep`, `finished`, `updatedAt`.

La duración de una sesión se calcula siempre con marcas de tiempo; las pausas se
descuentan con `pausedMs`. El historial no se borra ni se reinicia.

## API del núcleo (`SiguienteCore`)

Cada caso de uso recibe `(estado, datos, iso)` y devuelve `{ ok: true, state }`
o `{ ok: false, error }` sin mutar el estado recibido ni lanzar excepciones.

- Casos de uso: `captureTask`, `defineTask`, `chooseForToday`, `moveToFirst`,
  `removeFromToday`, `pauseTask`, `resumeTask`, `rescheduleTask`,
  `startSession`, `pauseSession`, `resumeSession`, `closeSession`,
  `markTaskDone`.
- Datos: `emptyState`, `validateState`, `migrate`, `exportState`, `importState`,
  `stampSave`, `mergeStates(base, local, remote, iso)` (fusión a tres vías).
- Consultas: `taskById`, `openSession`, `closedSessions`, `inbox`, `todayPlan`,
  `sessionDuration`, `sessionsBetween`, `sessionsTotalDuration`,
  `taskTotalDuration`, `sessionStats`.

`src/core.js` no usa `document`, `window`, `localStorage`, `alert`,
`setTimeout` ni `Date.now`; corre igual en Node. El núcleo nunca calcula "hoy":
la interfaz le pasa la fecha local y el reloj.

## Fuera de alcance (a revisar en una fase futura)

Revisión semanal asistida, notificaciones, gamificación y rachas. Un horario de
clases real (aulas, horas) para la vista Semana. La fecha límite (`dueDate`)
quedó fuera del esquema v2 por decisión del dueño.
