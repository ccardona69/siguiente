/* tests.js — pruebas del núcleo de "Siguiente" y mini-runner propio.
   Funciona en Node ("node tests.js", código de salida 1 si algo falla)
   y en el navegador (tests.html pinta verde/rojo). El reloj es siempre falso. */
(function () {
  'use strict';

  // carga del núcleo según el entorno
  var Core = (typeof require !== 'undefined') ? require('./core.js') : globalThis.SiguienteCore;

  var results = [];

  // registra una prueba y captura su fallo como dato
  function test(name, fn) {
    try {
      fn();
      results.push({ name: name, ok: true });
    } catch (e) {
      results.push({ name: name, ok: false, error: (e && e.message) || String(e) });
    }
  }

  // aserción simple
  function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'condición falsa');
  }

  // aserción de igualdad profunda, sin depender del orden de las claves
  function assertEqual(a, b, msg) {
    if (!deepEqual(a, b)) {
      throw new Error((msg || 'no coinciden') + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b));
    }
  }

  // igualdad profunda tras normalizar el orden de las claves
  function deepEqual(a, b) {
    return JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b));
  }

  // ordena recursivamente las claves de los objetos para comparar
  function sortDeep(value) {
    if (Array.isArray(value)) return value.map(sortDeep);
    if (value && typeof value === 'object') {
      var out = {};
      Object.keys(value).sort().forEach(function (k) { out[k] = sortDeep(value[k]); });
      return out;
    }
    return value;
  }

  // reloj falso: devuelve una marca fija que las pruebas pueden mover
  function fakeClock(iso) {
    var current = iso;
    var f = function () { return current; };
    f.set = function (next) { current = next; };
    f.advanceHours = function (h) {
      current = new Date(new Date(current).getTime() + h * 3600 * 1000).toISOString();
    };
    return f;
  }

  // estado sembrado: una tarea definida y elegida para hoy, con sesión abierta si se pide
  function seed(clock, opts) {
    opts = opts || {};
    var s = Core.emptyState();
    s = Core.captureTask(s, { title: opts.title || 'Escribir el informe' }, clock()).state;
    var id = s.tasks[0].id;
    s = Core.defineTask(s, {
      taskId: id,
      outcome: opts.outcome || 'Informe entregado',
      nextAction: opts.nextAction || 'Abrir el documento'
    }, clock()).state;
    if (opts.today !== false) {
      s = Core.chooseForToday(s, { taskId: id, date: opts.date || '2026-01-01' }, clock()).state;
    }
    if (opts.session) {
      s = Core.startSession(s, { taskId: id }, clock()).state;
    }
    return { state: s, id: id, date: opts.date || '2026-01-01' };
  }

  var ISO = '2026-01-01T09:00:00.000Z';

  // --- captura ---

  test('captureTask rechaza título vacío', function () {
    var r = Core.captureTask(Core.emptyState(), { title: '' }, ISO);
    assert(r.ok === false, 'debe fallar');
    assert(typeof r.error === 'string' && r.error.length > 0, 'error descriptivo');
  });

  test('captureTask rechaza título de solo espacios', function () {
    var r = Core.captureTask(Core.emptyState(), { title: '   ' }, ISO);
    assert(r.ok === false, 'debe fallar');
  });

  test('captureTask crea una tarea en la bandeja con marcas de tiempo', function () {
    var r = Core.captureTask(Core.emptyState(), { title: '  Comprar pan  ' }, ISO);
    assert(r.ok === true, 'debe funcionar');
    var t = r.state.tasks[0];
    assertEqual(t.title, 'Comprar pan', 'título recortado');
    assertEqual(t.status, 'inbox', 'entra como inbox');
    assertEqual(t.outcome, null);
    assertEqual(t.nextAction, null);
    assertEqual(t.dueDate, null);
    assertEqual(t.createdAt, ISO);
    assertEqual(t.updatedAt, ISO);
    assert(typeof t.id === 'string' && t.id.length > 0, 'id presente');
  });

  test('captureTask guarda las etiquetas HTML como texto literal', function () {
    var r = Core.captureTask(Core.emptyState(), { title: '<b>hola</b> & <i>chau</i>' }, ISO);
    assertEqual(r.state.tasks[0].title, '<b>hola</b> & <i>chau</i>', 'el núcleo no escapa');
  });

  test('captureTask no muta el estado recibido', function () {
    var s = Core.emptyState();
    var snap = JSON.stringify(s);
    Core.captureTask(s, { title: 'x' }, ISO);
    assertEqual(JSON.stringify(s), snap, 'estado intacto');
  });

  // --- definición ---

  test('defineTask exige la siguiente acción', function () {
    var s = Core.captureTask(Core.emptyState(), { title: 'Tarea' }, ISO).state;
    var r = Core.defineTask(s, { taskId: s.tasks[0].id, nextAction: '  ' }, ISO);
    assert(r.ok === false, 'debe fallar');
  });

  test('defineTask fija acción y resultado y pasa la tarea a active', function () {
    var s = Core.captureTask(Core.emptyState(), { title: 'Tarea' }, ISO).state;
    var later = '2026-01-02T10:00:00.000Z';
    var r = Core.defineTask(s, {
      taskId: s.tasks[0].id, outcome: '  Meta  ', nextAction: '  Primer paso  '
    }, later);
    assert(r.ok === true);
    var t = r.state.tasks[0];
    assertEqual(t.nextAction, 'Primer paso');
    assertEqual(t.outcome, 'Meta');
    assertEqual(t.status, 'active');
    assertEqual(t.updatedAt, later);
    assertEqual(t.createdAt, ISO, 'createdAt no cambia');
  });

  test('defineTask con resultado vacío lo deja en null', function () {
    var s = Core.captureTask(Core.emptyState(), { title: 'Tarea' }, ISO).state;
    var r = Core.defineTask(s, { taskId: s.tasks[0].id, outcome: '', nextAction: 'Paso' }, ISO);
    assertEqual(r.state.tasks[0].outcome, null);
  });

  // --- elegir para hoy ---

  test('chooseForToday exige siguiente acción', function () {
    var s = Core.captureTask(Core.emptyState(), { title: 'Sin definir' }, ISO).state;
    var r = Core.chooseForToday(s, { taskId: s.tasks[0].id, date: '2026-01-01' }, ISO);
    assert(r.ok === false, 'debe fallar por falta de acción');
  });

  test('chooseForToday crea plan e item con order 0', function () {
    var d = seed(fakeClock(ISO), { session: false });
    var plan = d.state.plans[0];
    assertEqual(d.state.plans.length, 1);
    assertEqual(d.state.planItems.length, 1);
    assertEqual(d.state.planItems[0].planId, plan.id);
    assertEqual(d.state.planItems[0].taskId, d.id);
    assertEqual(d.state.planItems[0].order, 0);
    assertEqual(plan.date, '2026-01-01');
  });

  test('chooseForToday dos veces no duplica la tarea', function () {
    var d = seed(fakeClock(ISO), { session: false });
    var r = Core.chooseForToday(d.state, { taskId: d.id, date: '2026-01-01' }, ISO);
    assert(r.ok === true, 'segunda vez también es ok');
    assertEqual(r.state.planItems.length, 1, 'sigue habiendo un solo item');
  });

  test('chooseForToday añade una segunda tarea con order 1', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: false });
    var s = Core.captureTask(d.state, { title: 'Segunda' }, clock()).state;
    var id2 = s.tasks[s.tasks.length - 1].id;
    s = Core.defineTask(s, { taskId: id2, nextAction: 'Arrancar' }, clock()).state;
    s = Core.chooseForToday(s, { taskId: id2, date: d.date }, clock()).state;
    var items = s.planItems.slice().sort(function (a, b) { return a.order - b.order; });
    assertEqual(items.length, 2);
    assertEqual(items[1].taskId, id2);
    assertEqual(items[1].order, 1);
  });

  test('chooseForToday rechaza una tarea terminada', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: false });
    var s = Core.markTaskDone(d.state, { taskId: d.id }, clock()).state;
    var r = Core.chooseForToday(s, { taskId: d.id, date: d.date }, clock());
    assert(r.ok === false, 'debe fallar');
  });

  // --- orden del plan ---

  test('moveToFirst sube la tarea a order 0 y renumera el resto', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: false });
    var s = Core.captureTask(d.state, { title: 'Segunda' }, clock()).state;
    var id2 = s.tasks[s.tasks.length - 1].id;
    s = Core.defineTask(s, { taskId: id2, nextAction: 'Arrancar' }, clock()).state;
    s = Core.chooseForToday(s, { taskId: id2, date: d.date }, clock()).state;
    var r = Core.moveToFirst(s, { date: d.date, taskId: id2 });
    assert(r.ok === true);
    var items = r.state.planItems.slice().sort(function (a, b) { return a.order - b.order; });
    assertEqual(items[0].taskId, id2, 'la segunda pasa a primera');
    assertEqual(items[0].order, 0);
    assertEqual(items[1].taskId, d.id);
    assertEqual(items[1].order, 1);
  });

  test('removeFromToday quita el item y renumera desde 0', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: false });
    var s = Core.captureTask(d.state, { title: 'Segunda' }, clock()).state;
    var id2 = s.tasks[s.tasks.length - 1].id;
    s = Core.defineTask(s, { taskId: id2, nextAction: 'Arrancar' }, clock()).state;
    s = Core.chooseForToday(s, { taskId: id2, date: d.date }, clock()).state;
    var r = Core.removeFromToday(s, { date: d.date, taskId: d.id });
    assert(r.ok === true);
    var items = r.state.planItems.slice().sort(function (a, b) { return a.order - b.order; });
    assertEqual(items.length, 1);
    assertEqual(items[0].taskId, id2);
    assertEqual(items[0].order, 0);
  });

  test('removeFromToday sin plan es un no-op correcto', function () {
    var r = Core.removeFromToday(Core.emptyState(), { date: '2026-01-01', taskId: 'x' });
    assert(r.ok === true);
    assertEqual(r.state.planItems.length, 0);
  });

  // --- sesiones ---

  test('startSession abre una sesión con la marca de inicio', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: false });
    var r = Core.startSession(d.state, { taskId: d.id }, clock());
    assert(r.ok === true);
    var s = r.state.sessions[0];
    assertEqual(s.taskId, d.id);
    assertEqual(s.startedAt, ISO);
    assertEqual(s.endedAt, null);
    assertEqual(s.progress, null);
    assertEqual(s.nextStep, null);
  });

  test('startSession con otra sesión abierta es rechazada', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: true });
    var r = Core.startSession(d.state, { taskId: d.id }, clock());
    assert(r.ok === false, 'debe fallar');
    assert(/abierta/i.test(r.error), 'mensaje claro');
  });

  test('openSession devuelve la sesión abierta y null cuando no hay', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: true });
    assert(Core.openSession(d.state) !== null, 'hay una abierta');
    clock.advanceHours(1);
    var closed = Core.closeSession(d.state, { progress: 'yes', finished: true }, clock()).state;
    assertEqual(Core.openSession(closed), null, 'ya no hay abierta');
  });

  test('sessionDuration reporta 72 horas para una sesión de 3 días, sin error', function () {
    var clock = fakeClock('2026-01-01T09:00:00.000Z');
    var d = seed(clock, { session: true });
    clock.advanceHours(72);
    var r = Core.closeSession(d.state, { progress: 'some', finished: false, nextStep: '' }, clock());
    assert(r.ok === true, 'cierra sin error');
    var sess = r.state.sessions[0];
    assertEqual(sess.startedAt, '2026-01-01T09:00:00.000Z');
    assertEqual(sess.endedAt, '2026-01-04T09:00:00.000Z');
    assertEqual(Core.sessionDuration(sess, clock()), 72 * 3600 * 1000, '72 h en ms');
  });

  test('sessionDuration cruza el cambio de mes sin error', function () {
    var clock = fakeClock('2026-01-30T12:00:00.000Z');
    var d = seed(clock, { session: true, date: '2026-01-30' });
    clock.advanceHours(72);
    var r = Core.closeSession(d.state, { progress: 'no', finished: false, nextStep: '' }, clock());
    assert(r.ok === true);
    assertEqual(r.state.sessions[0].endedAt, '2026-02-02T12:00:00.000Z');
    assertEqual(Core.sessionDuration(r.state.sessions[0]), 72 * 3600 * 1000);
  });

  test('sessionDuration de una sesión abierta usa el reloj', function () {
    var clock = fakeClock('2026-01-01T09:00:00.000Z');
    var d = seed(clock, { session: true });
    clock.advanceHours(1.5);
    assertEqual(Core.sessionDuration(Core.openSession(d.state), clock()), 90 * 60 * 1000);
  });

  test('closeSession sin nextStep conserva la siguiente acción actual', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: true, nextAction: 'Paso uno' });
    clock.advanceHours(1);
    var r = Core.closeSession(d.state, { progress: 'yes', finished: false, nextStep: '   ' }, clock());
    assert(r.ok === true);
    var task = r.state.tasks.filter(function (t) { return t.id === d.id; })[0];
    assertEqual(task.nextAction, 'Paso uno', 'la acción se conserva');
    assertEqual(task.status, 'active', 'la tarea sigue activa');
    assertEqual(r.state.sessions[0].nextStep, 'Paso uno', 'la sesión guarda la acción efectiva');
    assertEqual(r.state.sessions[0].progress, 'yes');
    assertEqual(r.state.sessions[0].endedAt, clock());
  });

  test('closeSession con nextStep escrito actualiza la siguiente acción', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: true, nextAction: 'Paso uno' });
    clock.advanceHours(1);
    var r = Core.closeSession(d.state, { progress: 'some', finished: false, nextStep: '  Paso dos  ' }, clock());
    var task = r.state.tasks.filter(function (t) { return t.id === d.id; })[0];
    assertEqual(task.nextAction, 'Paso dos');
    assertEqual(r.state.sessions[0].nextStep, 'Paso dos');
  });

  test('closeSession con tarea terminada la marca done y la saca del plan de hoy', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: true });
    clock.advanceHours(2);
    var r = Core.closeSession(d.state, { progress: 'yes', finished: true }, clock());
    assert(r.ok === true);
    var task = r.state.tasks.filter(function (t) { return t.id === d.id; })[0];
    assertEqual(task.status, 'done');
    assertEqual(Core.todayPlan(r.state, d.date).length, 0, 'fuera del plan de hoy');
    assertEqual(r.state.sessions.length, 1, 'la sesión se conserva');
    assert(r.state.sessions[0].endedAt === clock(), 'la sesión quedó cerrada');
  });

  test('closeSession sin sesión abierta es rechazada', function () {
    var r = Core.closeSession(Core.emptyState(), { progress: 'yes', finished: false }, ISO);
    assert(r.ok === false, 'debe fallar');
  });

  test('closeSession con progreso inválido es rechazada', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: true });
    var r = Core.closeSession(d.state, { progress: 'tal vez', finished: false }, clock());
    assert(r.ok === false, 'debe fallar');
  });

  test('markTaskDone quita del plan de hoy y conserva todas las sesiones', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: true });
    clock.advanceHours(1);
    var s = Core.closeSession(d.state, { progress: 'some', finished: false, nextStep: '' }, clock()).state;
    clock.advanceHours(1);
    s = Core.startSession(s, { taskId: d.id }, clock()).state;
    clock.advanceHours(1);
    s = Core.closeSession(s, { progress: 'yes', finished: false, nextStep: '' }, clock()).state;
    var sessionsBefore = s.sessions.length;
    var r = Core.markTaskDone(s, { taskId: d.id }, clock());
    assert(r.ok === true);
    assertEqual(r.state.tasks[0].status, 'done');
    assertEqual(Core.todayPlan(r.state, d.date).length, 0);
    assertEqual(r.state.sessions.length, sessionsBefore, 'no se pierde ninguna sesión');
  });

  // --- consultas ---

  test('inbox devuelve tareas inbox y active, más antiguas primero', function () {
    var clock = fakeClock(ISO);
    var s = Core.captureTask(Core.emptyState(), { title: 'A' }, '2026-01-01T09:00:00.000Z').state;
    s = Core.captureTask(s, { title: 'B' }, '2026-01-01T10:00:00.000Z').state;
    s = Core.defineTask(s, { taskId: s.tasks[1].id, nextAction: 'x' }, clock()).state;
    var list = Core.inbox(s);
    assertEqual(list.length, 2);
    assertEqual(list[0].title, 'A');
    assertEqual(list[1].title, 'B');
  });

  test('inbox no incluye tareas terminadas', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: false });
    var s = Core.markTaskDone(d.state, { taskId: d.id }, clock()).state;
    assertEqual(Core.inbox(s).length, 0);
  });

  test('firstActionOf devuelve la primera acción del plan', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: false });
    var first = Core.firstActionOf(d.state, d.date);
    assert(first !== null);
    assertEqual(first.taskId, d.id);
    assertEqual(first.task.nextAction, 'Abrir el documento');
  });

  test('firstActionOf devuelve null si no hay plan', function () {
    assertEqual(Core.firstActionOf(Core.emptyState(), '2026-01-01'), null);
  });

  test('todayPlan devuelve lista vacía si no hay plan para la fecha', function () {
    assertEqual(Core.todayPlan(Core.emptyState(), '2026-01-01'), []);
  });

  // --- serialización ---

  test('exportState e importState reproducen un estado vacío', function () {
    var original = Core.emptyState();
    var json = Core.exportState(original);
    var r = Core.importState(Core.emptyState(), json);
    assert(r.ok === true);
    assertEqual(r.state, original);
  });

  test('exportState e importState reproducen un estado poblado', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: true });
    clock.advanceHours(1);
    var populated = Core.closeSession(d.state, { progress: 'yes', finished: false, nextStep: 'Seguir' }, clock()).state;
    var json = Core.exportState(populated);
    var r = Core.importState(Core.emptyState(), json);
    assert(r.ok === true);
    assertEqual(r.state, populated);
  });

  test('importState con JSON inválido devuelve error y no toca el estado', function () {
    var clock = fakeClock(ISO);
    var current = seed(clock, { session: false }).state;
    var before = JSON.stringify(current);
    var r = Core.importState(current, '{ esto no es json');
    assert(r.ok === false, 'debe fallar');
    assertEqual(JSON.stringify(current), before, 'estado actual intacto');
  });

  test('importState rechaza una versión de esquema distinta', function () {
    var bad = JSON.stringify({ schemaVersion: 2, tasks: [], plans: [], planItems: [], sessions: [] });
    assert(Core.importState(Core.emptyState(), bad).ok === false);
    var badStr = JSON.stringify({ schemaVersion: '1', tasks: [], plans: [], planItems: [], sessions: [] });
    assert(Core.importState(Core.emptyState(), badStr).ok === false);
  });

  test('importState rechaza colecciones que no son arrays', function () {
    var bad1 = JSON.stringify({ schemaVersion: 1, tasks: 'x', plans: [], planItems: [], sessions: [] });
    assert(Core.importState(Core.emptyState(), bad1).ok === false);
    var bad2 = JSON.stringify({ schemaVersion: 1, tasks: [], plans: [], planItems: [] });
    assert(Core.importState(Core.emptyState(), bad2).ok === false, 'falta sessions');
  });

  test('migrate es idempotente y no rompe un estado vacío', function () {
    assertEqual(Core.migrate(Core.emptyState()), Core.emptyState());
    var once = Core.migrate({ schemaVersion: 1, tasks: [], plans: [], planItems: [], sessions: [] });
    assertEqual(Core.migrate(once), once);
  });

  test('migrate rellena colecciones ausentes', function () {
    var m = Core.migrate({ schemaVersion: 1 });
    assert(Array.isArray(m.tasks) && Array.isArray(m.plans));
    assert(Array.isArray(m.planItems) && Array.isArray(m.sessions));
    assertEqual(m.revision, 0);
    assertEqual(m.savedAt, null);
  });

  // --- guardado ---

  test('stampSave sube la revisión y sella savedAt sin mutar el estado', function () {
    var s0 = Core.emptyState();
    var s1 = Core.stampSave(s0, '2026-01-01T00:00:00.000Z');
    assertEqual(s1.revision, 1);
    assertEqual(s1.savedAt, '2026-01-01T00:00:00.000Z');
    assertEqual(s0.revision, 0, 'original sin mutar');
    assertEqual(s0.savedAt, null);
    var s2 = Core.stampSave(s1, '2026-01-02T00:00:00.000Z');
    assertEqual(s2.revision, 2);
    assertEqual(s2.savedAt, '2026-01-02T00:00:00.000Z');
  });

  // --- identificadores ---

  test('uid genera identificadores únicos en base36', function () {
    var seen = {};
    for (var i = 0; i < 200; i++) {
      var id = Core.uid('2026-01-01T00:00:00.000Z');
      assert(/^[0-9a-z]+$/.test(id), 'formato base36: ' + id);
      assert(!seen[id], 'sin repetir: ' + id);
      seen[id] = true;
    }
  });

  test('uid funciona también sin reloj', function () {
    assert(/^[0-9a-z]+$/.test(Core.uid()));
  });

  // --- no-mutación general ---

  test('los casos de uso no mutan el estado recibido', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: true });
    var snap = JSON.stringify(d.state);
    Core.defineTask(d.state, { taskId: d.id, nextAction: 'otra' }, clock());
    Core.chooseForToday(d.state, { taskId: d.id, date: d.date }, clock());
    Core.moveToFirst(d.state, { date: d.date, taskId: d.id });
    Core.closeSession(d.state, { progress: 'yes', finished: true }, clock());
    Core.markTaskDone(d.state, { taskId: d.id }, clock());
    assertEqual(JSON.stringify(d.state), snap, 'el estado sembrado no cambió');
  });

  // --- salida ---

  var failed = results.filter(function (r) { return !r.ok; });
  var summary = (results.length - failed.length) + '/' + results.length + ' pruebas en verde';

  // en Node: imprime y termina con código 1 si algo falla
  if (typeof process !== 'undefined' && process.exit) {
    results.forEach(function (r) {
      console.log((r.ok ? 'OK   ' : 'FALLA ') + r.name + (r.ok ? '' : '  ->  ' + r.error));
    });
    console.log('\n' + summary);
    if (failed.length) process.exit(1);
  }

  // en el navegador: pinta la lista en verde/rojo
  if (typeof document !== 'undefined') {
    var root = document.getElementById('resultado') || document.body;
    while (root.firstChild) root.removeChild(root.firstChild);
    var head = document.createElement('p');
    head.className = failed.length ? 'resumen malo' : 'resumen bueno';
    head.textContent = summary;
    root.appendChild(head);
    var ul = document.createElement('ul');
    ul.className = 'lista';
    results.forEach(function (r) {
      var li = document.createElement('li');
      li.className = r.ok ? 'bien' : 'mal';
      li.textContent = (r.ok ? 'OK  ' : 'FALLA  ') + r.name + (r.ok ? '' : '  ->  ' + r.error);
      ul.appendChild(li);
    });
    root.appendChild(ul);
  }

  // expone los resultados por si otro entorno los necesita
  globalThis.SiguienteTests = { results: results, failed: failed, summary: summary };
})();
