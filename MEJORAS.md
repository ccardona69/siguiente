# Mejoras propuestas

Lista aparte según las reglas del proyecto. Las propuestas implementadas se
indican junto a su título. Cada propuesta respeta los principios de producto
(cero presión, cero notificaciones, cero gamificación, cifras neutras) y la
regla técnica de cero dependencias. El dueño decide qué pasa a una fase.

---

## 1. Total de minutos del día en la vista Semana (ya presente en el frontend mobile-first)

- **Estado**: la vista Semana actual muestra bajo cada día con sesiones una cifra
  neutra ("35 min registrados") calculada con `sessionsTotalDuration`; los días
  sin sesiones no llevan cifra.
- **Problema**: Semana lista las sesiones de cada día, pero para saber "¿cuánto
  trabajé el martes?" hay que sumar a mano las duraciones.
- **Propuesta**: junto a la fecha de cada día, una cifra neutra con el total
  del día (p. ej. "martes 23 · 1 h 45 m"), calculada con `sessionDuration`
  sobre las sesiones ya guardadas. Un día sin sesiones sigue mostrándose como
  tal, sin cifra y sin carga negativa.
- **Archivos**: `src/core.js` (consulta), `src/app.js` (render),
  `tests/core.test.cjs` (pruebas).
- **Esfuerzo**: pequeño (S).

## 2. Buscador en el registro de Progreso (implementada en Fase 7)

- **Problema**: el registro nunca se borra; con meses de uso, encontrar una
  sesión antigua exige desplazarse de largo.
- **Propuesta**: un campo de texto sobre el registro que filtre por título de
  tarea, resultado o siguiente paso, y dos flechas de mes para acotar por fecha.
  Solo lectura: filtra lo que ya se pinta, no toca el estado ni añade casos de
  uso de dominio.
- **Archivos**: `src/app.js` (campo + filtro en el render).
- **Esfuerzo**: pequeño-medio (S/M).

## 3. Atajo de teclado para capturar desde cualquier vista (implementada en Fase 7)

- **Problema**: capturar requiere volver a Hoy. El principio del producto dice
  que capturar debe costar lo mínimo (solo el título).
- **Propuesta**: extender los atajos de Fase 5 con la tecla `n` que
  lleve el foco al campo de captura aunque se esté en Bandeja, Semana o
  Progreso. Si hay una sesión abierta con confirmación pendiente, no interfiere.
- **Archivos**: `src/app.js` (manejador de teclado existente).
- **Esfuerzo**: pequeño (S).

## 4. Impresión del registro (hoja de papel) (implementada en Fase 7)

- **Problema**: el registro es el archivo permanente del sistema, pero está
  atrapado en la pantalla; no hay forma de guardarlo en papel o PDF sin
  capturas.
- **Propuesta**: una hoja de estilos `@media print` que deje el registro en una
  columna limpia (fecha, tarea, duración, resultado, siguiente paso) y oculte
  navegación y botones. El propio navegador hace el PDF. Cero JavaScript.
- **Archivos**: `src/styles.css` (bloque `@media print`).
- **Esfuerzo**: pequeño (S).

## 5. Manifest de PWA para el icono en "Añadir a pantalla de inicio"

- **Problema**: el README indica añadir la URL al inicio del celular, pero el
  icono resultante es una captura genérica de la página.
- **Avance**: la pestaña ya tiene icono propio (la flecha de la marca sobre
  terracota, PNG en línea generado por `build.py`; la CSP de `public/_headers`
  admite `img-src data:` para mostrarlo). Falta el manifest.
- **Propuesta**: un `manifest.webmanifest` mínimo servido por el Worker (nombre,
  colores crema/terracota del tema, el mismo icono a 192 y 512 px) y la
  etiqueta correspondiente que genera `build.py`. Sin service worker: la app
  sigue sin funcionar offline en la URL (como hoy) y no se promete lo que no hay.
- **Archivos**: `worker.js` (servir el manifest), `build.py` (etiqueta e icono).
- **Esfuerzo**: medio (M).

## 6. Chequeo de integridad en Importar (implementada en Fase 7)

- **Problema**: Importar rechaza los archivos de una versión futura, pero el
  aviso genérico no explica que se necesita actualizar la app.
- **Propuesta**: si el `schemaVersion` del archivo es mayor que el de la app,
  Importar avisa "Este archivo es de una versión más nueva de Siguiente.
  Actualiza la app antes de importarlo." y lo rechaza siempre. Solo cambia el
  aviso de la interfaz; sin confirmación ni migración nueva.
- **Archivos**: `src/app.js` (aviso en el flujo de Importar).
- **Esfuerzo**: pequeño (S).

## 7. Un solo acento por pantalla también en Bandeja

- **Problema**: cada tarea pendiente de Bandeja lleva su propio botón
  "Elegir para hoy" relleno en terracota. Con varias tareas, el acento se
  repite en toda la lista y rompe la regla visual "el acento se gasta en un solo
  sitio principal por pantalla".
- **Propuesta**: en la lista, "Elegir para hoy" con el estilo sereno
  (`btn--quiet`) y el relleno terracota solo cuando la Bandeja tiene una única
  tarea lista para elegir, o nunca. Sin cambiar textos ni flujo.
- **Archivos**: `src/app.js` (clase del botón), `src/styles.css` si hace falta.
- **Esfuerzo**: pequeño (S). Es una decisión de lenguaje visual: la toma el dueño.

## 8. Flecha propia en el selector de estado de Bandeja

- **Problema**: el `<select>` de estado usa la flecha nativa de cada sistema;
  es el único control que no sigue el trazo de los iconos propios.
- **Propuesta**: `appearance: none` y una flecha dibujada con CSS (bordes de un
  pseudoelemento en un contenedor), sin SVG en `data:` para no introducir URLs
  de espacio de nombres en `src/`. Conservar el foco visible y el tamaño de
  16 px.
- **Archivos**: `src/styles.css`, `src/app.js` (contenedor del select).
- **Esfuerzo**: pequeño (S).

## 9. Avisos breves sin mover su región en el DOM

- **Problema**: el aviso breve (`#announcement`) se reubica dentro de la vista
  en cada repintado. Algunos lectores de pantalla dejan de anunciar una región
  `aria-live` que cambia de sitio.
- **Propuesta**: dejar `#announcement` fijo en `body` y colocarlo solo con CSS;
  los anuncios que no necesitan verse ya usan la región fija `#sr-status`.
- **Archivos**: `src/app.js` (render), `src/styles.css` (posición del aviso).
- **Esfuerzo**: pequeño (S). Requiere probarlo con VoiceOver y NVDA.
