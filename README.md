# Siguiente

Sistema personal de un solo usuario para **empezar, avanzar y retomar** tareas.
No responde "¿qué tengo pendiente?", responde **"¿cuál es el siguiente paso que
puedo dar ahora?"**.

- **Fase 1 / 1.1** — el recorrido mínimo (capturar → definir → elegir para hoy →
  trabajar una sesión → cerrarla → retomar).
- **Fase 1.5** — rediseño visual completo (tema oscuro, navegación inferior) y un
  adaptador de almacenamiento remoto para sincronizar entre dispositivos.
- **Fase 2** — dos vistas de solo lectura sobre lo que ya se guarda: **Semana**
  (lo trabajado de lunes a hoy) y **Progreso** (cifras neutras y el registro
  completo), con la interfaz nocturna definitiva de la aplicación.
- **Fase 3** — menú de ajuste completo en Hoy (modificar, quitar del plan, terminar
  tarea), ergonomía de captura continua, distinción sutil en Bandeja de tareas
  por definir, tiempo acumulado por tarea y runner de pruebas interactivo.
- **Fase 4** — **pausar** una tarea (la aparta de todos los planes sin terminarla
  ni tocar su historial; se retoma con "Elegir para hoy") y **reprogramar** (mover
  la tarea al plan de otro día: cambia la fecha de trabajo, nunca el vencimiento).

## Uso

Abre `public/index.html` con doble clic, o entra a la URL publicada (ver
**Publicación**). No necesita instalación.

- **Con doble clic (`file://`)**: los datos se guardan solo en ese navegador
  (`localStorage`, clave `siguiente.v1`). Funciona sin internet.
- **En la URL publicada**: además se sincronizan con tu espacio en la nube. Si un
  guardado remoto falla, el cambio queda en el equipo y se reintenta luego; el
  indicador de la cabecera lo dice ("Sincronizado" / "Guardado solo en este
  equipo").

### Recorrido

1. **Capturar.** Escribe en el campo de arriba ("¿Qué quieres avanzar?") y pulsa
   Enter. La tarea entra en la bandeja solo con título.
2. **Bandeja.** Cada tarea tiene "Definir" (resultado deseado opcional + siguiente
   acción obligatoria) y "Elegir para hoy". Si ya está en el plan de hoy, en su
   lugar aparece la marca "En el plan de hoy".
3. **Hoy.** Muestra una sola acción en grande, "Para: &lt;resultado&gt;" y dos
   botones: "Empezar" y "Ajustar". Debajo, "Después" con el resto del plan; cada
   una con un enlace para subirla al primer lugar. "Ajustar" ofrece también
   **Pausar esta tarea** (la aparta de los planes sin terminarla) y **Mover a
   otro día…** (reprogramar su fecha de trabajo, sin tocar su fecha límite).
4. **Sesión.** "Empezar" abre una sesión: acción, hora de inicio y tiempo
   transcurrido, que **cuenta hacia arriba** y se recalcula solo con las marcas de
   tiempo. El anillo da una vuelta por hora: es solo señal de que el tiempo corre,
   no una cuenta atrás ni un objetivo. "Listo" abre el cierre: ¿Avanzaste? →
   ¿Terminaste la tarea? → si sigue, ¿cuál es el siguiente paso cuando vuelvas?
5. **Reentrada.** Si cierras con una sesión abierta, al reabrir se muestra esa
   sesión con un aviso neutro y la opción de cerrarla.

### Secciones

Navegación inferior de cuatro pestañas:

- **Hoy** — el recorrido de arriba.
- **Bandeja** — la lista de captura.
- **Semana** — de lunes a hoy, las sesiones cerradas de cada día y, para hoy,
  también lo que queda en el plan. Un día sin sesiones se muestra como tal, sin
  ninguna carga negativa.
- **Progreso** — número de sesiones, tiempo registrado y tareas terminadas, más el
  **registro** completo (fecha, tarea, duración, resultado y siguiente paso). El
  registro no se borra nunca.

### Menú

- **Exportar**: descarga todo el estado como `siguiente.json`.
- **Importar**: valida y reemplaza. Si el archivo es inválido no toca nada y avisa.
- **Borrar todo**: con confirmación.
- **Sincronización** (solo en la URL publicada): pega el token de acceso si el
  Worker lo exige. Se guarda en ese navegador y viaja en la cabecera
  `Authorization`, nunca en la URL.

El indicador junto al menú muestra el estado del guardado. En `file://`:
"Guardado" / "Guardando…" / "No se pudo guardar". En la URL publicada:
"Sincronizado" / "Sincronizando…" / "Guardado solo en este equipo".

## Archivos

```
siguiente/
├── public/            # lo único que se sirve como estático
│   ├── index.html     # interfaz: vistas, estilos (tema oscuro) y adaptadores de almacenamiento
│   ├── core.js        # dominio, casos de uso y serialización; sin DOM y sin reloj propio
│   ├── tests.js       # pruebas del núcleo y mini-runner (Node y navegador)
│   └── tests.html     # runner de pruebas en el navegador
├── worker.js          # Cloudflare Worker: sirve public/ y expone /api/state (sincronización)
├── wrangler.jsonc     # config de Cloudflare Workers (Worker + estáticos + KV)
├── README.md
└── CLAUDE.md          # reglas permanentes del proyecto
```

## Pruebas

- **Node:** `node public/tests.js` — imprime los resultados y termina con código 1
  si algo falla.
- **Navegador:** abre `public/tests.html` con doble clic; pinta verde o rojo.

Las pruebas inyectan un reloj falso, así que casos como "una sesión de 72 horas"
son deterministas.

## Publicación

La app se sirve desde **Cloudflare Workers**: `worker.js` entrega los archivos de
`public/` y atiende una única ruta, `PUT`/`GET /api/state`, que guarda y devuelve
el estado completo como un blob JSON en **Workers KV**. No hay base de datos ni
lógica de dominio en el servidor; el núcleo sigue viviendo solo en el cliente.

Sigue sin `package.json`, sin `node_modules` y sin build: `wrangler` se ejecuta
con `npx`.

Desde `C:\Users\dav\siguiente`:

1. `npx wrangler login` — se abre el navegador para autorizar. En PowerShell, si
   `npx` no carga, usa `npx.cmd`.
2. `npx wrangler kv namespace create SIGUIENTE_KV` — crea el almacén e imprime un
   `id`. Pégalo en `wrangler.jsonc`, en `kv_namespaces[0].id`, sustituyendo
   `REEMPLAZA_CON_EL_ID_DEL_NAMESPACE_KV`.
3. *(Opcional, recomendado si la URL es pública)* `npx wrangler secret put SYNC_TOKEN`
   y escribe una frase larga. Con eso, `/api/state` exige `Authorization: Bearer
   <token>`. En la app, abre **Menú → Sincronización**, pega el token y pulsa
   "Guardar token": queda guardado solo en ese navegador y se envía en la
   cabecera, nunca en la URL.
4. `npx wrangler deploy` — al terminar imprime la URL
   `https://siguiente.TU-SUBDOMINIO.workers.dev`.
5. Abre esa URL en el celular y usa el menú del navegador →
   **"Añadir a pantalla de inicio"**. Ábrela desde el icono.

Sin conexión, la URL no carga; en la PC, `public/index.html` sí funciona offline
y guarda en local.

## Modelo de datos

Estado completo: `schemaVersion` (1), `revision` (sube en cada guardado),
`savedAt`, y las colecciones `tasks`, `plans`, `planItems`, `sessions`.

- **Task**: `id`, `title` (obligatorio), `outcome`, `nextAction`,
  `status` (`inbox` = sin siguiente acción · `active` = con siguiente acción ·
  `done`), `dueDate`, `createdAt`, `updatedAt`.
- **DailyPlan**: `id`, `date` (YYYY-MM-DD local), `note`, `createdAt`.
- **PlanItem**: `id`, `planId`, `taskId`, `order` (entero desde 0).
- **WorkSession**: `id`, `taskId`, `startedAt`, `endedAt` (null mientras está
  abierta), `progress` (`yes` | `some` | `no` | null), `nextStep`.

La sincronización usa `revision`: al cargar, si la copia local va por delante de
la remota, se sube; si no, manda la remota. No hay fusión fina, así que editar sin
conexión en dos dispositivos a la vez puede perder el cambio más antiguo.

## API del núcleo (`SiguienteCore`)

Cada caso de uso recibe `(estado, datos, now)` y devuelve `{ ok: true, state }` o
`{ ok: false, error }` sin mutar el estado recibido ni lanzar excepciones.

- Casos de uso: `captureTask`, `defineTask`, `chooseForToday`, `moveToFirst`,
  `removeFromToday`, `pauseTask`, `rescheduleTask`, `startSession`, `closeSession`,
  `markTaskDone`, `importState`.
- Sin envoltura: `emptyState`, `migrate`, `stampSave`, `exportState`, `uid`.
- Consultas: `inbox`, `todayPlan(date)`, `openSession`, `firstActionOf(date)`,
  `sessionDuration(session, now)`, `taskById(id)`, `closedSessions`,
  `sessionsBetween(startIso, endIso)`, `sessionStats`, `taskTotalDuration(taskId)`.

`core.js` no usa `document`, `window`, `localStorage` ni `Date.now`; recibe el
reloj por inyección y corre igual en Node. `sessionsBetween` recibe marcas ISO ya
calculadas: el núcleo nunca decide qué día es "hoy" ni dónde empieza la semana.

## Fuera de alcance (a revisar en una fase futura)

Revisión semanal asistida, atajos de teclado, deshacer breve tras "Borrar todo",
datos de ejemplo, notificaciones, gamificación y rachas. Un horario de clases
real (aulas, horas) para la vista Semana: sigue siendo un registro de lo
trabajado, no un calendario.

Ideas surgidas al construir; **ninguna se implementa ahora**, el uso decide:

- Un "deshacer" breve tras "Borrar todo" y tras terminar una tarea.
- Validación de esquema más estricta al importar y en el Worker.
- Indicador de guardado con marca de tiempo ("Guardado 14:03").
