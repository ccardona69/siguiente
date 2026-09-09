# Siguiente — reglas del proyecto

## Qué es
Sistema personal de un solo usuario para empezar, avanzar y retomar tareas. Responde "¿cuál es el siguiente paso que puedo dar ahora?", no "¿qué tengo pendiente?". Proyecto personal: claridad y mantenibilidad antes que generalidad.

## Principios de producto (no negociables)
- Solo el título es obligatorio al capturar; nada más puede bloquear la captura.
- La pantalla principal muestra UNA acción, el resultado al que sirve, y dos botones: "Empezar" y "Ajustar".
- Fecha límite y fecha de trabajo son distintas; reprogramar nunca cambia el vencimiento.
- El historial no se borra ni se reinicia: las sesiones se conservan aunque la tarea cambie o termine.
- La duración de una sesión se calcula con marcas de tiempo, nunca con un temporizador en memoria.
- Un día sin registros no es un incumplimiento. Ningún texto culpa, presiona ni habla de rachas o fallos.
- Cero notificaciones salvo petición explícita del dueño del proyecto.
- Fuera de alcance salvo petición explícita: gamificación, rachas, IA, calendarios, recordatorios, estadísticas, cuentas, multiusuario, backend, sincronización (hasta la Fase 1.5).

## Reglas técnicas
- Archivos de la app en public/: index.html (interfaz), core.js (dominio + casos de uso + serialización, sin DOM), tests.js (pruebas), tests.html (runner en navegador). En la raíz: README.md, CLAUDE.md y wrangler.jsonc (config de Cloudflare Workers, Worker de solo estáticos que sirve public/).
- Cero dependencias, cero build, cero CDN, cero red. Sin package.json, sin node_modules, sin npm install, sin TypeScript, sin frameworks de UI ni de pruebas. Todo funciona abriendo public/index.html con doble clic, sin internet.
- Scripts clásicos (script src). Prohibido import/export: los módulos ES no cargan desde file://. core.js expone un único objeto global "SiguienteCore" mediante globalThis y, si existe module.exports, también lo exporta.
- core.js no puede mencionar document, window, localStorage, alert, setTimeout ni Date.now. Recibe el reloj now() por inyección y debe ejecutarse en Node sin cambios.
- Ids con un uid() propio (aleatorio + tiempo en base36).
- Patrón estado → render. El estado es la única fuente de verdad. Cada caso de uso recibe el estado y los datos y devuelve el nuevo estado o un error descriptivo como valor (sin excepciones), sin mutar el estado recibido. La interfaz repinta todo tras cada cambio.
- La interfaz nunca llama a localStorage directamente: usa un adaptador de almacenamiento con dos operaciones asíncronas, load() (estado o null) y save(state). Hoy el único adaptador es LocalStorageAdapter (clave "siguiente.v1"); en la Fase 1.5 se añadirá uno remoto sin tocar core.js ni las vistas. Se guarda solo cuando el estado cambia.
- El núcleo nunca calcula "hoy": la interfaz le pasa la fecha local (YYYY-MM-DD) y el reloj.
- schemaVersion dentro del estado y función migrate() preparada para versiones futuras.
- Todo texto escrito por la persona se escapa antes de insertarlo en HTML.
- JavaScript vanilla ES2020, CSS propio con variables. Identificadores en inglés; textos de interfaz y comentarios en español. Funciones cortas; un comentario de una línea al inicio de cada bloque.
- Archivos completos: sin fragmentos, sin TODOs.

## Forma de trabajo
- Trabajar solo en el alcance de la fase indicada. Ante ambigüedad, preguntar antes de inventar. Las mejoras se proponen en una lista aparte; no se implementan.
- Antes de escribir código, presentar un plan breve y esperar confirmación.
- Antes de entregar: node public/tests.js en verde, grep de palabras prohibidas en public/core.js sin resultados, grep -rnE "https?://" public/ sin resultados, commit con mensaje descriptivo.
- Cada fase termina con un commit etiquetado (fase-1, fase-1.5, fase-2...).
