# Mejoras propuestas

Lista aparte según las reglas del proyecto. Las propuestas implementadas se
indican junto a su título. Cada propuesta respeta los principios de producto
(cero presión, cero notificaciones, cero gamificación, cifras neutras) y la
regla técnica de cero dependencias. El dueño decide qué pasa a una fase.

---

## 1. Total de minutos del día en la vista Semana

- **Problema**: Semana lista las sesiones de cada día, pero para saber "¿cuánto
  trabajé el martes?" hay que sumar a mano las duraciones.
- **Propuesta**: junto a la fecha de cada día, una cifra neutra con el total
  del día (p. ej. "martes 23 · 1 h 45 m"), calculada con `sessionDuration`
  sobre las sesiones ya guardadas. Un día sin sesiones sigue mostrándose como
  tal, sin cifra y sin carga negativa.
- **Archivos**: `public/core.js` (una consulta `dayTotals`), `public/index.html`
  (render), `public/tests.js` (3–4 pruebas).
- **Esfuerzo**: pequeño (S).

## 2. Buscador en el registro de Progreso (implementada en Fase 7)

- **Problema**: el registro nunca se borra; con meses de uso, encontrar una
  sesión antigua exige desplazarse de largo.
- **Propuesta**: un campo de texto sobre el registro que filtre por título de
  tarea, resultado o siguiente paso, y dos flechas de mes para acotar por fecha.
  Solo lectura: filtra lo que ya se pinta, no toca el estado ni añade casos de
  uso de dominio.
- **Archivos**: `public/index.html` (campo + filtro en el render).
- **Esfuerzo**: pequeño-medio (S/M).

## 3. Atajo de teclado para capturar desde cualquier vista (implementada en Fase 7)

- **Problema**: capturar requiere volver a Hoy. El principio del producto dice
  que capturar debe costar lo mínimo (solo el título).
- **Propuesta**: extender los atajos de Fase 5 con la tecla `n` que
  lleve el foco al campo de captura aunque se esté en Bandeja, Semana o
  Progreso. Si hay una sesión abierta con confirmación pendiente, no interfiere.
- **Archivos**: `public/index.html` (manejador de teclado existente).
- **Esfuerzo**: pequeño (S).

## 4. Impresión del registro (hoja de papel) (implementada en Fase 7)

- **Problema**: el registro es el archivo permanente del sistema, pero está
  atrapado en la pantalla; no hay forma de guardarlo en papel o PDF sin
  capturas.
- **Propuesta**: una hoja de estilos `@media print` que deje el registro en una
  columna limpia (fecha, tarea, duración, resultado, siguiente paso) y oculte
  navegación y botones. El propio navegador hace el PDF. Cero JavaScript.
- **Archivos**: `public/index.html` (bloque `@media print`).
- **Esfuerzo**: pequeño (S).

## 5. Manifest de PWA para el icono en "Añadir a pantalla de inicio"

- **Problema**: el README indica añadir la URL al inicio del celular, pero el
  icono resultante es una captura genérica de la página.
- **Propuesta**: un `manifest.webmanifest` mínimo servido por el Worker (nombre,
  colores del tema taller/terracota, icono inline en data-URL) y la etiqueta
  correspondiente en `index.html`. Sin service worker: la app sigue sin
  funcionar offline en la URL (como hoy) y no se promete lo que no hay.
- **Archivos**: `worker.js` (servir el manifest), `public/index.html` (etiqueta).
- **Esfuerzo**: medio (M).

## 6. Chequeo de integridad en Importar (implementada en Fase 7)

- **Problema**: Importar rechaza los archivos de una versión futura, pero el
  aviso genérico no explica que se necesita actualizar la app.
- **Propuesta**: si el `schemaVersion` del archivo es mayor que el de la app,
  Importar avisa "Este archivo es de una versión más nueva de Siguiente.
  Actualiza la app antes de importarlo." y lo rechaza siempre. Solo cambia el
  aviso de la interfaz; sin confirmación ni migración nueva.
- **Archivos**: `public/index.html` (aviso en el flujo de Importar).
- **Esfuerzo**: pequeño (S).
