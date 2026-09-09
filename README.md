# Siguiente

Sistema personal de un solo usuario para **empezar, avanzar y retomar** tareas.
No responde "¿qué tengo pendiente?", responde **"¿cuál es el siguiente paso que
puedo dar ahora?"**.

Esta es la **Fase 1**: el recorrido mínimo (capturar → definir → elegir para hoy →
trabajar una sesión → cerrarla → retomar).

## Uso

Abre `index.html` con doble clic. No necesita internet, ni instalación, ni
servidor. Los datos se guardan en el navegador (`localStorage`, clave
`siguiente.v1`) y solo en este equipo.

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

| Archivo      | Contenido                                                        |
|--------------|-----------------------------------------------------------------|
| `index.html` | Interfaz: vistas, estilos y adaptador de almacenamiento.        |
| `core.js`    | Dominio, casos de uso y serialización. Sin DOM y sin reloj propio. |
| `tests.js`   | Pruebas del núcleo y mini-runner (Node y navegador).            |
| `tests.html` | Runner de pruebas en el navegador.                              |
| `CLAUDE.md`  | Reglas permanentes del proyecto.                                |

## Pruebas

- **Node:** `node tests.js` — imprime los resultados y termina con código 1 si
  algo falla.
- **Navegador:** abre `tests.html` con doble clic; pinta verde o rojo.

Las pruebas inyectan un reloj falso, así que casos como "una sesión de 72 horas"
son deterministas.

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
