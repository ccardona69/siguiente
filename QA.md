# Comprobación de la entrega

## Pruebas automatizadas

- **55 pruebas de modelo y contrato remoto: aprobadas, 0 fallos.** Se ejecutaron con Node sobre el código fuente incluido. Las pruebas remotas usan fetch simulado; no contactan con ningún servidor.
- **Recorrido de interfaz en Chromium, 320 × 700, 390 × 844, tablet 768 × 1024 y escritorio 1440 × 900: 147 comprobaciones aprobadas en cada tamaño.** Incluye captura, errores, definición de acción, persistencia, tema, sesiones, pausa/reanudación, cierre, búsqueda mensual, texto HTML no ejecutable, edición, reprogramación, recuperación, deshacer, copias JSON, confirmaciones y búsqueda de títulos históricos.
- Escenarios adicionales aprobados: recarga real, cuota de almacenamiento, formato incompatible, cambios de otra pestaña, paginación y expansión/restauración del registro para imprimir.
- En los escenarios comprobados no se registraron excepciones, errores de consola ni recursos fallidos. El modo local no solicita `/api/state`.

## Mobile-first

- La base CSS corresponde al teléfono; las mejoras de tablet y escritorio usan únicamente `min-width` a 640, 1024 y 1280 px.
- Se comprobó que la navegación móvil queda fuera del área de contenido, no existe desplazamiento horizontal y los objetivos de navegación miden al menos 44 × 44 px.
- Campos de 16 px; botones principales de ancho completo; áreas seguras contempladas. Portada y sesión más compactas para favorecer el primer viewport.
- `interactive-widget=resizes-content` solicita ajustar el viewport con el teclado cuando el navegador lo soporta. No se comprobó un teclado físico o el teclado de un dispositivo real.

## Revisión de presentación

Se revisaron capturas de Hoy, Bandeja, Semana, Progreso, edición, ajuste, reprogramación, sesión activa/pausada, cierre y errores, Ajustes e importación. También se revisaron apariencias clara/oscura, pantalla de 320 px, textos largos y controles de sesión activos/pausados. El fallback sin JavaScript se conserva de la entrega anterior.

Las páginas largas se desplazan dentro del área principal en móvil, manteniendo la navegación inferior fuera del contenido. El desplazamiento vertical es intencional. Las etiquetas solo para lectores de pantalla se recortan deliberadamente; no representan desbordamientos visuales.

## Contraste

Los pares comprobados de texto, acciones, estados y campos superan los umbrales AA correspondientes: 4.5:1 para texto normal y 3:1 para bordes de campos significativos. Hay foco visible, etiquetas y estructura semántica. Esto no equivale a una auditoría completa ni a una certificación WCAG.

## Límites de la validación

No se probó Safari/Firefox, un backend real, el diálogo nativo de impresión ni un lector de pantalla específico. La prueba de impresión verifica que se incluyan los registros filtrados y que vuelva la paginación; no certifica un dispositivo físico de impresión.
