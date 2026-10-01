# Siguiente — reglas del proyecto

## Qué es
Sistema personal de un solo usuario para empezar, avanzar y retomar tareas. Responde "¿cuál es el siguiente paso que puedo dar ahora?", no "¿qué tengo pendiente?". Proyecto personal: claridad y mantenibilidad antes que generalidad.

## Principios de producto (no negociables)
- Solo el nombre es obligatorio al capturar; se guarda como título sin inventar una acción. La acción se escribe debajo de la tarea en Bandeja antes de elegirla para hoy. Nada más puede bloquear la captura.
- La pantalla principal muestra UNA acción y dos botones: "Empezar" y "Ajustar". Si una tarea antigua ya tiene resultado deseado, se muestra "Para:" sin exigirlo a las nuevas.
- El historial no se borra ni se reinicia: las sesiones se conservan aunque la tarea cambie o termine.
- La duración de una sesión se calcula con marcas de tiempo, nunca con un temporizador en memoria.
- Un día sin registros no es un incumplimiento. Ningún texto culpa, presiona ni habla de rachas o fallos.
- Cero notificaciones salvo petición explícita del dueño del proyecto.
- Fuera de alcance salvo petición explícita del dueño: gamificación, rachas, IA, recordatorios, notificaciones, cuentas, multiusuario, un horario de clases real (aulas y horas) en la vista Semana.
- Retirado por decisión del dueño: la distinción fecha límite / fecha de trabajo. El esquema v2 no tiene `dueDate`; reprogramar solo mueve la tarea al plan de otro día.
- Hecho por petición del dueño: reemplazo completo de la interfaz por el frontend "mobile-first" (src/ + build.py → public/index.html), esquema v2, sin migración de los datos antiguos (la clave `siguiente.v1` queda intacta pero sin uso) y sincronización desactivada por defecto.

## Reglas técnicas
- Fuentes en src/: core.js (dominio puro, casos de uso y validación; sin DOM ni red), app.js (persistencia, vistas y eventos), server.js (Worker + Durable Object; valida con SiguienteCore) y styles.css (mobile-first). `python build.py` los concatena en public/index.html y worker.dist.js — archivo autónomo, generado y servido junto a public/_headers. Se edita solo src/ y se reconstruye; nunca se retoca el index.html generado a mano. En la raíz: README.md, CLAUDE.md, QA.md, build.py, src/server.js, worker.dist.js, worker.tests.js, wrangler.jsonc, MEJORAS.md, tests/ (core.test.cjs y remote.test.cjs con node:test; ui.test.js y make-qa-pages.py para los recorridos de navegador en .qa/), previews/ y bocetos/.
- Cero dependencias npm, cero node_modules, cero TypeScript, cero frameworks, cero CDN. El único paso de generación es build.py (concatenación con Python 3, sin paquetes): produce public/index.html y worker.dist.js (src/core.js + src/server.js). public/index.html abre con doble clic y funciona entero sin internet, guardando en local. La única red posible es la sincronización, contra /api/state del mismo origen, nunca una URL absoluta: el grep de https?:// en public/ y src/ sigue vacío.
- El token de sincronización se guarda en el equipo (localStorage, clave `siguiente.token`) y solo se envía en la cabecera Authorization. Nunca viaja en la URL (ni query ni path).
- Scripts clásicos en línea dentro del index.html generado (la CSP admite 'unsafe-inline'). src/core.js expone un único objeto global "SiguienteCore" mediante globalThis y, si existe module.exports, también lo exporta para las pruebas de Node.
- src/core.js no puede mencionar document, window, localStorage, alert, setTimeout ni Date.now — ni siquiera dentro de otra palabra en comentarios: el grep debe salir vacío. Recibe el reloj como marca ISO inyectada y corre en Node sin cambios.
- Ids con un uid() propio (crypto.randomUUID con fallback aleatorio).
- Patrón estado → render. El estado es la única fuente de verdad. Cada caso de uso recibe el estado y los datos y devuelve el nuevo estado o un error descriptivo como valor (sin excepciones), sin mutar el estado recibido. La interfaz repinta todo tras cada cambio.
- La persistencia del estado pasa por adaptadores asíncronos load()/save(state): LocalStorageAdapter (clave "siguiente.frontend.v2"), BaselineAdapter ("siguiente.frontend.syncbase.v2", copia base para la fusión), RemoteAdapter (/api/state con ETag/If-Match) y CompositeAdapter (local primero para no perder nada sin conexión; fusión a tres vías con Core.mergeStates ante cambios en ambos lados o 409, con hasta 3 reintentos). En file:// se usa solo el local. Se guarda solo cuando el estado cambia.
- Sincronización DESACTIVADA por defecto: el adaptador remoto solo entra si globalThis.SiguienteConfig = { sync: true } está definido antes del script de la app y la página se sirve por HTTPS del mismo origen. En el servidor la revisión la asigna el Durable Object (src/server.js → worker.dist.js), no el estado: todo PUT exige If-Match (428/409), GET admite If-None-Match (304), SYNC_TOKEN es obligatorio (sin él la API responde 503) y el estado entrante se valida con SiguienteCore.
- El núcleo nunca calcula "hoy": la interfaz le pasa la fecha local (YYYY-MM-DD) y el reloj.
- schemaVersion (2) dentro del estado y migrate() preparada. Solo migra el "v1" que coincida con el contrato conocido; nuestros datos antiguos no migran (empezar limpio fue la decisión).
- Todo texto escrito por la persona se escapa antes de insertarlo en HTML.
- JavaScript vanilla ES2020, CSS propio con variables. Identificadores en inglés; textos de interfaz y comentarios en español. Funciones cortas; un comentario de una línea al inicio de cada bloque.
- Lenguaje visual definitivo (frontend mobile-first elegido por el dueño): editorial cálida. Tema claro (crema #f5f3ee, tinta #2c2c2b, único acento terracota #a94724), oscuro (#171513 con acento #f29e6e) o automático según el sistema, con preferencia persistente en `siguiente.theme`. Serif humanista (Georgia) para titulares y cifras; sans del sistema para el resto; solo fuentes del sistema. Mobile-first real: la base CSS es el teléfono (320–639 px, una columna, acciones principales de ancho completo, campos de 16 px, objetivos táctiles ≥44 px, navegación inferior fuera del área de contenido y áreas seguras respetadas) y las mejoras usan solo min-width (640 tablet, 1024 navegación lateral, 1280 columna secundaria; nada de media queries max-width). Radios por jerarquía (controles 8px, paneles 12px), sombras casi imperceptibles. Cuatro vistas (Hoy, Bandeja, Semana, Progreso) más Ajustes. El acento se gasta en un solo sitio principal por pantalla.
- Archivos completos: sin fragmentos, sin TODOs.

## Forma de trabajo
- Trabajar solo en el alcance de la fase indicada. Ante ambigüedad, preguntar antes de inventar. Las mejoras se proponen en una lista aparte; no se implementan.
- Antes de escribir código, presentar un plan breve y esperar confirmación.
- Antes de entregar: `python build.py` tras cualquier cambio en src/, `node --test tests/*.test.cjs` y `node worker.tests.js` en verde (worker.tests.js prueba el worker.dist.js generado), grep de palabras prohibidas en src/core.js sin resultados, `grep -rnE "https?://" public/ src/` sin resultados, commit con mensaje descriptivo.
- Cada fase termina con un commit etiquetado (fase-1, fase-1.5, fase-2...).
