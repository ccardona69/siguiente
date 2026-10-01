/* run-qa-cdp.cjs — ejecuta una página de QA en Chrome headless y lee el <title>
   resultante (QA PASS / QA FAIL) por el protocolo DevTools, sin dependencias.
   Uso: node tests/run-qa-cdp.cjs http://localhost:8790/ui-workflow.html */
'use strict';
const { spawn } = require('child_process');
const port = 9333 + (process.pid % 500);
const url = process.argv[2];
const chromePath =
  process.env.QA_CHROME ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
// perfil temporal con el separador del sistema: funciona igual en Windows, macOS y Linux
const profile = require('path').join(
  require('os').tmpdir(),
  'chqa-cdp-' + process.pid + '-' + Date.now(),
);
const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--remote-debugging-port=' + port,
  '--user-data-dir=' + profile,
  'about:blank',
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // espera a que el punto de depuración responda y localiza la pestaña
  let targets = null;
  for (let i = 0; i < 60 && !targets; i++) {
    try {
      targets = await (
        await fetch('http://127.0.0.1:' + port + '/json/list')
      ).json();
    } catch (e) {
      await sleep(250);
    }
  }
  if (!targets) throw new Error('Chrome no expuso el puerto de depuración');
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result);
      pending.delete(m.id);
    }
  };
  const send = (method, params) =>
    new Promise((res) => {
      const id = ++seq;
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable');
  await send('Page.navigate', { url });

  // sondea el título en tiempo real hasta el marcador o 90 s
  let title = '';
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const r = await send('Runtime.evaluate', {
      expression: 'document.title',
      returnByValue: true,
    });
    title = (r && r.result && r.result.value) || '';
    if (/QA (PASS|FAIL)/.test(title)) break;
    await sleep(400);
  }
  console.log(title || '(sin marcador QA)');
  ws.close();
  chrome.kill();
  process.exit(/QA PASS/.test(title) ? 0 : 1);
}

main().catch((e) => {
  console.log('QA ERROR · ' + e.message);
  try {
    chrome.kill();
  } catch (e2) {}
  process.exit(1);
});
