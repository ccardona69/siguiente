const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');
const at = (m) => new Date(Date.parse('2026-09-29T10:00:00Z') + m * 60000).toISOString();
const clone = (x) => JSON.parse(JSON.stringify(x));
const take = (r) => {
  assert.equal(r.ok, true, r.error);
  return r.state;
};
function ready(title = 'Escribir el informe') {
  let s = take(C.captureTask(C.emptyState(), { title }, at(0)));
  const id = s.tasks[0].id;
  s = take(
    C.defineTask(
      s,
      { taskId: id, nextAction: 'Redactar el primer párrafo', outcome: 'Borrador listo' },
      at(1),
    ),
  );
  s = take(C.chooseForToday(s, { taskId: id, date: '2026-09-29' }, at(2)));
  return { s, id };
}
function second(s) {
  s = take(C.captureTask(s, { title: 'Revisar las notas' }, at(2)));
  const id = s.tasks.at(-1).id;
  s = take(C.defineTask(s, { taskId: id, nextAction: 'Leer una página' }, at(3)));
  return { s, id };
}
function closed(finished = false) {
  let { s, id } = ready();
  s = take(C.startSession(s, { taskId: id }, at(3)));
  s = take(C.pauseSession(s, {}, at(8)));
  s = take(C.resumeSession(s, {}, at(13)));
  s = take(
    C.closeSession(
      s,
      { progress: 'some', finished, nextStep: 'Escribir el segundo párrafo' },
      at(23),
    ),
  );
  return { s, id };
}

test('estado vacío válido', () => assert.equal(C.validateState(C.emptyState()).ok, true));
test('captura sin mutar el origen', () => {
  const s = C.emptyState();
  const n = take(C.captureTask(s, { title: '  Leer  ' }, at(0)));
  assert.equal(s.tasks.length, 0);
  assert.equal(n.tasks[0].title, 'Leer');
  assert.equal(n.tasks[0].status, 'inbox');
});
test('no admite títulos vacíos ni mayores de 240', () => {
  assert.equal(C.captureTask(C.emptyState(), { title: '   ' }, at(0)).ok, false);
  assert.equal(C.captureTask(C.emptyState(), { title: 'x'.repeat(241) }, at(0)).ok, false);
});
test('no permite elegir una tarea sin acción', () => {
  const s = take(C.captureTask(C.emptyState(), { title: 'Hacer algo' }, at(0)));
  assert.equal(C.chooseForToday(s, { taskId: s.tasks[0].id, date: '2026-09-29' }, at(1)).ok, false);
});
test('la definición conserva resultado y admite cambio de nombre', () => {
  let { s, id } = ready();
  s = take(
    C.defineTask(
      s,
      { taskId: id, title: 'Mi informe', nextAction: 'Abrir el documento', outcome: 'Listo' },
      at(3),
    ),
  );
  assert.equal(s.tasks[0].title, 'Mi informe');
  assert.equal(s.tasks[0].outcome, 'Listo');
});
test('acción vacía rechazada', () => {
  const { s, id } = ready();
  assert.equal(C.defineTask(s, { taskId: id, nextAction: '' }, at(3)).ok, false);
});
test('acción mayor de 500 rechazada', () => {
  const { s, id } = ready();
  assert.equal(C.defineTask(s, { taskId: id, nextAction: 'x'.repeat(501) }, at(3)).ok, false);
});
test('elección idempotente sin duplicados', () => {
  const { s, id } = ready();
  assert.equal(take(C.chooseForToday(s, { taskId: id, date: '2026-09-29' }, at(3))), s);
  assert.equal(C.todayPlan(s, '2026-09-29').length, 1);
});
test('fecha de calendario imposible rechazada', () => {
  const { s, id } = ready();
  assert.equal(C.chooseForToday(s, { taskId: id, date: '2026-02-30' }, at(3)).ok, false);
});
test('subir una tarea mantiene el resto', () => {
  let { s, id } = ready();
  const b = second(s);
  s = take(C.chooseForToday(b.s, { taskId: b.id, date: '2026-09-29' }, at(4)));
  s = take(C.moveToFirst(s, { taskId: b.id, date: '2026-09-29' }, at(5)));
  assert.deepEqual(
    C.todayPlan(s, '2026-09-29').map((x) => x.taskId),
    [b.id, id],
  );
});
test('quitar del plan no elimina la tarea', () => {
  const { s, id } = ready();
  const n = take(C.removeFromToday(s, { taskId: id, date: '2026-09-29' }, at(3)));
  assert.equal(C.todayPlan(n, '2026-09-29').length, 0);
  assert.ok(C.taskById(n, id));
});
test('pausar y recuperar una tarea', () => {
  let { s, id } = ready();
  s = take(C.pauseTask(s, { taskId: id }, at(3)));
  assert.equal(C.inbox(s).length, 0);
  assert.equal(C.todayPlan(s, '2026-09-29').length, 0);
  s = take(C.resumeTask(s, { taskId: id }, at(4)));
  assert.equal(C.inbox(s).length, 1);
  assert.equal(C.taskById(s, id).status, 'active');
});
test('reprogramar traslada una sola vez', () => {
  let { s, id } = ready();
  s = take(
    C.rescheduleTask(s, { taskId: id, fromDate: '2026-09-29', toDate: '2026-09-30' }, at(3)),
  );
  assert.equal(C.todayPlan(s, '2026-09-29').length, 0);
  assert.equal(C.todayPlan(s, '2026-09-30').length, 1);
});
test('reprogramar no permite fecha anterior', () => {
  const { s, id } = ready();
  assert.equal(
    C.rescheduleTask(s, { taskId: id, fromDate: '2026-09-29', toDate: '2026-09-28' }, at(3)).ok,
    false,
  );
});
test('terminar oculta del plan, sin borrar el historial', () => {
  let { s, id } = ready();
  s = take(C.markTaskDone(s, { taskId: id }, at(3)));
  assert.equal(C.todayPlan(s, '2026-09-29').length, 0);
  assert.equal(s.tasks[0].completedAt, at(3));
  assert.equal(C.validateState(s).ok, true);
});
test('una sesión abierta como máximo', () => {
  let { s, id } = ready();
  let b = second(s);
  s = take(C.startSession(b.s, { taskId: id }, at(4)));
  assert.equal(C.startSession(s, { taskId: b.id }, at(5)).ok, false);
  assert.equal(C.startSession(s, { taskId: id }, at(5)).state, s);
});
test('snapshot de la acción al empezar', () => {
  let { s, id } = ready();
  s = take(C.startSession(s, { taskId: id }, at(3)));
  s = take(C.defineTask(s, { taskId: id, nextAction: 'Otra acción', outcome: null }, at(4)));
  assert.equal(C.openSession(s).action, 'Redactar el primer párrafo');
});
test('pausas excluidas de la duración', () => {
  const { s } = closed();
  assert.equal(C.sessionDuration(s.sessions[0], at(50)), 15 * 60000);
});
test('tiempo congelado durante la pausa', () => {
  let { s, id } = ready();
  s = take(C.startSession(s, { taskId: id }, at(3)));
  s = take(C.pauseSession(s, {}, at(8)));
  assert.equal(C.sessionDuration(C.openSession(s), at(80)), 5 * 60000);
});
test('cierre durante pausa no suma la pausa', () => {
  let { s, id } = ready();
  s = take(C.startSession(s, { taskId: id }, at(3)));
  s = take(C.pauseSession(s, {}, at(8)));
  s = take(
    C.closeSession(s, { progress: 'no', finished: false, nextStep: 'Volver a intentarlo' }, at(13)),
  );
  assert.equal(C.sessionDuration(s.sessions[0], at(50)), 5 * 60000);
  assert.equal(C.validateState(s).ok, true);
});
test('cierre de sesión conserva el siguiente paso', () => {
  const { s, id } = closed();
  assert.equal(C.taskById(s, id).nextAction, 'Escribir el segundo párrafo');
  assert.equal(s.sessions[0].progress, 'some');
  assert.equal(C.openSession(s), null);
});
test('cierre de tarea terminado actualiza estadísticas', () => {
  const { s } = closed(true);
  assert.equal(s.tasks[0].status, 'done');
  assert.equal(s.sessions[0].nextStep, null);
  assert.deepEqual(C.sessionStats(s), { count: 1, totalMs: 15 * 60000, completedTasks: 1 });
});
test('no se pausa ni termina una tarea con sesión abierta', () => {
  let { s, id } = ready();
  s = take(C.startSession(s, { taskId: id }, at(3)));
  assert.equal(C.pauseTask(s, { taskId: id }, at(4)).ok, false);
  assert.equal(C.markTaskDone(s, { taskId: id }, at(4)).ok, false);
});
test('cierre inválido mantiene el estado original', () => {
  let { s, id } = ready();
  s = take(C.startSession(s, { taskId: id }, at(3)));
  const prev = clone(s);
  assert.equal(C.closeSession(s, { progress: 'bad', finished: false }, at(4)).ok, false);
  assert.deepEqual(s, prev);
});
test('reloj anterior rechazado al pausar', () => {
  let { s, id } = ready();
  s = take(C.startSession(s, { taskId: id }, at(3)));
  assert.equal(C.pauseSession(s, {}, at(2)).ok, false);
});
test('rango temporal es semiabierto', () => {
  const { s } = closed();
  assert.equal(C.sessionsBetween(s, at(3), at(4)).length, 1);
  assert.equal(C.sessionsBetween(s, at(2), at(3)).length, 0);
});
test('exportar e importar conserva todo', () => {
  const { s } = closed();
  const parsed = take(C.importState(C.emptyState(), C.exportState(s)));
  assert.deepEqual(parsed, s);
});
test('importación malformada o incompatible rechazada', () => {
  for (const raw of [
    'not json',
    '[]',
    '{}',
    'null',
    JSON.stringify({ ...C.emptyState(), schemaVersion: 99 }),
  ])
    assert.equal(C.importState(C.emptyState(), raw).ok, false);
});
test('límite de importación de 5 MB', () =>
  assert.equal(C.importState(C.emptyState(), ' '.repeat(5 * 1024 * 1024 + 1)).ok, false));
test('identificadores duplicados rechazados', () => {
  const { s } = ready();
  const n = clone(s);
  n.tasks.push(clone(n.tasks[0]));
  assert.equal(C.validateState(n).ok, false);
});
test('planes no pueden apuntar a tareas inexistentes', () => {
  const { s } = ready();
  const n = clone(s);
  n.plans[0].taskIds.push('missing');
  assert.equal(C.validateState(n).ok, false);
});
test('sesiones no pueden apuntar a tareas inexistentes', () => {
  const { s } = closed();
  const n = clone(s);
  n.sessions[0].taskId = 'missing';
  assert.equal(C.validateState(n).ok, false);
});
test('pausas negativas rechazadas', () => {
  const { s } = closed();
  const n = clone(s);
  n.sessions[0].pausedMs = -1;
  assert.equal(C.validateState(n).ok, false);
});
test('migración v1 solo para el contrato conocido', () => {
  const { s } = closed();
  const old = clone(s);
  old.schemaVersion = 1;
  assert.equal(C.validateState(C.migrate(old)).ok, true);
  const unknown = { schemaVersion: 1, tasks: [], sessions: [], dailyPlan: {} };
  assert.equal(C.validateState(C.migrate(unknown)).ok, false);
});
test('tres vías fusiona cambios en campos distintos', () => {
  const { s, id } = ready();
  const local = take(
    C.defineTask(
      s,
      {
        taskId: id,
        title: 'Nuevo título',
        nextAction: s.tasks[0].nextAction,
        outcome: s.tasks[0].outcome,
      },
      at(3),
    ),
  );
  const remote = take(
    C.defineTask(
      s,
      { taskId: id, nextAction: s.tasks[0].nextAction, outcome: 'Nuevo resultado' },
      at(4),
    ),
  );
  const n = take(C.mergeStates(s, local, remote, at(5)));
  assert.equal(n.tasks[0].title, 'Nuevo título');
  assert.equal(n.tasks[0].outcome, 'Nuevo resultado');
});
test('tres vías conserva tareas nuevas de ambos equipos', () => {
  const b = C.emptyState();
  const l = take(C.captureTask(b, { title: 'Local' }, at(0)));
  const r = take(C.captureTask(b, { title: 'Remoto' }, at(1)));
  assert.equal(take(C.mergeStates(b, l, r, at(2))).tasks.length, 2);
});
test('fusión idempotente', () => {
  const { s } = ready();
  assert.equal(C.mergeStates(s, s, s, at(3)).state, s);
});
test('fusión con dos sesiones abiertas se rechaza sin borrar', () => {
  let { s, id } = ready();
  const b = second(s);
  s = b.s;
  const l = take(C.startSession(s, { taskId: id }, at(4)));
  const r = take(C.startSession(s, { taskId: b.id }, at(5)));
  const previous = clone(l);
  assert.equal(C.mergeStates(s, l, r, at(6)).ok, false);
  assert.deepEqual(l, previous);
});
test('estado se mantiene válido en todo el recorrido', () => {
  let { s, id } = ready();
  const steps = [
    () => C.startSession(s, { taskId: id }, at(3)),
    () => C.pauseSession(s, {}, at(4)),
    () => C.resumeSession(s, {}, at(5)),
    () => C.closeSession(s, { progress: 'yes', finished: false, nextStep: 'Seguir' }, at(6)),
    () => C.pauseTask(s, { taskId: id }, at(7)),
    () => C.resumeTask(s, { taskId: id }, at(8)),
    () => C.markTaskDone(s, { taskId: id }, at(9)),
  ];
  for (const step of steps) {
    s = take(step());
    assert.equal(C.validateState(s).ok, true);
  }
});
test('marca de tiempo debe ser ISO real, no una cadena interpretable', () => {
  assert.equal(C.captureTask(C.emptyState(), { title: 'Fecha inválida' }, '1').ok, false);
  assert.equal(
    C.captureTask(C.emptyState(), { title: 'Fecha imposible' }, '2026-02-30T10:00:00Z').ok,
    false,
  );
});
test('edición no acepta un reloj anterior al último cambio', () => {
  const { s, id } = ready();
  assert.equal(C.defineTask(s, { taskId: id, nextAction: 'Cambio' }, at(0)).ok, false);
});
test('rechaza claves capaces de modificar prototipos', () => {
  const raw =
    '{"schemaVersion":2,"savedAt":null,"tasks":[],"plans":[],"sessions":[],"__proto__":{"polluted":true}}';
  assert.equal(C.importState(C.emptyState(), raw).ok, false);
  assert.equal({}.polluted, undefined);
});
test('rechaza estructuras demasiado profundas', () => {
  const s = C.emptyState();
  let current = s;
  for (let i = 0; i < 30; i++) current = current.deep = {};
  assert.equal(C.validateState(s).ok, false);
});
// historial desordenado, con empates y zonas horarias, para comparar con la consulta directa
function scrambled() {
  const s = C.emptyState();
  const tasks = ['t_a', 't_b', 't_c'];
  const base = Date.parse('2026-09-01T08:00:00Z');
  for (let i = 0; i < 120; i++) {
    const k = (i * 37) % 120;
    const start = base + Math.floor(k / 2) * 3600000;
    const iso = new Date(start).toISOString();
    s.sessions.push({
      id: 's_' + i,
      taskId: tasks[i % 3],
      title: 'Tarea',
      action: 'Paso',
      startedAt: i % 5 ? iso : iso.slice(0, 19) + '+00:00',
      endedAt: i % 11 === 0 ? null : new Date(start + (10 + (i % 7)) * 60000).toISOString(),
      pausedAt: null,
      pausedMs: (i % 3) * 30000,
      progress: 'yes',
      nextStep: 'Seguir',
      finished: false,
      updatedAt: iso,
    });
  }
  return s;
}
const naiveClosed = (s) =>
  s.sessions
    .filter((x) => x.endedAt)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
test('consultas del historial: mismo orden y totales que la versión directa', () => {
  const s = scrambled();
  assert.deepEqual(
    C.closedSessions(s).map((x) => x.id),
    naiveClosed(s).map((x) => x.id),
  );
  const from = '2026-09-02T00:00:00Z';
  const to = '2026-09-03T12:00:00Z';
  assert.deepEqual(
    C.sessionsBetween(s, from, to).map((x) => x.id),
    naiveClosed(s)
      .filter(
        (x) => Date.parse(x.startedAt) >= Date.parse(from) && Date.parse(x.startedAt) < Date.parse(to),
      )
      .map((x) => x.id),
  );
  for (const id of ['t_a', 't_b', 't_c', 't_x']) {
    const direct = naiveClosed(s)
      .filter((x) => x.taskId === id)
      .reduce((t, x) => t + C.sessionDuration(x, x.endedAt), 0);
    assert.equal(C.taskTotalDuration(s, id), direct);
  }
  const stats = C.sessionStats(s);
  assert.equal(stats.count, naiveClosed(s).length);
  assert.equal(stats.totalMs, C.sessionsTotalDuration(naiveClosed(s), null));
});
test('consultas del historial no mutan el estado recibido', () => {
  const s = scrambled();
  const before = clone(s);
  C.closedSessions(s);
  C.sessionsBetween(s, '2026-09-01T00:00:00Z', '2026-09-30T00:00:00Z');
  C.taskTotalDuration(s, 't_a');
  C.sessionStats(s);
  assert.deepEqual(s, before);
});
