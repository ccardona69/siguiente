# Siguiente

Sistema personal de un solo usuario para **empezar, avanzar y retomar** tareas.
No responde "¿qué tengo pendiente?", responde **"¿cuál es el siguiente paso que
puedo dar ahora?"**.

Esta es la **Fase 1**: el recorrido mínimo (capturar → definir → elegir para hoy →
trabajar una sesión → cerrarla → retomar).

## Uso

Abre `public/index.html` con doble clic, o entra a la URL publicada (ver
**Publicación**). No necesita instalación ni servidor propio. Los datos se guardan
en el navegador que uses (`localStorage`, clave `siguiente.v1`); no se sincronizan
entre dispositivos hasta la Fase 1.5.

### Recorrido

1. **Capturar.** Escribe en el campo de arriba ("¿Qué quieres avanzar?") y pulsa
   Enter. La tarea entra en la bandeja solo con título.
2. **Bandeja.** Cada tarea tiene "Definir" (resultado deseado opcional + siguiente
   acción obligatoria) y "Elegir para hoy". Si ya está en el plan de hoy, en lugar
   del botón aparece la marca "Hoy".
3. **Hoy.** Muestra una sola acción en grande, "Para: &lt;resultado&gt;" y dos
   botones: "Empezar" y "Ajustar". Debajo, "Después" con el resto del plan; cada
   una con un enlace para subirla al primer lugar.
4. **Sesión.** "Empezar" abre una sesión: acción, hora de inicio y tiempo
   transcurrido (se recalcula solo con las marcas de tiempo). "Listo" abre el
   cierre: ¿Avanzaste? → ¿Terminaste la tarea? → si sigue, ¿cuál es el siguiente
   paso cuando vuelvas?
5. **Reentrada.** Si cierras con una sesión abierta, al reabrir se muestra esa
   sesión con un aviso neutro y la opción de cerrarla.

### Menú

- **Exportar JSON**: descarga todo el estado.
- **Importar JSON**: valida y reemplaza. Si el archivo es inválido no toca nada y
  avisa.
- **Borrar todo**: con confirmación.

El indicador junto a la navegación muestra "Guardado" / "Guardando…" /
"Error al guardar".

## Archivos

```
siguiente/
├── public/            # lo único que se publica
│   ├── index.html     # interfaz: vistas, estilos y adaptador de almacenamiento
│   ├── core.js        # dominio, casos de uso y serialización; sin DOM y sin reloj propio
│   ├── tests.js       # pruebas del núcleo y mini-runner (Node y navegador)
│   └── tests.html     # runner de pruebas en el navegador
├── wrangler.jsonc     # config de Cloudflare Workers (Worker de solo estáticos)
├── README.md
└── CLAUDE.md           # reglas permanentes del proyecto
```

## Pruebas

- **Node:** `node public/tests.js` — imprime los resultados y termina con código 1
  si algo falla.
- **Navegador:** abre `public/tests.html` con doble clic; pinta verde o rojo.

Las pruebas inyectan un reloj falso, así que casos como "una sesión de 72 horas"
son deterministas.

## Publicación

La app se sirve desde **Cloudflare Workers** como archivos estáticos: solo se
publica la carpeta `public/`. No hay servidor, base de datos ni API (eso es la
Fase 1.5).

Desde `C:\Users\dav\siguiente`:

1. `npx wrangler login` — se abre el navegador para autorizar. En PowerShell, si
   `npx` no carga, usa `npx.cmd`.
2. `npx wrangler deploy` — al terminar imprime la URL
   `https://siguiente.TU-SUBDOMINIO.workers.dev`.
3. Abre esa URL en el celular y usa el menú del navegador →
   **"Añadir a pantalla de inicio"** (iPhone: Safari → compartir → "Añadir a
   pantalla de inicio"). Ábrela desde el icono.

Sin conexión, la URL no carga hasta la Fase 1.5; en la PC, `public/index.html`
sí funciona offline.

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

## API del núcleo (`SiguienteCore`)

Cada caso de uso recibe `(estado, datos, now)` y devuelve `{ ok: true, state }` o
`{ ok: false, error }` sin mutar el estado recibido ni lanzar excepciones.

- Casos de uso: `captureTask`, `defineTask`, `chooseForToday`, `moveToFirst`,
  `removeFromToday`, `startSession`, `closeSession`, `markTaskDone`, `importState`.
- Sin envoltura: `emptyState`, `migrate`, `stampSave`, `exportState`, `uid`.
- Consultas: `inbox`, `todayPlan(date)`, `openSession`, `firstActionOf(date)`,
  `sessionDuration(session, now)`.

`core.js` no usa `document`, `window`, `localStorage` ni `Date.now`; recibe el
reloj por inyección y corre igual en Node. El identificador se genera con `uid()`
(aleatorio + contador + tiempo del reloj inyectado, en base36).

## Fuera de la Fase 1

Pausar, retomar, reprogramar, menú de ajuste completo, revisión, tema oscuro,
atajos, deshacer, datos de ejemplo, notificaciones y sincronización.

## Propuestas (a revisar en la Fase 3)

Ideas surgidas al construir la Fase 1. **Ninguna se implementa ahora**: se revisan
en la Fase 3, con dos semanas de uso real. El uso decide, no la lista.

- Restaurar el foco en el campo de captura para encadenar varias tareas sin volver
  a hacer clic.
- Un "deshacer" breve tras "Borrar todo" y tras terminar una tarea.
- Mostrar la duración total acumulada de una tarea (suma de sus sesiones).
- Distinguir en la Bandeja las tareas sin siguiente acción de las que ya la tienen.
- Validación de esquema más estricta al importar (tipos de cada campo, no solo que
  las colecciones sean arrays).
- Atajos de teclado para "Empezar" / "Listo" y foco automático en la pregunta del
  cierre.
- Indicador de guardado con marca de tiempo ("Guardado 14:03").
- En `tests.html`, un botón para re-ejecutar sin recargar y la duración de la
  suite.
