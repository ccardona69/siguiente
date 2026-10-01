#!/usr/bin/env python3
"""Genera un HTML autónomo a partir de src/. Sin dependencias de Python."""
from pathlib import Path
root = Path(__file__).resolve().parent
css = (root / 'src/styles.css').read_text(encoding='utf-8')
core = (root / 'src/core.js').read_text(encoding='utf-8')
app = (root / 'src/app.js').read_text(encoding='utf-8')
# Icono de la pestaña (64 px): el de la marca en terracota, en línea para no depender de otro archivo.
ICON = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAYFBMVEWpRyT+/foAAADdtKWwVTXu29KoRyOoRyTPmYSpRiP/AACpRySoRyO9clfBfGL16uOpRiTkxLcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABACOexAAAAIHRSTlP+/wD////RLv9OAb2B////fv8AAAAAAAAAAAAAAAAAALG2rHYAAADUSURBVHja7ZfbDoIwEESnlXbphdv//6yIIJoYKR3QmPS8z8mWkHYHesZLDBZJ2BBliWnMcZcYfkicfxbIzvikkFUgyMItAodM5C4QgDBAe5svsH4UOBA4DWaAcQQNAYUgcoKIwAkCLCcg44U02k4NFZGv1IghDK0iDdMElKEuhr801Jd3dMkGoz5itvKN2qA5W0Afgf+I5/wIJf/bPH2pHnOtMw8L/bQVvrCnWX7RJFfdnl+26XWfLhx85aFLF2GQo4onX32zyvdre79NsaP+92v9vwIscwddxcDAIQAAAABJRU5ErkJggg=='
head = '''<!doctype html>
<html lang="es" data-theme="system">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f5f3ee" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#171513" media="(prefers-color-scheme: dark)">
<meta name="description" content="Siguiente: captura tareas, define un siguiente paso y dedica tu atención. Un espacio de enfoque que guarda tus datos en tu navegador.">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>Siguiente · Un paso a la vez</title>
<link rel="icon" type="image/png" sizes="64x64" href="data:image/png;base64,''' + ICON + '''">
<script>try{var t=localStorage.getItem('siguiente.theme');if(['light','dark','system'].includes(t))document.documentElement.dataset.theme=t;}catch(e){}</script>
'''
html = head + '<style>\n' + css + '\n</style>\n</head>\n<body>\n<a class="skip-link" href="#main-content">Ir al contenido</a>\n<div id="app"></div>\n<div id="announcement" class="toast" role="status" aria-live="polite" aria-atomic="true"></div>\n<div id="sr-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>\n<noscript><style>#app{display:none}</style><div class="noscript"><h1>Siguiente necesita JavaScript.</h1><p>Actívalo en tu navegador para capturar tareas y registrar sesiones. No se envían datos a servidores en la versión local.</p></div></noscript>\n<script>\n' + core + '\n</script>\n<script>\n' + app + '\n</script>\n</body>\n</html>\n'
out = root / 'public' / 'index.html'
out.write_text(html, encoding='utf-8', newline='')
print('public/index.html generado:', out.stat().st_size, 'bytes')
