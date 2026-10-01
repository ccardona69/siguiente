#!/usr/bin/env python3
"""Genera public/index.html y worker.dist.js a partir de src/. Sin dependencias."""
from pathlib import Path

root = Path(__file__).resolve().parent
css = (root / 'src/styles.css').read_text(encoding='utf-8')
core = (root / 'src/core.js').read_text(encoding='utf-8')
app = (root / 'src/app.js').read_text(encoding='utf-8')
server = (root / 'src/server.js').read_text(encoding='utf-8')

head = '''<!doctype html>
<html lang="es" data-theme="system">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f5f3ee">
<meta name="description" content="Siguiente: captura tareas, define un siguiente paso y dedica tu atención. Un espacio de enfoque que guarda tus datos en tu navegador.">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>Siguiente · Un paso a la vez</title>
<script>try{var t=localStorage.getItem('siguiente.theme');if(['light','dark','system'].includes(t))document.documentElement.dataset.theme=t;}catch(e){}</script>
'''
html = head + '<style>\n' + css + '\n</style>\n</head>\n<body>\n<a class="skip-link" href="#main-content">Ir al contenido</a>\n<div id="app"></div>\n<div id="announcement" class="toast" role="status" aria-live="polite" aria-atomic="true"></div>\n<noscript><style>#app{display:none}</style><div class="noscript"><h1>Siguiente necesita JavaScript.</h1><p>Actívalo en tu navegador para capturar tareas y registrar sesiones. No se envían datos a servidores en la versión local.</p></div></noscript>\n<script>\n' + core + '\n</script>\n<script>\n' + app + '\n</script>\n</body>\n</html>\n'

out = root / 'public' / 'index.html'
with open(out, 'w', encoding='utf-8', newline='') as f:
    f.write(html)
print('public/index.html generado:', out.stat().st_size, 'bytes')

# el Worker desplegado es un solo archivo: el núcleo delante y el servidor detrás,
# así el servidor valida con el mismo SiguienteCore que usa la app
# (el bundle es ESM: se retira la exportación CommonJS del núcleo, que ahí queda
# muerta y dispara un aviso de esbuild al desplegar; en Node los tests usan src/)
cjs_export = "  if (typeof module !== 'undefined' && module.exports) module.exports = api;\n"
assert cjs_export in core, 'src/core.js ya no tiene la exportación CommonJS esperada'
dist = root / 'worker.dist.js'
with open(dist, 'w', encoding='utf-8', newline='') as f:
    f.write(core.replace(cjs_export, '') + '\n' + server)
print('worker.dist.js generado:', dist.stat().st_size, 'bytes')
