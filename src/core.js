/* Siguiente Core — modelo puro, sin DOM, red ni persistencia. */
(function (root) {
  'use strict';
  const VERSION = 2;
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const ok = (state) => ({ ok: true, state });
  const fail = (error) => ({ ok: false, error });
  const stamp = (iso) =>
    typeof iso === 'string' &&
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      iso,
    ) &&
    day(iso.slice(0, 10)) &&
    Number.isFinite(Date.parse(iso));
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  const record = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
  function safeTree(value, depth) {
    if (depth > 24) return false;
    if (!value || typeof value !== 'object') return true;
    return Object.keys(value).every(
      (key) =>
        !['__proto__', 'constructor', 'prototype'].includes(key) && safeTree(value[key], depth + 1),
    );
  }
  const statuses = ['inbox', 'active', 'paused', 'done'];
  const progress = ['yes', 'some', 'no'];
  const uid = (prefix) =>
    prefix +
    '_' +
    (root.crypto && root.crypto.randomUUID
      ? root.crypto.randomUUID()
      : Math.random().toString(36).slice(2) + '_' + Math.random().toString(36).slice(2));
  function day(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(value + 'T12:00:00Z');
    return Number.isFinite(+d) && d.toISOString().slice(0, 10) === value;
  }
  function emptyState() {
    return { schemaVersion: VERSION, savedAt: null, tasks: [], plans: [], sessions: [] };
  }
  function taskById(s, id) {
    return s.tasks.find((t) => t.id === id) || null;
  }
  function openSession(s) {
    return s.sessions.find((x) => !x.endedAt) || null;
  }
  function closedSessions(s) {
    return newestFirst(s.sessions.filter((x) => x.endedAt));
  }
  // ordena de la sesión más reciente a la más antigua leyendo cada marca una sola vez
  function newestFirst(xs) {
    return xs
      .map((x) => [Date.parse(x.startedAt), x])
      .sort((a, b) => b[0] - a[0])
      .map((pair) => pair[1]);
  }
  function inbox(s) {
    return s.tasks
      .filter((t) => t.status === 'inbox' || t.status === 'active')
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
  function todayPlan(s, date) {
    const p = s.plans.find((p) => p.date === date);
    return (p ? p.taskIds : [])
      .map((taskId) => ({ taskId, task: taskById(s, taskId) }))
      .filter(
        (it) => it.task && it.task.nextAction && ['inbox', 'active'].includes(it.task.status),
      );
  }
  function planFor(s, date, iso) {
    let p = s.plans.find((p) => p.date === date);
    if (!p) {
      p = { date, taskIds: [], updatedAt: iso };
      s.plans.push(p);
    }
    p.updatedAt = iso;
    return p;
  }
  function validTask(s, id, iso) {
    if (!stamp(iso)) return fail('La fecha de la operación no es válida.');
    const task = taskById(s, id);
    if (!task) return fail('No se encontró la tarea.');
    return Date.parse(iso) < Date.parse(task.updatedAt)
      ? fail('El reloj del equipo cambió. Revisa la fecha antes de continuar.')
      : null;
  }
  function captureTask(s, p, iso) {
    const title = text(p.title);
    if (!stamp(iso)) return fail('La fecha de captura no es válida.');
    if (!title) return fail('Escribe el nombre de la tarea.');
    if (title.length > 240) return fail('El nombre puede tener como máximo 240 caracteres.');
    if (s.tasks.length >= 10000)
      return fail('Llegaste al límite de tareas. Exporta una copia antes de continuar.');
    const n = copy(s);
    n.tasks.push({
      id: uid('task'),
      title,
      nextAction: null,
      outcome: null,
      status: 'inbox',
      createdAt: iso,
      updatedAt: iso,
      completedAt: null,
    });
    return ok(n);
  }
  function defineTask(s, p, iso) {
    const error = validTask(s, p.taskId, iso);
    if (error) return error;
    const action = text(p.nextAction),
      title = p.title === undefined ? taskById(s, p.taskId).title : text(p.title);
    const outcome = p.outcome == null ? null : text(p.outcome) || null;
    if (!title || title.length > 240) return fail('Escribe un nombre de entre 1 y 240 caracteres.');
    if (!action) return fail('Define una acción pequeña y concreta para poder empezar.');
    if (action.length > 500 || (outcome && outcome.length > 500))
      return fail('Cada campo puede tener como máximo 500 caracteres.');
    if (taskById(s, p.taskId).status === 'done') return fail('Esta tarea ya está terminada.');
    const n = copy(s),
      t = taskById(n, p.taskId);
    Object.assign(t, { title, nextAction: action, outcome, updatedAt: iso });
    if (t.status !== 'paused') t.status = 'active';
    return ok(n);
  }
  function chooseForToday(s, p, iso) {
    const error = validTask(s, p.taskId, iso);
    if (error) return error;
    const t = taskById(s, p.taskId);
    if (!day(p.date)) return fail('El día elegido no es válido.');
    if (t.status === 'done') return fail('Esta tarea ya está terminada.');
    if (t.status === 'paused') return fail('Recupera esta tarea de la pausa antes de elegirla.');
    if (!t.nextAction) return fail('Escribe primero la siguiente acción.');
    if (todayPlan(s, p.date).some((it) => it.taskId === t.id)) return ok(s);
    const n = copy(s),
      plan = planFor(n, p.date, iso);
    plan.taskIds.push(t.id);
    return ok(n);
  }
  function moveToFirst(s, p, iso) {
    const error = validTask(s, p.taskId, iso);
    if (error) return error;
    const current = s.plans.find((x) => x.date === p.date);
    if (!current || !current.taskIds.includes(p.taskId))
      return fail('La tarea no está en el plan de ese día.');
    if (current.taskIds[0] === p.taskId) return ok(s);
    const n = copy(s),
      plan = planFor(n, p.date, iso);
    plan.taskIds = [p.taskId].concat(plan.taskIds.filter((id) => id !== p.taskId));
    return ok(n);
  }
  function removeFromToday(s, p, iso) {
    const error = validTask(s, p.taskId, iso);
    if (error) return error;
    const n = copy(s),
      plan = n.plans.find((x) => x.date === p.date);
    if (!plan || !plan.taskIds.includes(p.taskId)) return ok(s);
    plan.taskIds = plan.taskIds.filter((id) => id !== p.taskId);
    plan.updatedAt = iso;
    return ok(n);
  }
  function markTaskDone(s, p, iso) {
    const error = validTask(s, p.taskId, iso);
    if (error) return error;
    const running = openSession(s);
    if (running && running.taskId === p.taskId)
      return fail('Cierra la sesión abierta para terminar esta tarea.');
    const n = copy(s),
      t = taskById(n, p.taskId);
    Object.assign(t, { status: 'done', completedAt: iso, updatedAt: iso });
    return ok(n);
  }
  function pauseTask(s, p, iso) {
    const error = validTask(s, p.taskId, iso);
    if (error) return error;
    const running = openSession(s);
    if (running && running.taskId === p.taskId)
      return fail('Cierra la sesión abierta antes de pausar la tarea.');
    if (taskById(s, p.taskId).status === 'done') return fail('Esta tarea ya está terminada.');
    const n = copy(s),
      t = taskById(n, p.taskId);
    t.status = 'paused';
    t.updatedAt = iso;
    n.plans.forEach((plan) => {
      if (plan.taskIds.includes(t.id)) {
        plan.taskIds = plan.taskIds.filter((id) => id !== t.id);
        plan.updatedAt = iso;
      }
    });
    return ok(n);
  }
  function resumeTask(s, p, iso) {
    const error = validTask(s, p.taskId, iso);
    if (error) return error;
    if (taskById(s, p.taskId).status !== 'paused') return fail('La tarea no está en pausa.');
    const n = copy(s),
      t = taskById(n, p.taskId);
    t.status = t.nextAction ? 'active' : 'inbox';
    t.updatedAt = iso;
    return ok(n);
  }
  function rescheduleTask(s, p, iso) {
    const error = validTask(s, p.taskId, iso);
    if (error) return error;
    if (!day(p.toDate) || !day(p.fromDate)) return fail('Elige una fecha válida.');
    if (p.toDate <= p.fromDate) return fail('Elige una fecha posterior al día de hoy.');
    const t = taskById(s, p.taskId);
    if (!t.nextAction || ['paused', 'done'].includes(t.status))
      return fail('Solo puedes mover una tarea activa con su acción definida.');
    const n = copy(s),
      from = n.plans.find((x) => x.date === p.fromDate);
    if (from) {
      from.taskIds = from.taskIds.filter((id) => id !== p.taskId);
      from.updatedAt = iso;
    }
    const to = planFor(n, p.toDate, iso);
    if (!to.taskIds.includes(p.taskId)) to.taskIds.push(p.taskId);
    return ok(n);
  }
  function startSession(s, p, iso) {
    const error = validTask(s, p.taskId, iso);
    if (error) return error;
    const running = openSession(s),
      t = taskById(s, p.taskId);
    if (running)
      return running.taskId === p.taskId
        ? ok(s)
        : fail('Ya tienes una sesión abierta. Ciérrala antes de empezar otra.');
    if (!t.nextAction) return fail('Define la siguiente acción antes de empezar.');
    if (['paused', 'done'].includes(t.status))
      return fail('Esta tarea no está disponible para una sesión.');
    const n = copy(s);
    n.sessions.push({
      id: uid('session'),
      taskId: t.id,
      title: t.title,
      action: t.nextAction,
      startedAt: iso,
      endedAt: null,
      pausedAt: null,
      pausedMs: 0,
      progress: null,
      nextStep: t.nextAction,
      finished: false,
      updatedAt: iso,
    });
    return ok(n);
  }
  function sessionChange(s, iso) {
    const x = openSession(s);
    if (!x) return fail('No hay una sesión abierta.');
    if (
      !stamp(iso) ||
      Date.parse(iso) < Date.parse(x.startedAt) ||
      Date.parse(iso) < Date.parse(x.updatedAt)
    )
      return fail('El reloj del equipo cambió. Revisa la fecha y vuelve a intentar.');
    const n = copy(s);
    return { ok: true, state: n, session: n.sessions.find((a) => a.id === x.id) };
  }
  function pauseSession(s, p, iso) {
    const r = sessionChange(s, iso);
    if (!r.ok) return r;
    if (r.session.pausedAt) return ok(s);
    r.session.pausedAt = iso;
    r.session.updatedAt = iso;
    return ok(r.state);
  }
  function resumeSession(s, p, iso) {
    const r = sessionChange(s, iso);
    if (!r.ok) return r;
    if (!r.session.pausedAt) return ok(s);
    r.session.pausedMs += Math.max(0, Date.parse(iso) - Date.parse(r.session.pausedAt));
    r.session.pausedAt = null;
    r.session.updatedAt = iso;
    return ok(r.state);
  }
  function closeSession(s, p, iso) {
    const r = sessionChange(s, iso);
    if (!r.ok) return r;
    if (!progress.includes(p.progress)) return fail('Elige cómo te fue en esta sesión.');
    const next =
      p.nextStep === undefined ? taskById(s, r.session.taskId).nextAction : text(p.nextStep);
    if (!p.finished && (!next || next.length > 500))
      return fail('Define el siguiente paso (máximo 500 caracteres).');
    const x = r.session,
      t = taskById(r.state, x.taskId);
    if (x.pausedAt) x.pausedMs += Math.max(0, Date.parse(iso) - Date.parse(x.pausedAt));
    Object.assign(x, {
      endedAt: iso,
      pausedAt: null,
      progress: p.finished ? 'yes' : p.progress,
      nextStep: p.finished ? null : next,
      finished: !!p.finished,
      updatedAt: iso,
    });
    if (p.finished) Object.assign(t, { status: 'done', completedAt: iso, updatedAt: iso });
    else Object.assign(t, { nextAction: next, status: 'active', updatedAt: iso });
    return ok(r.state);
  }
  function sessionDuration(x, iso) {
    const until = x.endedAt || x.pausedAt || iso;
    if (!stamp(until)) return 0;
    return Math.max(0, Date.parse(until) - Date.parse(x.startedAt) - (x.pausedMs || 0));
  }
  // filtra antes de ordenar: solo se ordena el tramo pedido, con el mismo orden de siempre
  function sessionsBetween(s, from, to) {
    const start = Date.parse(from);
    const end = Date.parse(to);
    return newestFirst(
      s.sessions.filter((x) => {
        const at = Date.parse(x.startedAt);
        return !!x.endedAt && at >= start && at < end;
      }),
    );
  }
  function sessionsTotalDuration(xs, iso) {
    return xs.reduce((total, x) => total + sessionDuration(x, iso || x.endedAt), 0);
  }
  // los totales no dependen del orden: se suman sin ordenar el historial
  function taskTotalDuration(s, id) {
    return sessionsTotalDuration(
      s.sessions.filter((x) => x.endedAt && x.taskId === id),
      null,
    );
  }
  function sessionStats(s) {
    const xs = s.sessions.filter((x) => x.endedAt);
    return {
      count: xs.length,
      totalMs: sessionsTotalDuration(xs, null),
      completedTasks: s.tasks.filter((t) => t.status === 'done').length,
    };
  }
  function stampSave(s, iso) {
    const n = copy(s);
    n.savedAt = iso;
    return n;
  }
  function validateState(s) {
    if (!record(s) || !safeTree(s, 0) || s.schemaVersion !== VERSION)
      return fail('Formato o versión de datos no compatible.');
    if (!Array.isArray(s.tasks) || !Array.isArray(s.plans) || !Array.isArray(s.sessions))
      return fail('El archivo debe contener tareas, planes y sesiones.');
    if (s.tasks.length > 10000 || s.sessions.length > 50000 || s.plans.length > 20000)
      return fail('El archivo supera los límites de esta versión.');
    if (s.savedAt !== null && !stamp(s.savedAt)) return fail('La fecha de guardado no es válida.');
    const ids = new Set(),
      sessionIds = new Set(),
      dates = new Set();
    for (const t of s.tasks) {
      if (!record(t) || typeof t.id !== 'string' || !t.id || t.id.length > 128 || ids.has(t.id))
        return fail('Hay tareas con identificadores inválidos o repetidos.');
      ids.add(t.id);
      if (
        typeof t.title !== 'string' ||
        !t.title.trim() ||
        t.title.length > 240 ||
        !statuses.includes(t.status)
      )
        return fail('Hay una tarea con nombre o estado inválido.');
      if (
        t.nextAction !== null &&
        (typeof t.nextAction !== 'string' || !t.nextAction.trim() || t.nextAction.length > 500)
      )
        return fail('Hay una siguiente acción inválida.');
      if (t.outcome !== null && (typeof t.outcome !== 'string' || t.outcome.length > 500))
        return fail('Hay un resultado esperado inválido.');
      if (
        !stamp(t.createdAt) ||
        !stamp(t.updatedAt) ||
        Date.parse(t.updatedAt) < Date.parse(t.createdAt)
      )
        return fail('Las fechas de una tarea no son válidas.');
      if (
        t.status === 'done' &&
        (!stamp(t.completedAt) || Date.parse(t.completedAt) < Date.parse(t.createdAt))
      )
        return fail('Una tarea terminada necesita una fecha de cierre válida.');
      if (t.status !== 'done' && t.completedAt !== null)
        return fail('Una tarea pendiente no puede tener fecha de cierre.');
      if (t.status === 'active' && !t.nextAction)
        return fail('Una tarea activa necesita una siguiente acción.');
    }
    for (const p of s.plans) {
      if (
        !record(p) ||
        !day(p.date) ||
        dates.has(p.date) ||
        !Array.isArray(p.taskIds) ||
        !stamp(p.updatedAt)
      )
        return fail('Hay un plan diario inválido.');
      dates.add(p.date);
      if (new Set(p.taskIds).size !== p.taskIds.length || p.taskIds.some((id) => !ids.has(id)))
        return fail('Un plan contiene tareas inexistentes o repetidas.');
    }
    let opened = 0;
    for (const x of s.sessions) {
      if (
        !record(x) ||
        typeof x.id !== 'string' ||
        !x.id ||
        x.id.length > 128 ||
        sessionIds.has(x.id) ||
        !ids.has(x.taskId)
      )
        return fail('Hay sesiones con identificadores o tareas inválidos.');
      sessionIds.add(x.id);
      if (
        !stamp(x.startedAt) ||
        !stamp(x.updatedAt) ||
        Date.parse(x.updatedAt) < Date.parse(x.startedAt) ||
        !Number.isFinite(x.pausedMs) ||
        x.pausedMs < 0 ||
        typeof x.finished !== 'boolean'
      )
        return fail('Las fechas o pausas de una sesión no son válidas.');
      if (
        typeof x.title !== 'string' ||
        x.title.length > 240 ||
        typeof x.action !== 'string' ||
        !x.action.trim() ||
        x.action.length > 500
      )
        return fail('Hay una sesión con acción o título inválido.');
      if (
        x.pausedAt !== null &&
        (!stamp(x.pausedAt) ||
          Date.parse(x.pausedAt) < Date.parse(x.startedAt) ||
          Date.parse(x.pausedAt) > Date.parse(x.updatedAt))
      )
        return fail('La fecha de pausa no es válida.');
      if (x.pausedMs > Date.parse(x.updatedAt) - Date.parse(x.startedAt))
        return fail('La duración de la pausa no es válida.');
      if (x.endedAt !== null) {
        if (
          !stamp(x.endedAt) ||
          Date.parse(x.endedAt) < Date.parse(x.startedAt) ||
          Date.parse(x.updatedAt) < Date.parse(x.endedAt) ||
          !progress.includes(x.progress) ||
          x.pausedAt !== null
        )
          return fail('Hay una sesión cerrada inválida.');
        if (x.pausedMs > Date.parse(x.endedAt) - Date.parse(x.startedAt))
          return fail('La pausa supera la duración de la sesión.');
        if (
          x.finished
            ? x.nextStep !== null
            : typeof x.nextStep !== 'string' || !x.nextStep.trim() || x.nextStep.length > 500
        )
          return fail('El siguiente paso de una sesión no es válido.');
      } else {
        opened++;
        if (
          ['done', 'paused'].includes(taskById(s, x.taskId).status) ||
          x.progress !== null ||
          x.finished
        )
          return fail('La sesión abierta no corresponde a una tarea activa.');
        if (x.pausedAt && x.pausedMs > Date.parse(x.pausedAt) - Date.parse(x.startedAt))
          return fail('La duración de pausa no es válida.');
      }
    }
    if (opened > 1) return fail('Hay más de una sesión abierta. Cierra una antes de sincronizar.');
    return { ok: true };
  }
  function migrate(value) {
    if (!record(value)) return value;
    const s = copy(value);
    // Solo migra v1 si coincide con el contrato conocido. Nunca inventa planes desconocidos.
    if (
      s.schemaVersion === 1 &&
      safeTree(s, 0) &&
      Array.isArray(s.tasks) &&
      Array.isArray(s.plans) &&
      Array.isArray(s.sessions)
    ) {
      s.schemaVersion = VERSION;
      s.savedAt = s.savedAt || null;
      s.tasks = s.tasks.map((t) =>
        Object.assign({ outcome: null, nextAction: null, completedAt: null }, t),
      );
      s.sessions = s.sessions.map((x) =>
        Object.assign(
          {
            pausedAt: null,
            pausedMs: 0,
            finished: x.nextStep === null && !!x.endedAt,
            title: (taskById(s, x.taskId) || {}).title || '',
            action: (taskById(s, x.taskId) || {}).nextAction || '',
          },
          x,
        ),
      );
    }
    return s;
  }
  function exportState(s) {
    return JSON.stringify(s, null, 2) + '\n';
  }
  function importState(current, input) {
    if (typeof input !== 'string' || input.length > 5 * 1024 * 1024)
      return fail('El archivo debe ser JSON y pesar como máximo 5 MB.');
    let s;
    try {
      s = migrate(JSON.parse(input));
    } catch (e) {
      return fail('El archivo no contiene JSON válido.');
    }
    const checked = validateState(s);
    return checked.ok ? ok(s) : checked;
  }
  function mergeStates(base, local, remote, iso) {
    const vl = validateState(local),
      vr = validateState(remote);
    if (!vl.ok || !vr.ok || !stamp(iso)) return fail('No es posible fusionar datos inválidos.');
    if (same(local, remote)) return ok(local);
    const b = base && validateState(base).ok ? base : emptyState();
    function mergeRows(key, idKey) {
      const bm = new Map(b[key].map((v) => [v[idKey], v])),
        lm = new Map(local[key].map((v) => [v[idKey], v])),
        rm = new Map(remote[key].map((v) => [v[idKey], v]));
      const result = [];
      for (const id of new Set([...lm.keys(), ...rm.keys()])) {
        const bv = bm.get(id),
          lv = lm.get(id),
          rv = rm.get(id);
        if (same(lv, bv)) {
          if (rv) result.push(copy(rv));
          continue;
        }
        if (same(rv, bv)) {
          if (lv) result.push(copy(lv));
          continue;
        }
        if (!lv || !rv) {
          if (lv || rv) result.push(copy(lv || rv));
          continue;
        }
        const winner = Date.parse(lv.updatedAt) >= Date.parse(rv.updatedAt) ? lv : rv;
        const out = copy(winner);
        for (const field of Object.keys(out)) {
          if (['__proto__', 'constructor', 'prototype'].includes(field)) continue;
          if (bv && same(lv[field], bv[field])) out[field] = copy(rv[field]);
          else if (bv && same(rv[field], bv[field])) out[field] = copy(lv[field]);
        }
        if (key === 'plans') {
          const original = new Set(bv ? bv.taskIds : []);
          const removed = new Set(
            [...original].filter(
              (taskId) => !lv.taskIds.includes(taskId) || !rv.taskIds.includes(taskId),
            ),
          );
          out.taskIds = [...new Set([...winner.taskIds, ...lv.taskIds, ...rv.taskIds])].filter(
            (taskId) => !removed.has(taskId),
          );
        }
        result.push(out);
      }
      return result;
    }
    try {
      const n = {
        schemaVersion: VERSION,
        savedAt: iso,
        tasks: mergeRows('tasks', 'id'),
        plans: mergeRows('plans', 'date'),
        sessions: mergeRows('sessions', 'id'),
      };
      const validIds = new Set(n.tasks.map((t) => t.id));
      n.plans.forEach((p) => {
        p.taskIds = p.taskIds.filter((id) => validIds.has(id));
      });
      const checked = validateState(n);
      return checked.ok ? ok(n) : checked;
    } catch (e) {
      return fail('No fue posible fusionar estos cambios. La copia local sigue intacta.');
    }
  }
  const api = {
    SCHEMA_VERSION: VERSION,
    emptyState,
    taskById,
    openSession,
    closedSessions,
    inbox,
    todayPlan,
    captureTask,
    defineTask,
    chooseForToday,
    moveToFirst,
    removeFromToday,
    markTaskDone,
    pauseTask,
    resumeTask,
    rescheduleTask,
    startSession,
    pauseSession,
    resumeSession,
    closeSession,
    sessionDuration,
    sessionsBetween,
    sessionsTotalDuration,
    taskTotalDuration,
    sessionStats,
    stampSave,
    validateState,
    migrate,
    exportState,
    importState,
    mergeStates,
  };
  root.SiguienteCore = Object.freeze(api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
