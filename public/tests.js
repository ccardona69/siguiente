/* tests.js — pruebas del núcleo de "Siguiente" y mini-runner propio.
   Funciona en Node ("node tests.js", código de salida 1 si algo falla)
   y en el navegador (tests.html pinta verde/rojo). El reloj es siempre falso. */
(function () {
  'use strict';

  // carga del núcleo según el entorno
  var Core = (typeof require !== 'undefined') ? require('./core.js') : globalThis.SiguienteCore;

  var registry = [];

  // registra una prueba para su posterior ejecución
  function test(name, fn) {
    registry.push({ name: name, fn: fn });
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

  // --- pausar: apartar la tarea sin terminarla ---

  test('pauseTask saca la tarea de todos sus planes, renumera y conserva la acción', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: false });
    // la tarea también está en el plan de otro día
    var s = Core.chooseForToday(d.state, { taskId: d.id, date: '2026-01-02' }, clock()).state;
    // otra tarea en el plan de hoy, para comprobar la renumeración
    s = Core.captureTask(s, { title: 'Segunda' }, clock()).state;
    var id2 = s.tasks[s.tasks.length - 1].id;
    s = Core.defineTask(s, { taskId: id2, nextAction: 'Arrancar' }, clock()).state;
    s = Core.chooseForToday(s, { taskId: id2, date: d.date }, clock()).state;

    var r = Core.pauseTask(s, { taskId: d.id });
    assert(r.ok === true);
    assertEqual(r.state.planItems.length, 1, 'solo queda el item de la segunda tarea');
    assertEqual(r.state.planItems[0].taskId, id2);
    assertEqual(r.state.planItems[0].order, 0, 'renumerado desde 0');
    var task = Core.taskById(r.state, d.id);
    assertEqual(task.status, 'active', 'sigue activa, no terminada');
    assertEqual(task.nextAction, 'Abrir el documento', 'la siguiente acción se conserva');
  });

  test('pauseTask con sesión propia abierta es rechazada', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: true });
    var r = Core.pauseTask(d.state, { taskId: d.id });
    assert(r.ok === false);
    assertEqual(r.error, 'Cierra la sesión abierta antes de apartar la tarea.');
  });

  test('pauseTask conserva las sesiones cerradas de la tarea', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: true });
    clock.advanceHours(2);
    var s = Core.closeSession(d.state, { progress: 'some', finished: false, nextStep: 'Seguir' }, clock()).state;
    var r = Core.pauseTask(s, { taskId: d.id });
    assert(r.ok === true);
    assertEqual(r.state.sessions.length, 1, 'la sesión cerrada sigue ahí');
    assertEqual(Core.taskTotalDuration(r.state, d.id), 2 * 3600 * 1000, 'el tiempo acumulado no cambia');
    assertEqual(Core.taskById(r.state, d.id).nextAction, 'Seguir', 'el siguiente paso escrito al cerrar se conserva');
  });

  test('pauseTask sin planes es un no-op correcto', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { today: false });
    var r = Core.pauseTask(d.state, { taskId: d.id });
    assert(r.ok === true);
    assertEqual(r.state.planItems.length, 0);
  });

  test('pauseTask rechaza tarea inexistente o terminada', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: false });
    var r1 = Core.pauseTask(d.state, { taskId: 'inexistente' });
    assert(r1.ok === false);
    assertEqual(r1.error, 'No se encontró la tarea.');
    var s = Core.markTaskDone(d.state, { taskId: d.id }, clock()).state;
    var r2 = Core.pauseTask(s, { taskId: d.id });
    assert(r2.ok === false);
    assertEqual(r2.error, 'La tarea ya está terminada.');
  });

  // --- reprogramar: mover la tarea al plan de otro día ---

  test('rescheduleTask mueve la tarea a otro día y renumera ambos planes', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: false });
    var s = Core.captureTask(d.state, { title: 'Segunda' }, clock()).state;
    var id2 = s.tasks[s.tasks.length - 1].id;
    s = Core.defineTask(s, { taskId: id2, nextAction: 'Arrancar' }, clock()).state;
    s = Core.chooseForToday(s, { taskId: id2, date: d.date }, clock()).state;

    var r = Core.rescheduleTask(s, { taskId: d.id, fromDate: d.date, toDate: '2026-01-03' }, clock());
    assert(r.ok === true);
    var origen = Core.todayPlan(r.state, d.date);
    assertEqual(origen.length, 1, 'el plan de origen solo conserva la segunda tarea');
    assertEqual(origen[0].taskId, id2);
    assertEqual(origen[0].order, 0, 'renumerado desde 0');
    var destino = Core.todayPlan(r.state, '2026-01-03');
    assertEqual(destino.length, 1);
    assertEqual(destino[0].taskId, d.id);
    assertEqual(destino[0].order, 0);
  });

  test('rescheduleTask con plan destino existente añade al final sin duplicar', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: false });
    var s = Core.captureTask(d.state, { title: 'Segunda' }, clock()).state;
    var id2 = s.tasks[s.tasks.length - 1].id;
    s = Core.defineTask(s, { taskId: id2, nextAction: 'Arrancar' }, clock()).state;
    s = Core.chooseForToday(s, { taskId: id2, date: '2026-01-03' }, clock()).state;

    var r = Core.rescheduleTask(s, { taskId: d.id, fromDate: d.date, toDate: '2026-01-03' }, clock());
    assert(r.ok === true);
    var destino = Core.todayPlan(r.state, '2026-01-03');
    assertEqual(destino.length, 2);
    assertEqual(destino[1].taskId, d.id, 'entra al final del plan destino');
    assertEqual(destino[1].order, 1);
    // reprogramar de nuevo desde el mismo origen: ya no está ahí, así que es error
    var r2 = Core.rescheduleTask(r.state, { taskId: d.id, fromDate: d.date, toDate: '2026-01-03' }, clock());
    assert(r2.ok === false);
    assertEqual(r2.error, 'La tarea no está en el plan de ese día.');
    assertEqual(Core.todayPlan(r.state, '2026-01-03').length, 2, 'no se duplicó');
  });

  test('rescheduleTask nunca cambia el vencimiento ni la siguiente acción', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: false });
    var before = Core.taskById(d.state, d.id);
    var r = Core.rescheduleTask(d.state, { taskId: d.id, fromDate: d.date, toDate: '2026-01-04' }, clock());
    assert(r.ok === true);
    var after = Core.taskById(r.state, d.id);
    assertEqual(after.dueDate, before.dueDate, 'el vencimiento queda intacto');
    assertEqual(after.nextAction, before.nextAction, 'la siguiente acción queda intacta');
    assertEqual(after.updatedAt, before.updatedAt, 'la tarea no se modifica: solo se mueve de plan');
  });

  test('rescheduleTask rechaza fechas inválidas o iguales', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: false });
    var r1 = Core.rescheduleTask(d.state, { taskId: d.id, fromDate: d.date, toDate: '2026-02-30' }, clock());
    assert(r1.ok === false);
    assertEqual(r1.error, 'Las fechas del cambio no son válidas.');
    var r2 = Core.rescheduleTask(d.state, { taskId: d.id, fromDate: d.date, toDate: 'ayer' }, clock());
    assert(r2.ok === false);
    assertEqual(r2.error, 'Las fechas del cambio no son válidas.');
    var r3 = Core.rescheduleTask(d.state, { taskId: d.id, fromDate: d.date, toDate: d.date }, clock());
    assert(r3.ok === false);
    assertEqual(r3.error, 'Elige un día distinto al actual del plan.');
  });

  test('rescheduleTask rechaza tarea sin siguiente acción, terminada o fuera del plan', function () {
    var clock = fakeClock(ISO);
    var s = Core.captureTask(Core.emptyState(), { title: 'Sin definir' }, clock()).state;
    var id = s.tasks[0].id;
    var r1 = Core.rescheduleTask(s, { taskId: id, fromDate: '2026-01-01', toDate: '2026-01-02' }, clock());
    assert(r1.ok === false);
    assertEqual(r1.error, 'Define la siguiente acción antes de reprogramar la tarea.');

    var d = seed(clock, { today: false });
    var r2 = Core.rescheduleTask(d.state, { taskId: d.id, fromDate: '2026-01-01', toDate: '2026-01-02' }, clock());
    assert(r2.ok === false);
    assertEqual(r2.error, 'La tarea no está en el plan de ese día.');

    var s2 = Core.markTaskDone(d.state, { taskId: d.id }, clock()).state;
    var r3 = Core.rescheduleTask(s2, { taskId: d.id, fromDate: '2026-01-01', toDate: '2026-01-02' }, clock());
    assert(r3.ok === false);
    assertEqual(r3.error, 'La tarea ya está terminada.');
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

  test('pauseSession congela la duración y fija pausedAt', function () {
    var clock = fakeClock('2026-01-01T09:00:00.000Z');
    var d = seed(clock, { session: true });
    clock.advanceHours(1);
    var r = Core.pauseSession(d.state, {}, clock());
    assert(r.ok === true);
    var sess = Core.openSession(r.state);
    assertEqual(sess.pausedAt, clock());
    clock.advanceHours(2);
    assertEqual(Core.sessionDuration(sess, clock()), 3600 * 1000);
  });

  test('resumeSession acumula pausedMs y reanuda el avance', function () {
    var clock = fakeClock('2026-01-01T09:00:00.000Z');
    var d = seed(clock, { session: true });
    clock.advanceHours(1);
    var s = Core.pauseSession(d.state, {}, clock()).state;
    clock.advanceHours(2);
    var r = Core.resumeSession(s, {}, clock());
    assert(r.ok === true);
    var sess = Core.openSession(r.state);
    assertEqual(sess.pausedAt, null);
    assertEqual(sess.pausedMs, 2 * 3600 * 1000);
    clock.advanceHours(0.5);
    assertEqual(Core.sessionDuration(sess, clock()), 1.5 * 3600 * 1000);
  });

  test('closeSession con sesión en pausa acumula el tramo de pausa final', function () {
    var clock = fakeClock('2026-01-01T09:00:00.000Z');
    var d = seed(clock, { session: true });
    clock.advanceHours(1);
    var s = Core.pauseSession(d.state, {}, clock()).state;
    clock.advanceHours(3);
    var r = Core.closeSession(s, { progress: 'yes', finished: false, nextStep: '' }, clock());
    assert(r.ok === true);
    var closed = r.state.sessions[0];
    assertEqual(closed.pausedAt, null);
    assertEqual(closed.pausedMs, 3 * 3600 * 1000);
    assertEqual(Core.sessionDuration(closed, clock()), 1 * 3600 * 1000);
  });

  test('pauseSession y resumeSession sin sesión abierta fallan con error claro', function () {
    var r1 = Core.pauseSession(Core.emptyState(), {}, ISO);
    assert(r1.ok === false);
    assertEqual(r1.error, 'No hay ninguna sesión abierta.');
    var r2 = Core.resumeSession(Core.emptyState(), {}, ISO);
    assert(r2.ok === false);
    assertEqual(r2.error, 'No hay ninguna sesión abierta.');
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

  test('importState y validateState rechazan estados con tareas o sesiones corruptas', function () {
    var base = Core.emptyState();
    var bad1 = JSON.parse(JSON.stringify(base));
    bad1.tasks.push({ id: '', title: 'Sin id', status: 'inbox', outcome: null, nextAction: null, dueDate: null, createdAt: ISO, updatedAt: ISO });
    var r1 = Core.importState(base, JSON.stringify(bad1));
    assert(r1.ok === false);
    assert(/incorrecto/i.test(r1.error));

    var bad2 = JSON.parse(JSON.stringify(base));
    bad2.sessions.push({ id: 's1', taskId: 't1', startedAt: 'invalido', endedAt: null, pausedAt: null, pausedMs: 0, progress: null, nextStep: null });
    var r2 = Core.importState(base, JSON.stringify(bad2));
    assert(r2.ok === false);
    assert(/incorrecto/i.test(r2.error));
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

  // --- consultas nuevas: registro y progreso ---

  test('taskById devuelve la tarea buscada y null si no existe', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: false });
    assertEqual(Core.taskById(d.state, d.id).id, d.id);
    assertEqual(Core.taskById(d.state, 'no-existe'), null);
  });

  test('closedSessions excluye la abierta y ordena de más reciente a más antigua', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: true });
    clock.advanceHours(1);
    var s = Core.closeSession(d.state, { progress: 'yes', finished: false, nextStep: '' }, clock()).state;
    clock.advanceHours(1);
    s = Core.startSession(s, { taskId: d.id }, clock()).state;
    clock.advanceHours(1);
    s = Core.closeSession(s, { progress: 'some', finished: false, nextStep: '' }, clock()).state;
    clock.advanceHours(1);
    s = Core.startSession(s, { taskId: d.id }, clock()).state;
    var closed = Core.closedSessions(s);
    assertEqual(closed.length, 2, 'solo las cerradas');
    assert(closed[0].endedAt > closed[1].endedAt, 'más reciente primero');
  });

  test('sessionsBetween filtra por startedAt: inferior inclusivo, superior exclusivo', function () {
    var clock = fakeClock('2026-03-02T08:00:00.000Z');
    var d = seed(clock, { session: true, date: '2026-03-02' });
    clock.advanceHours(1);
    var s = Core.closeSession(d.state, { progress: 'yes', finished: false, nextStep: '' }, clock()).state;
    var start = '2026-03-02T00:00:00.000Z';
    var end = '2026-03-09T00:00:00.000Z';
    assertEqual(Core.sessionsBetween(s, start, end).length, 1, 'dentro de la semana');
    assertEqual(Core.sessionsBetween(s, start, '2026-03-02T08:00:00.000Z').length, 0, 'límite superior exclusivo');
    assertEqual(Core.sessionsBetween(s, '2026-03-02T08:00:00.000Z', end).length, 1, 'límite inferior inclusivo');
  });

  test('sessionsBetween ordena de más antigua a más reciente y omite las abiertas', function () {
    var clock = fakeClock('2026-03-02T08:00:00.000Z');
    var d = seed(clock, { session: true, date: '2026-03-02' });
    clock.advanceHours(1);
    var s = Core.closeSession(d.state, { progress: 'yes', finished: false, nextStep: '' }, clock()).state;
    clock.advanceHours(24);
    s = Core.startSession(s, { taskId: d.id }, clock()).state;
    clock.advanceHours(1);
    s = Core.closeSession(s, { progress: 'some', finished: false, nextStep: '' }, clock()).state;
    clock.advanceHours(24);
    s = Core.startSession(s, { taskId: d.id }, clock()).state;
    var list = Core.sessionsBetween(s, '2026-03-02T00:00:00.000Z', '2026-03-09T00:00:00.000Z');
    assertEqual(list.length, 2, 'la sesión abierta no cuenta');
    assert(list[0].startedAt < list[1].startedAt, 'ascendente por inicio');
  });

  test('sessionStats suma sesiones cerradas, tiempo y tareas terminadas', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: true });
    clock.advanceHours(1);
    var s = Core.closeSession(d.state, { progress: 'yes', finished: false, nextStep: '' }, clock()).state;
    clock.advanceHours(1);
    s = Core.startSession(s, { taskId: d.id }, clock()).state;
    clock.advanceHours(2);
    s = Core.closeSession(s, { progress: 'yes', finished: true }, clock()).state;
    var stats = Core.sessionStats(s);
    assertEqual(stats.count, 2, 'dos sesiones cerradas');
    assertEqual(stats.totalMs, 3 * 3600 * 1000, '1 h + 2 h');
    assertEqual(stats.completedTasks, 1, 'una tarea terminada');
  });

  test('sessionStats sobre un estado vacío devuelve ceros', function () {
    assertEqual(Core.sessionStats(Core.emptyState()), { count: 0, totalMs: 0, completedTasks: 0 });
  });

  test('taskTotalDuration suma sesiones cerradas de la tarea y omite abiertas y ajenas', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: true });
    clock.advanceHours(1);
    var s = Core.closeSession(d.state, { progress: 'yes', finished: false, nextStep: '' }, clock()).state;
    clock.advanceHours(1);
    s = Core.startSession(s, { taskId: d.id }, clock()).state;
    clock.advanceHours(2);
    s = Core.closeSession(s, { progress: 'yes', finished: false, nextStep: '' }, clock()).state;
    // otra tarea con su propia sesión
    var t2 = Core.captureTask(s, { title: 'Otra tarea' }, clock()).state;
    var t2Id = t2.tasks[t2.tasks.length - 1].id;
    clock.advanceHours(1);
    t2 = Core.defineTask(t2, { taskId: t2Id, nextAction: 'Paso 1' }, clock()).state;
    t2 = Core.startSession(t2, { taskId: t2Id }, clock()).state;
    clock.advanceHours(5);
    t2 = Core.closeSession(t2, { progress: 'yes', finished: false, nextStep: '' }, clock()).state;

    assertEqual(Core.taskTotalDuration(t2, d.id), 3 * 3600 * 1000, '1 h + 2 h para la primera tarea');
    assertEqual(Core.taskTotalDuration(t2, t2Id), 5 * 3600 * 1000, '5 h para la segunda tarea');
    assertEqual(Core.taskTotalDuration(t2, 'inexistente'), 0, 'cero para tarea inexistente');
  });

  test('las consultas nuevas no mutan el estado recibido', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: true });
    clock.advanceHours(1);
    var s = Core.closeSession(d.state, { progress: 'yes', finished: false, nextStep: '' }, clock()).state;
    var snap = JSON.stringify(s);
    Core.taskById(s, d.id);
    Core.closedSessions(s);
    Core.sessionsBetween(s, '2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z');
    Core.sessionStats(s);
    Core.taskTotalDuration(s, d.id);
    assertEqual(JSON.stringify(s), snap, 'estado intacto');
  });

  // --- no-mutación general ---

  test('los casos de uso no mutan el estado recibido', function () {
    var clock = fakeClock(ISO);
    var d = seed(clock, { session: true });
    var snap = JSON.stringify(d.state);
    Core.defineTask(d.state, { taskId: d.id, nextAction: 'otra' }, clock());
    Core.chooseForToday(d.state, { taskId: d.id, date: d.date }, clock());
    Core.moveToFirst(d.state, { date: d.date, taskId: d.id });
    Core.removeFromToday(d.state, { date: d.date, taskId: d.id });
    Core.pauseTask(d.state, { taskId: d.id });
    Core.rescheduleTask(d.state, { taskId: d.id, fromDate: d.date, toDate: '2026-01-05' }, clock());
    Core.pauseSession(d.state, {}, clock());
    Core.resumeSession(d.state, {}, clock());
    Core.closeSession(d.state, { progress: 'yes', finished: true }, clock());
    Core.markTaskDone(d.state, { taskId: d.id }, clock());
    assertEqual(JSON.stringify(d.state), snap, 'el estado sembrado no cambió');

    var d2 = seed(clock, { session: false });
    var snap2 = JSON.stringify(d2.state);
    Core.pauseTask(d2.state, { taskId: d2.id });
    Core.rescheduleTask(d2.state, { taskId: d2.id, fromDate: d2.date, toDate: '2026-01-05' }, clock());
    assertEqual(JSON.stringify(d2.state), snap2, 'el estado sembrado sin sesión no cambió');
  });

  // --- ejecución y salida ---

  function runAll() {
    var results = [];
    var t0 = Date.now();
    for (var i = 0; i < registry.length; i++) {
      var item = registry[i];
      try {
        item.fn();
        results.push({ name: item.name, ok: true });
      } catch (e) {
        results.push({ name: item.name, ok: false, error: (e && e.message) || String(e) });
      }
    }
    var duration = Date.now() - t0;
    var failed = results.filter(function (r) { return !r.ok; });
    var summary = (results.length - failed.length) + '/' + results.length + ' pruebas en verde';
    var timedSummary = summary + ' (' + duration + ' ms)';

    // en Node: imprime y termina con código 1 si algo falla
    if (typeof process !== 'undefined' && process.exit) {
      results.forEach(function (r) {
        console.log((r.ok ? 'OK   ' : 'FALLA ') + r.name + (r.ok ? '' : '  ->  ' + r.error));
      });
      console.log('\n' + summary);
      if (failed.length) process.exit(1);
    }

    // en el navegador: pinta la lista en verde/rojo y actualiza el resumen
    if (typeof document !== 'undefined') {
      var root = document.getElementById('resultado') || document.body;
      while (root.firstChild) root.removeChild(root.firstChild);
      var head = document.createElement('p');
      head.className = failed.length ? 'resumen malo' : 'resumen bueno';
      head.textContent = timedSummary;
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

    // expone los resultados y la función para re-ejecutar
    var report = { run: runAll, results: results, failed: failed, summary: timedSummary, durationMs: duration };
    globalThis.SiguienteTests = report;
    return report;
  }

  // ejecuta al cargar
  runAll();
})();
