/* core.js — dominio, casos de uso y serialización de "Siguiente".
   Sin DOM y sin reloj propio: la interfaz inyecta now() (marca ISO 8601 UTC). */
(function () {
  'use strict';

  // versión de esquema del estado persistido
  var SCHEMA_VERSION = 1;

  // contador interno: asegura ids únicos dentro de una misma ejecución
  var seq = 0;

  // convierte una marca ISO 8601 a milisegundos desde epoch
  function toMs(iso) {
    return new Date(iso).getTime();
  }

  // genera un id: tramo aleatorio + contador + tiempo del reloj inyectado, en base36
  function uid(now) {
    seq += 1;
    var rand = Math.random().toString(36).slice(2, 10);
    var time = now ? toMs(now).toString(36) : '0';
    return rand + seq.toString(36) + time;
  }

  // copia profunda de datos planos
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  // resultado correcto de un caso de uso
  function ok(state) {
    return { ok: true, state: state };
  }

  // resultado con error descriptivo (nunca se lanza una excepción)
  function err(message) {
    return { ok: false, error: message };
  }

  // cadena con contenido tras recortar espacios
  function filled(value) {
    return typeof value === 'string' && value.trim() !== '';
  }

  // fecha local 'YYYY-MM-DD' bien formada y real (el núcleo la valida, nunca la calcula)
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var parts = value.split('-');
    var y = Number(parts[0]);
    var m = Number(parts[1]);
    var d = Number(parts[2]);
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  // estado inicial vacío
  function emptyState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      revision: 0,
      savedAt: null,
      tasks: [],
      plans: [],
      planItems: [],
      sessions: []
    };
  }

  // normaliza un estado a la versión de esquema actual (idempotente)
  function migrate(state) {
    var s = clone(state || {});
    // futuras migraciones por versión irían aquí, en orden ascendente
    s.schemaVersion = SCHEMA_VERSION;
    ['tasks', 'plans', 'planItems', 'sessions'].forEach(function (key) {
      if (!Array.isArray(s[key])) s[key] = [];
    });
    if (typeof s.revision !== 'number') s.revision = 0;
    if (!('savedAt' in s)) s.savedAt = null;
    s.sessions = s.sessions.map(function (ses) {
      if (!ses || typeof ses !== 'object') return ses;
      var patch = {};
      if (!('pausedAt' in ses)) patch.pausedAt = null;
      if (typeof ses.pausedMs !== 'number') patch.pausedMs = 0;
      return Object.assign({}, ses, patch);
    });
    return s;
  }

  // sella el estado antes de guardar: sube la revisión y fija savedAt
  function stampSave(state, now) {
    var base = typeof state.revision === 'number' ? state.revision : 0;
    return Object.assign({}, state, { revision: base + 1, savedAt: now });
  }

  // busca una tarea por id
  function findTask(state, taskId) {
    return state.tasks.filter(function (t) { return t.id === taskId; })[0] || null;
  }

  // busca el plan diario de una fecha
  function findPlan(state, date) {
    return state.plans.filter(function (p) { return p.date === date; })[0] || null;
  }

  // items de un plan, ordenados por order
  function itemsOfPlan(state, planId) {
    return state.planItems
      .filter(function (i) { return i.planId === planId; })
      .sort(function (a, b) { return a.order - b.order; });
  }

  // devuelve la lista de tareas con una tarea reemplazada
  function replaceTask(tasks, task) {
    return tasks.map(function (t) { return t.id === task.id ? task : t; });
  }

  // renumera los items de un plan a 0..n-1 respetando el orden actual
  function renumber(planItems, planId) {
    var ordered = planItems
      .filter(function (i) { return i.planId === planId; })
      .sort(function (a, b) { return a.order - b.order; });
    var others = planItems.filter(function (i) { return i.planId !== planId; });
    var fixed = ordered.map(function (i, idx) {
      return Object.assign({}, i, { order: idx });
    });
    return others.concat(fixed);
  }

  // captura: una tarea nueva solo con título entra a la bandeja
  function captureTask(state, data, now) {
    var title = data && data.title;
    if (!filled(title)) return err('El título no puede estar vacío.');
    var task = {
      id: uid(now),
      title: title.trim(),
      outcome: null,
      nextAction: null,
      status: 'inbox',
      dueDate: null,
      createdAt: now,
      updatedAt: now
    };
    return ok(Object.assign({}, state, { tasks: state.tasks.concat([task]) }));
  }

  // definición: fija resultado (opcional) y siguiente acción (obligatoria); pasa a 'active'
  function defineTask(state, data, now) {
    var task = findTask(state, data && data.taskId);
    if (!task) return err('No se encontró la tarea.');
    if (task.status === 'done') return err('La tarea ya está terminada.');
    if (!filled(data && data.nextAction)) return err('La siguiente acción es obligatoria.');
    var updated = Object.assign({}, task, {
      outcome: filled(data.outcome) ? data.outcome.trim() : null,
      nextAction: data.nextAction.trim(),
      status: 'active',
      updatedAt: now
    });
    return ok(Object.assign({}, state, { tasks: replaceTask(state.tasks, updated) }));
  }

  // elegir para hoy: añade la tarea al plan del día sin duplicar
  function chooseForToday(state, data, now) {
    var task = findTask(state, data && data.taskId);
    if (!task) return err('No se encontró la tarea.');
    if (task.status === 'done') return err('La tarea ya está terminada.');
    if (!filled(task.nextAction)) return err('Define la siguiente acción antes de elegir la tarea para hoy.');
    if (!filled(data && data.date)) return err('Falta la fecha del plan.');

    // toma el plan del día o lo crea
    var plan = findPlan(state, data.date);
    var plans = state.plans;
    if (!plan) {
      plan = { id: uid(now), date: data.date, note: null, createdAt: now };
      plans = state.plans.concat([plan]);
    }

    // si la tarea ya está en ese plan, no se duplica
    var already = state.planItems.filter(function (i) {
      return i.planId === plan.id && i.taskId === task.id;
    })[0];
    if (already) return ok(state);

    var item = {
      id: uid(now),
      planId: plan.id,
      taskId: task.id,
      order: itemsOfPlan(state, plan.id).length
    };
    return ok(Object.assign({}, state, {
      plans: plans,
      planItems: state.planItems.concat([item])
    }));
  }

  // subir al primer lugar: la tarea pasa a order 0 dentro del plan del día
  function moveToFirst(state, data) {
    var plan = findPlan(state, data && data.date);
    if (!plan) return err('No hay plan para esa fecha.');
    var ordered = itemsOfPlan(state, plan.id);
    var target = ordered.filter(function (i) { return i.taskId === (data && data.taskId); })[0];
    if (!target) return err('La tarea no está en el plan de hoy.');
    var rest = ordered.filter(function (i) { return i.id !== target.id; });
    var reordered = [target].concat(rest).map(function (i, idx) {
      return Object.assign({}, i, { order: idx });
    });
    var others = state.planItems.filter(function (i) { return i.planId !== plan.id; });
    return ok(Object.assign({}, state, { planItems: others.concat(reordered) }));
  }

  // quitar de hoy: saca la tarea del plan del día y renumera el resto
  function removeFromToday(state, data) {
    var plan = findPlan(state, data && data.date);
    if (!plan) return ok(state);
    var target = state.planItems.filter(function (i) {
      return i.planId === plan.id && i.taskId === (data && data.taskId);
    })[0];
    if (!target) return ok(state);
    var kept = state.planItems.filter(function (i) { return i.id !== target.id; });
    return ok(Object.assign({}, state, { planItems: renumber(kept, plan.id) }));
  }

  // pausar: aparta la tarea de todos los planes sin terminarla ni tocar su historial
  // se retoma cuando la persona quiera, con 'Elegir para hoy'
  function pauseTask(state, data) {
    var task = findTask(state, data && data.taskId);
    if (!task) return err('No se encontró la tarea.');
    if (task.status === 'done') return err('La tarea ya está terminada.');
    var own = openSession(state);
    if (own && own.taskId === task.id) {
      return err('Cierra la sesión abierta antes de apartar la tarea.');
    }
    var touched = {};
    var kept = state.planItems.filter(function (i) {
      if (i.taskId === task.id) { touched[i.planId] = true; return false; }
      return true;
    });
    Object.keys(touched).forEach(function (planId) {
      kept = renumber(kept, planId);
    });
    return ok(Object.assign({}, state, { planItems: kept }));
  }

  // reprogramar: mueve la tarea del plan de un día al plan de otro
  // solo cambia la fecha de trabajo: el vencimiento (dueDate) queda intacto
  function rescheduleTask(state, data, now) {
    var task = findTask(state, data && data.taskId);
    if (!task) return err('No se encontró la tarea.');
    if (task.status === 'done') return err('La tarea ya está terminada.');
    if (!filled(task.nextAction)) return err('Define la siguiente acción antes de reprogramar la tarea.');
    if (!validDate(data && data.fromDate) || !validDate(data && data.toDate)) {
      return err('Las fechas del cambio no son válidas.');
    }
    if (data.fromDate === data.toDate) {
      return err('Elige un día distinto al actual del plan.');
    }
    var fromPlan = findPlan(state, data.fromDate);
    var target = fromPlan && state.planItems.filter(function (i) {
      return i.planId === fromPlan.id && i.taskId === task.id;
    })[0];
    if (!fromPlan || !target) return err('La tarea no está en el plan de ese día.');

    // quita el item del plan origen y renumera el resto
    var kept = state.planItems.filter(function (i) { return i.id !== target.id; });
    kept = renumber(kept, fromPlan.id);

    // toma el plan destino o lo crea; si la tarea ya está ahí, no se duplica
    var toPlan = findPlan(state, data.toDate);
    var plans = state.plans;
    if (!toPlan) {
      toPlan = { id: uid(now), date: data.toDate, note: null, createdAt: now };
      plans = state.plans.concat([toPlan]);
    }
    var already = kept.filter(function (i) {
      return i.planId === toPlan.id && i.taskId === task.id;
    })[0];
    if (already) return ok(Object.assign({}, state, { plans: plans, planItems: kept }));

    var count = kept.filter(function (i) { return i.planId === toPlan.id; }).length;
    var item = { id: uid(now), planId: toPlan.id, taskId: task.id, order: count };
    return ok(Object.assign({}, state, {
      plans: plans,
      planItems: kept.concat([item])
    }));
  }

  // empezar: abre una sesión de trabajo; solo puede haber una abierta a la vez
  function startSession(state, data, now) {
    if (openSession(state)) {
      return err('Ya hay una sesión abierta. Ciérrala antes de empezar otra.');
    }
    var task = findTask(state, data && data.taskId);
    if (!task) return err('No se encontró la tarea.');
    if (task.status === 'done') return err('La tarea ya está terminada.');
    if (!filled(task.nextAction)) return err('La tarea no tiene una siguiente acción.');
    var session = {
      id: uid(now),
      taskId: task.id,
      startedAt: now,
      endedAt: null,
      pausedAt: null,
      pausedMs: 0,
      progress: null,
      nextStep: null
    };
    return ok(Object.assign({}, state, { sessions: state.sessions.concat([session]) }));
  }

  // pausar sesión: congela el cronómetro fijando pausedAt; el tiempo deja de correr
  function pauseSession(state, data, now) {
    var session = openSession(state);
    if (!session) return err('No hay ninguna sesión abierta.');
    if (session.pausedAt) return ok(state);
    var paused = Object.assign({}, session, { pausedAt: now });
    return ok(Object.assign({}, state, {
      sessions: state.sessions.map(function (s) { return s.id === session.id ? paused : s; })
    }));
  }

  // reanudar: el tiempo vuelve a correr y la pausa queda acumulada en pausedMs
  function resumeSession(state, data, now) {
    var session = openSession(state);
    if (!session) return err('No hay ninguna sesión abierta.');
    if (!session.pausedAt) return ok(state);
    var extra = toMs(now) - toMs(session.pausedAt);
    var resumed = Object.assign({}, session, {
      pausedAt: null,
      pausedMs: (typeof session.pausedMs === 'number' ? session.pausedMs : 0) + (extra > 0 ? extra : 0)
    });
    return ok(Object.assign({}, state, {
      sessions: state.sessions.map(function (s) { return s.id === session.id ? resumed : s; })
    }));
  }

  // cerrar: sella la sesión y, según el resultado, actualiza la acción o termina la tarea
  function closeSession(state, data, now) {
    var session = openSession(state);
    if (!session) return err('No hay ninguna sesión abierta.');
    var progress = data && data.progress;
    if (progress !== 'yes' && progress !== 'some' && progress !== 'no') {
      return err('Indica si avanzaste.');
    }
    var finished = !!(data && data.finished);
    var task = findTask(state, session.taskId);

    // acción al volver: la escrita; si viene vacía, se conserva la actual
    var nextAction = filled(data && data.nextStep)
      ? data.nextStep.trim()
      : (task ? task.nextAction : null);

    // si estaba en pausa al cerrar, ese tramo también se descuenta
    var pausedMs = (typeof session.pausedMs === 'number' ? session.pausedMs : 0) +
      (session.pausedAt ? Math.max(0, toMs(now) - toMs(session.pausedAt)) : 0);

    var closed = Object.assign({}, session, {
      endedAt: now,
      progress: progress,
      nextStep: finished ? null : nextAction,
      pausedAt: null,
      pausedMs: pausedMs
    });
    var sessions = state.sessions.map(function (s) {
      return s.id === session.id ? closed : s;
    });
    var next = Object.assign({}, state, { sessions: sessions });

    if (!task) return ok(next);
    if (finished) return ok(applyDone(next, task, now));

    var updated = Object.assign({}, task, { nextAction: nextAction, updatedAt: now });
    return ok(Object.assign({}, next, { tasks: replaceTask(next.tasks, updated) }));
  }

  // marca una tarea como hecha: la saca de todos los planes y conserva sus sesiones
  function markTaskDone(state, data, now) {
    var task = findTask(state, data && data.taskId);
    if (!task) return err('No se encontró la tarea.');
    return ok(applyDone(state, task, now));
  }

  // aplica el paso a 'done' y limpia los items de plan de esa tarea
  function applyDone(state, task, now) {
    var done = Object.assign({}, task, { status: 'done', updatedAt: now });
    var touched = {};
    var kept = state.planItems.filter(function (i) {
      if (i.taskId === task.id) { touched[i.planId] = true; return false; }
      return true;
    });
    Object.keys(touched).forEach(function (planId) {
      kept = renumber(kept, planId);
    });
    return Object.assign({}, state, {
      tasks: replaceTask(state.tasks, done),
      planItems: kept
    });
  }

  // serializa el estado a JSON legible
  function exportState(state) {
    return JSON.stringify(state, null, 2);
  }

  // --- validación estricta de esquema (se usa al importar y la replica el Worker) ---

  // marca ISO 8601 con tiempo, como las que produce toISOString
  var ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
  // fecha de plan YYYY-MM-DD
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // cadena o null
  function optStr(v) { return v === null || typeof v === 'string'; }
  // entero mayor o igual a cero
  function nonNegInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0; }
  // marca ISO o null
  function isoOrNull(v) { return v === null || (typeof v === 'string' && ISO_RE.test(v)); }

  // valida en estricto un estado ya migrado: campos, tipos y valores de cada colección
  function validateState(value) {
    var SHAPE = 'El archivo no tiene la estructura esperada.';
    if (!value || typeof value !== 'object' || Array.isArray(value)) return err(SHAPE);
    if (value.schemaVersion !== SCHEMA_VERSION) return err('La versión de esquema no es compatible.');
    if (typeof value.revision !== 'number' || !isFinite(value.revision)) return err(SHAPE);
    if (!(value.savedAt === null || typeof value.savedAt === 'string')) return err(SHAPE);
    var cols = ['tasks', 'plans', 'planItems', 'sessions'];
    for (var c = 0; c < cols.length; c++) {
      if (!Array.isArray(value[cols[c]])) return err(SHAPE);
    }
    var i, t, p, it, s;
    for (i = 0; i < value.tasks.length; i++) {
      t = value.tasks[i];
      if (!t || typeof t !== 'object') return err('Hay una tarea con formato incorrecto.');
      if (!filled(t.id) || typeof t.title !== 'string') return err('Hay una tarea con formato incorrecto.');
      if (t.status !== 'inbox' && t.status !== 'active' && t.status !== 'done') return err('Hay una tarea con formato incorrecto.');
      if (!optStr(t.outcome) || !optStr(t.nextAction) || !optStr(t.dueDate)) return err('Hay una tarea con formato incorrecto.');
      if (!isoOrNull(t.createdAt) || !isoOrNull(t.updatedAt)) return err('Hay una tarea con formato incorrecto.');
    }
    for (i = 0; i < value.plans.length; i++) {
      p = value.plans[i];
      if (!p || typeof p !== 'object') return err('Hay un plan con formato incorrecto.');
      if (!filled(p.id) || typeof p.date !== 'string' || !DATE_RE.test(p.date)) return err('Hay un plan con formato incorrecto.');
      if (!optStr(p.note) || !isoOrNull(p.createdAt)) return err('Hay un plan con formato incorrecto.');
    }
    for (i = 0; i < value.planItems.length; i++) {
      it = value.planItems[i];
      if (!it || typeof it !== 'object') return err('Hay un elemento de plan con formato incorrecto.');
      if (!filled(it.id) || !filled(it.planId) || !filled(it.taskId) || !nonNegInt(it.order)) {
        return err('Hay un elemento de plan con formato incorrecto.');
      }
    }
    for (i = 0; i < value.sessions.length; i++) {
      s = value.sessions[i];
      if (!s || typeof s !== 'object') return err('Hay una sesión con formato incorrecto.');
      if (!filled(s.id) || !filled(s.taskId)) return err('Hay una sesión con formato incorrecto.');
      if (typeof s.startedAt !== 'string' || !ISO_RE.test(s.startedAt)) return err('Hay una sesión con formato incorrecto.');
      if (!isoOrNull(s.endedAt) || !isoOrNull(s.pausedAt)) return err('Hay una sesión con formato incorrecto.');
      if (s.progress !== null && s.progress !== 'yes' && s.progress !== 'some' && s.progress !== 'no') {
        return err('Hay una sesión con formato incorrecto.');
      }
      if (!optStr(s.nextStep)) return err('Hay una sesión con formato incorrecto.');
      if (typeof s.pausedMs !== 'number' || !isFinite(s.pausedMs) || s.pausedMs < 0) {
        return err('Hay una sesión con formato incorrecto.');
      }
    }
    return ok(value);
  }

  // importa un JSON: valida y reemplaza; si algo falla, el estado anterior queda intacto
  function importState(state, json) {
    var parsed;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      return err('El archivo no es JSON válido.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return err('El archivo no tiene la estructura esperada.');
    }
    if (typeof parsed.schemaVersion !== 'number' || parsed.schemaVersion !== SCHEMA_VERSION) {
      return err('La versión de esquema no es compatible.');
    }
    var collections = ['tasks', 'plans', 'planItems', 'sessions'];
    for (var k = 0; k < collections.length; k++) {
      if (!Array.isArray(parsed[collections[k]])) {
        return err('El archivo no tiene la estructura esperada.');
      }
    }
    var migrated = migrate(parsed);
    var v = validateState(migrated);
    if (!v.ok) return err(v.error);
    // la revisión nunca baja: una copia antigua restaurada debe ganar a lo que ya hay en los demás equipos
    if (state && typeof state.revision === 'number' && state.revision > migrated.revision) {
      migrated.revision = state.revision;
    }
    return ok(migrated);
  }

  // consulta: contenido de la bandeja (tareas sin terminar), más antiguas primero
  function inbox(state) {
    return state.tasks
      .filter(function (t) { return t.status === 'inbox' || t.status === 'active'; })
      .sort(function (a, b) {
        return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
      });
  }

  // consulta: plan de un día como lista ordenada de items con su tarea
  function todayPlan(state, date) {
    var plan = findPlan(state, date);
    if (!plan) return [];
    return itemsOfPlan(state, plan.id).map(function (i) {
      return {
        id: i.id,
        planId: i.planId,
        taskId: i.taskId,
        order: i.order,
        task: findTask(state, i.taskId)
      };
    });
  }

  // consulta: la sesión abierta, o null
  function openSession(state) {
    return state.sessions.filter(function (s) {
      return s.endedAt === null || s.endedAt === undefined;
    })[0] || null;
  }

  // consulta: la primera acción del plan de un día, o null
  function firstActionOf(state, date) {
    var list = todayPlan(state, date);
    return list.length ? list[0] : null;
  }

  // consulta: duración de una sesión en milisegundos, siempre desde marcas de tiempo
  // fin = endedAt (cerrada), pausedAt (en pausa, el tiempo queda congelado) o el reloj; se descuenta lo pausado
  function sessionDuration(session, now) {
    if (!session || !session.startedAt) return 0;
    var start = toMs(session.startedAt);
    var end = session.endedAt ? toMs(session.endedAt)
      : session.pausedAt ? toMs(session.pausedAt)
      : toMs(now);
    var paused = typeof session.pausedMs === 'number' ? session.pausedMs : 0;
    var ms = end - start - paused;
    return ms > 0 ? ms : 0;
  }

  // consulta: una tarea por id, o null
  function taskById(state, taskId) {
    return findTask(state, taskId);
  }

  // consulta: sesiones cerradas, de la más reciente a la más antigua
  function closedSessions(state) {
    return state.sessions
      .filter(function (s) { return s.endedAt; })
      .sort(function (a, b) {
        return a.endedAt < b.endedAt ? 1 : a.endedAt > b.endedAt ? -1 : 0;
      });
  }

  // consulta: sesiones cerradas que empezaron dentro de [startIso, endIso), más antiguas primero
  // la interfaz calcula los límites locales del día o de la semana y los pasa como marcas ISO
  function sessionsBetween(state, startIso, endIso) {
    var from = toMs(startIso);
    var to = toMs(endIso);
    return state.sessions
      .filter(function (s) {
        if (!s.endedAt || !s.startedAt) return false;
        var t = toMs(s.startedAt);
        return t >= from && t < to;
      })
      .sort(function (a, b) {
        return a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0;
      });
  }

  // consulta: totales para la vista Progreso (sesiones cerradas, tiempo sumado, tareas terminadas)
  function sessionStats(state) {
    var closed = closedSessions(state);
    var totalMs = closed.reduce(function (sum, s) {
      return sum + sessionDuration(s, s.endedAt);
    }, 0);
    var completedTasks = state.tasks.filter(function (t) {
      return t.status === 'done';
    }).length;
    return { count: closed.length, totalMs: totalMs, completedTasks: completedTasks };
  }

  // consulta: duración total acumulada de una tarea en milisegundos sumando sus sesiones cerradas
  function taskTotalDuration(state, taskId) {
    return state.sessions
      .filter(function (s) { return s.taskId === taskId && s.endedAt; })
      .reduce(function (sum, s) {
        return sum + sessionDuration(s, s.endedAt);
      }, 0);
  }

  // consulta: suma de duraciones de una lista de sesiones en milisegundos
  // las cerradas cuentan hasta su endedAt; una abierta cuenta hasta el reloj (now)
  function sessionsTotalDuration(sessions, now) {
    return (sessions || []).reduce(function (sum, s) {
      return sum + sessionDuration(s, now);
    }, 0);
  }

  // --- fusión de estados a tres vías (sincronización) ---

  // igualdad profunda de valores planos: el orden de las claves no cuenta
  function deepEq(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    var i;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (i = 0; i < a.length; i++) {
        if (!deepEq(a[i], b[i])) return false;
      }
      return true;
    }
    var ka = Object.keys(a);
    var kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (i = 0; i < ka.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(b, ka[i]) || !deepEq(a[ka[i]], b[ka[i]])) return false;
    }
    return true;
  }

  // estado migrado y validado, o null si no es usable
  function checkedState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    var m = migrate(value);
    return validateState(m).ok ? m : null;
  }

  // lado que resuelve los conflictos de una fusión: el savedAt más reciente; en empate, el remoto
  function winnerSide(localState, remoteState) {
    var l = localState && typeof localState.savedAt === 'string' ? toMs(localState.savedAt) : NaN;
    var r = remoteState && typeof remoteState.savedAt === 'string' ? toMs(remoteState.savedAt) : NaN;
    if (isNaN(l)) l = -Infinity;
    if (isNaN(r)) r = -Infinity;
    return l > r ? 'local' : 'remote';
  }

  // presencia y valor de una propiedad: distinguir "ausente" de "presente con undefined"
  function slotOf(entity, key) {
    if (entity && Object.prototype.hasOwnProperty.call(entity, key)) {
      return { has: true, value: entity[key] };
    }
    return { has: false, value: undefined };
  }

  function sameSlot(a, b) {
    return a.has === b.has && (!a.has || deepEq(a.value, b.value));
  }

  // fusión campo a campo de dos versiones de una misma entidad (baseEnt puede ser null):
  // la regla a tres vías decide por campo y, cuando ambos lados cambiaron el mismo campo
  // de forma distinta, todos esos valores salen del estado con savedAt más reciente
  function mergeFields(baseEnt, localEnt, remoteEnt, localState, remoteState) {
    var keys = {};
    [baseEnt, localEnt, remoteEnt].forEach(function (e) {
      if (e) {
        Object.keys(e).forEach(function (k) { keys[k] = true; });
      }
    });
    var pickLocal = winnerSide(localState, remoteState) === 'local';
    var out = {};
    Object.keys(keys).forEach(function (k) {
      var bs = slotOf(baseEnt, k);
      var ls = slotOf(localEnt, k);
      var rs = slotOf(remoteEnt, k);
      var chosen;
      if (baseEnt) {
        if (sameSlot(ls, bs)) chosen = rs;
        else if (sameSlot(rs, bs)) chosen = ls;
        else if (sameSlot(ls, rs)) chosen = ls;
        else chosen = pickLocal ? ls : rs;
      } else {
        if (sameSlot(ls, rs)) chosen = ls;
        else if (!ls.has) chosen = rs;
        else if (!rs.has) chosen = ls;
        else chosen = pickLocal ? ls : rs;
      }
      if (chosen.has) out[k] = clone(chosen.value);
    });
    return out;
  }

  // fusión de una entidad concreta: null significa "borrada/ausente" en ese lado
  function mergeEntity(baseEnt, localEnt, remoteEnt, localState, remoteState) {
    var hasLocal = !!localEnt;
    var hasRemote = !!remoteEnt;
    if (hasLocal && hasRemote && deepEq(localEnt, remoteEnt)) return localEnt;
    if (baseEnt) {
      var localSame = hasLocal && deepEq(localEnt, baseEnt);
      var remoteSame = hasRemote && deepEq(remoteEnt, baseEnt);
      if (localSame) return remoteEnt;   // el local no la tocó: manda el remoto, incluido su borrado
      if (remoteSame) return localEnt;   // y al revés
      if (!hasLocal) return remoteEnt;   // borrada en un lado y modificada en el otro: se conserva la versión viva
      if (!hasRemote) return localEnt;
      return mergeFields(baseEnt, localEnt, remoteEnt, localState, remoteState);
    }
    if (!hasLocal) return remoteEnt;
    if (!hasRemote) return localEnt;
    return mergeFields(null, localEnt, remoteEnt, localState, remoteState);
  }

  // fusión de una colección por id: primero los ids de la base, luego los solo-locales
  // y al final los solo-remotos; cada id aparece una sola vez
  function mergeCollection(baseList, localList, remoteList, localState, remoteState) {
    function indexOf(list) {
      var map = {};
      (list || []).forEach(function (e) {
        if (e && typeof e.id === 'string' && !Object.prototype.hasOwnProperty.call(map, e.id)) {
          map[e.id] = e;
        }
      });
      return map;
    }
    var bm = indexOf(baseList);
    var lm = indexOf(localList);
    var rm = indexOf(remoteList);
    var seen = {};
    var order = [];
    [baseList, localList, remoteList].forEach(function (list) {
      (list || []).forEach(function (e) {
        var id = e && e.id;
        if (typeof id === 'string' && !seen[id]) {
          seen[id] = true;
          order.push(id);
        }
      });
    });
    var out = [];
    order.forEach(function (id) {
      var merged = mergeEntity(bm[id] || null, lm[id] || null, rm[id] || null, localState, remoteState);
      if (merged) out.push(typeof merged === 'object' ? clone(merged) : merged);
    });
    return out;
  }

  // tras la fusión los items deben seguir siendo coherentes: fuera los que apuntan a un plan
  // o tarea inexistente o a una tarea terminada, un solo item por (planId, taskId) quedándose
  // con el primero del orden fusionado, y order renumerado 0..n-1 por plan usando como
  // desempate la posición que cada item tenía en la lista fusionada
  function normalizePlanItems(state) {
    var plans = {};
    state.plans.forEach(function (p) { plans[p.id] = true; });
    var tasks = {};
    state.tasks.forEach(function (t) { tasks[t.id] = t; });
    var seenPair = {};
    var kept = [];
    state.planItems.forEach(function (it) {
      var t = tasks[it.taskId];
      if (!plans[it.planId] || !t || t.status === 'done') return;
      var pair = it.planId + '|' + it.taskId;
      if (seenPair[pair]) return;
      seenPair[pair] = true;
      kept.push(it);
    });
    var byPlan = {};
    kept.forEach(function (it, pos) {
      if (!byPlan[it.planId]) byPlan[it.planId] = [];
      byPlan[it.planId].push({ item: it, pos: pos });
    });
    Object.keys(byPlan).forEach(function (planId) {
      byPlan[planId].slice().sort(function (a, b) {
        return (a.item.order - b.item.order) || (a.pos - b.pos);
      }).forEach(function (entry, idx) {
        kept[entry.pos] = Object.assign({}, entry.item, { order: idx });
      });
    });
    state.planItems = kept;
  }

  // fusión automática de dos copias del estado contra su ancestro común (base, o null si no
  // se conoce): devuelve el estado fusionado normal o un error; nunca muta las entradas
  function mergeStates(base, local, remote, mergedAt) {
    var b = base == null ? null : checkedState(base);
    if (base != null && !b) return err('El estado base no es válido.');
    var l = checkedState(local);
    if (!l) return err('El estado local no es válido.');
    var r = checkedState(remote);
    if (!r) return err('El estado remoto no es válido.');
    var state = {
      schemaVersion: SCHEMA_VERSION,
      revision: Math.max(l.revision, r.revision) + 1,
      savedAt: mergedAt,
      tasks: mergeCollection(b && b.tasks, l.tasks, r.tasks, l, r),
      plans: mergeCollection(b && b.plans, l.plans, r.plans, l, r),
      planItems: mergeCollection(b && b.planItems, l.planItems, r.planItems, l, r),
      sessions: mergeCollection(b && b.sessions, l.sessions, r.sessions, l, r)
    };
    normalizePlanItems(state);
    var v = validateState(state);
    if (!v.ok) return err(v.error);
    return ok(state);
  }

  // objeto público único
  var SiguienteCore = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    uid: uid,
    emptyState: emptyState,
    migrate: migrate,
    stampSave: stampSave,
    captureTask: captureTask,
    defineTask: defineTask,
    chooseForToday: chooseForToday,
    moveToFirst: moveToFirst,
    removeFromToday: removeFromToday,
    pauseTask: pauseTask,
    rescheduleTask: rescheduleTask,
    startSession: startSession,
    pauseSession: pauseSession,
    resumeSession: resumeSession,
    closeSession: closeSession,
    markTaskDone: markTaskDone,
    exportState: exportState,
    validateState: validateState,
    importState: importState,
    mergeStates: mergeStates,
    inbox: inbox,
    todayPlan: todayPlan,
    openSession: openSession,
    firstActionOf: firstActionOf,
    sessionDuration: sessionDuration,
    taskById: taskById,
    closedSessions: closedSessions,
    sessionsBetween: sessionsBetween,
    sessionStats: sessionStats,
    taskTotalDuration: taskTotalDuration,
    sessionsTotalDuration: sessionsTotalDuration
  };

  // expone el núcleo como global y, en Node, también por module.exports
  globalThis.SiguienteCore = SiguienteCore;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SiguienteCore;
  }
})();
