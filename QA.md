# Comprobación de la entrega

## Pruebas automatizadas

- **57 pruebas de modelo y contrato remoto: aprobadas, 0 fallos** (`node --test tests/*.test.cjs`). Se ejecutaron con Node sobre el código fuente incluido. Las pruebas remotas usan fetch simulado; no contactan con ningún servidor. Dos de ellas fijan que las consultas del historial devuelven el mismo orden que antes de optimizarlas, incluidos los empates de hora.
- **39 pruebas del Worker: aprobadas** (`node worker.tests.js`), incluida la política de `public/_headers` (cerrada por defecto; imágenes solo propias o `data:` para el icono en línea).
- **Recorrido de interfaz en Chromium, 320 × 700, 390 × 844, tablet 768 × 1024 y escritorio 1440 × 900: 164 comprobaciones aprobadas en cada tamaño.** Incluye captura, errores, definición de acción, persistencia, tema, sesiones, pausa/reanudación, cierre, búsqueda mensual, texto HTML no ejecutable, edición, reprogramación, recuperación, deshacer, copias JSON, confirmaciones y búsqueda de títulos históricos. También comprueba el título de la pestaña por sección y durante la sesión, que los errores marcan su campo (`aria-invalid`, `aria-describedby`) y le dan el foco, el anuncio de resultados de búsqueda para lectores de pantalla, los límites del calendario del registro y el foco conservado al cambiar de mes, que tema y ajustes no aparecen duplicados a la vista, el icono en línea y el color de la barra del navegador según el tema.
- Los mismos recorridos se repitieron a 390 × 844 y 768 × 1024 con emulación táctil (`isMobile`, `hasTouch`): aprobados. Con pantalla táctil la lista de atajos de teclado de Ajustes se oculta; con ratón o trackpad se muestra.
- Escenarios adicionales aprobados: recarga real, cuota de almacenamiento, formato incompatible, cambios de otra pestaña, paginación y expansión/restauración del registro para imprimir.
- En los escenarios comprobados no se registraron excepciones, errores de consola ni recursos fallidos. El modo local no solicita `/api/state`.
- El ejecutor sin dependencias `tests/run-qa-cdp.cjs` se probó también en Linux con Chromium (`QA_CHROME`).

## Accesibilidad automática

axe-core 4.13 (reglas WCAG 2.0/2.1/2.2 A y AA y buenas prácticas) sobre los 19 escenarios de `.qa/`, a 390 y 1440 px, en tema claro y oscuro: **0 incumplimientos**. Una herramienta automática no sustituye la prueba con un lector de pantalla real.

## Rendimiento con mucho historial

Con 400 tareas y 3000 sesiones, CPU ralentizada 4× en Chromium a 390 × 844 (render + maquetación, mediana de varias pasadas):

| Vista | Antes | Ahora |
| --- | --- | --- |
| Bandeja (abrir) | ≈ 200 ms | ≈ 50 ms |
| Bandeja (cada tecla en la búsqueda) | ≈ 190 ms | ≈ 45 ms |
| Semana | ≈ 65 ms | ≈ 35 ms |
| Progreso | ≈ 60 ms | ≈ 60 ms |

Los resultados de las consultas no cambian; solo se ordena lo que se va a mostrar.

## Mobile-first

- La base CSS corresponde al teléfono; las mejoras de tablet y escritorio usan únicamente `min-width` a 640, 1024 y 1280 px. La única otra consulta de medios nueva es de capacidad (`hover: hover` y `pointer: fine`), no de anchura.
- Se comprobó que la navegación móvil queda fuera del área de contenido, no existe desplazamiento horizontal y los objetivos de navegación miden al menos 44 × 44 px.
- Campos de 16 px; botones principales de ancho completo; áreas seguras contempladas. Portada y sesión más compactas para favorecer el primer viewport; una acción muy larga (más de 180 caracteres) usa un titular más pequeño para que "Empezar sesión" siga a la vista.
- `interactive-widget=resizes-content` solicita ajustar el viewport con el teclado cuando el navegador lo soporta. No se comprobó un teclado físico o el teclado de un dispositivo real.

## Revisión de presentación

Se revisaron capturas de Hoy, Bandeja, Semana, Progreso, edición, ajuste, reprogramación, sesión activa/pausada, cierre y errores, Ajustes e importación. También se revisaron apariencias clara/oscura, pantalla de 320 px, textos largos y controles de sesión activos/pausados. El fallback sin JavaScript se conserva de la entrega anterior.

Para esta entrega se compararon 152 capturas deterministas (19 escenarios × 4 tamaños × 2 temas, reloj fijo) antes y después de cada cambio. Las diferencias son solo las buscadas: titulares y párrafos sin palabras huérfanas, mes del registro escrito como en español ("Octubre de 2026"), flechas e icono de búsqueda en Progreso, borde rojo en el campo con error y, en escritorio, el encabezado sin los botones que ya están en la barra lateral. La fusión de reglas CSS repetidas no cambió ningún píxel.

Las páginas largas se desplazan dentro del área principal en móvil, manteniendo la navegación inferior fuera del contenido. El desplazamiento vertical es intencional. Las etiquetas solo para lectores de pantalla se recortan deliberadamente; no representan desbordamientos visuales.

## Contraste

Los pares comprobados de texto, acciones, estados y campos superan los umbrales AA correspondientes: 4.5:1 para texto normal y 3:1 para bordes de campos significativos. Hay foco visible, etiquetas y estructura semántica. Esto no equivale a una auditoría completa ni a una certificación WCAG.

## Límites de la validación

No se probó Safari/Firefox, un backend real, el diálogo nativo de impresión ni un lector de pantalla específico. La prueba de impresión verifica que se incluyan los registros filtrados y que vuelva la paginación; no certifica un dispositivo físico de impresión. El icono de la pestaña se comprobó en el HTML generado; su aspecto en cada navegador no se verificó a mano.
