(function () {
  "use strict";

  var Core = globalThis.SiguienteCore;
  var CAPTURE_DRAFT = "";
  var DEMO_PREV = null;
  var PENDING_IMPORT = null;
  var LOAD_RAW = null;
  var RECOVERY_RAW = null;
  var LOAD_NOTICE = "";
  var EXTERNAL_CHANGED = false;
  var toastTimer = null;
  var LAST_DAY = null;
  var PRINT_LIMIT = null;
  var THEME = "system";
  try {
    THEME = localStorage.getItem("siguiente.theme") || "system";
  } catch (e) {}
  if (!["system", "light", "dark"].includes(THEME)) THEME = "system";

  // ---------- adaptador local: única puerta a la persistencia del navegador ----------
  var LocalStorageAdapter = {
    key: "siguiente.frontend.v2",
    load: function () {
      var key = this.key;
      return new Promise(function (resolve) {
        try {
          var raw = localStorage.getItem(key);
          LOAD_RAW = raw;
          resolve(raw ? JSON.parse(raw) : null);
        } catch (e) {
          if (typeof raw === "string" && raw) {
            RECOVERY_RAW = raw;
            LOAD_NOTICE =
              "No se pudieron leer tus datos. Conservamos el archivo original; descárgalo desde Ajustes antes de empezar de nuevo.";
          } else
            LOAD_NOTICE =
              "El navegador no permite acceder al guardado local. Exporta una copia de tus cambios antes de cerrar.";
          resolve(null);
        }
      });
    },
    save: function (state) {
      var key = this.key;
      return new Promise(function (resolve, reject) {
        try {
          localStorage.setItem(key, JSON.stringify(state));
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    },
  };

  // ---------- adaptador remoto: guarda y devuelve el estado completo contra el Worker ----------
  // la ruta es relativa; solo funciona cuando la app se sirve desde su propio origen
  var SYNC_PATH = "/api/state";

  // token de sincronización guardado solo en este equipo; nunca viaja en la URL
  function syncToken() {
    try {
      return localStorage.getItem("siguiente.token") || "";
    } catch (e) {
      return "";
    }
  }
  function setSyncToken(value) {
    var t = String(value == null ? "" : value).trim();
    try {
      if (t) localStorage.setItem("siguiente.token", t);
      else localStorage.removeItem("siguiente.token");
    } catch (e) {}
  }

  // cabeceras de autorización solo si hay token configurado
  function authHeaders() {
    var t = syncToken();
    return t ? { Authorization: "Bearer " + t } : {};
  }

  // estado venido de fuera, migrado y validado; null si no es usable
  function usableRemote(s) {
    if (!s || typeof s !== "object" || Array.isArray(s)) return null;
    var m = Core.migrate(s);
    return Core.validateState(m).ok ? m : null;
  }

  var RemoteAdapter = {
    etag: null,
    load: function () {
      var self = this;
      self.etag = null;
      return fetch(SYNC_PATH, { headers: authHeaders(), cache: "no-store" })
        .then(function (res) {
          if (!res.ok) throw new Error("Estado remoto no disponible.");
          self.etag = res.headers.get("ETag");
          return res.json();
        })
        .then(function (body) {
          if (
            !body ||
            typeof body !== "object" ||
            !Object.prototype.hasOwnProperty.call(body, "state")
          )
            throw new Error("Respuesta de API incompatible.");
          if (body.state === null) return null;
          var state = usableRemote(body.state);
          if (!state) throw new Error("Estado remoto inválido.");
          return state;
        })
        .catch(function (error) {
          self.etag = null;
          throw error;
        });
    },
    save: function (state) {
      var self = this;
      if (!self.etag) {
        return self.load().then(function (loaded) {
          var error = new Error("Conflicto de revisión.");
          error.conflict = true;
          error.state = loaded;
          throw error;
        });
      }
      var headers = Object.assign(
        { "Content-Type": "application/json" },
        authHeaders(),
      );
      headers["If-Match"] = self.etag;
      return fetch(SYNC_PATH, {
        method: "PUT",
        headers: headers,
        body: JSON.stringify(state),
      }).then(function (res) {
        var etag = res.headers.get("ETag");
        if (etag) self.etag = etag;
        if (res.status !== 409) {
          if (!res.ok) throw new Error("No se pudo guardar en el servidor.");
          return state;
        }
        return res.json().then(
          function (body) {
            if (!body || !Object.prototype.hasOwnProperty.call(body, "state")) {
              self.etag = null;
              throw new Error("Respuesta de conflicto incompatible.");
            }
            var remote = body.state === null ? null : usableRemote(body.state);
            if (body.state !== null && !remote) {
              self.etag = null;
              throw new Error(
                "Los datos remotos no son compatibles. La copia local se conserva.",
              );
            }
            var error = new Error("Conflicto de revisión.");
            error.conflict = true;
            error.state = remote;
            throw error;
          },
          function () {
            self.etag = null;
            throw new Error(
              "La respuesta de conflicto no contiene JSON válido.",
            );
          },
        );
      });
    },
  };

  // ---------- copia base: último estado que este equipo confirmó sincronizado ----------
  // misma persistencia que LocalStorageAdapter con clave propia; solo la toca el
  // adaptador compuesto, como ancestro de la fusión de tres vías
  var BaselineAdapter = Object.assign({}, LocalStorageAdapter, {
    key: "siguiente.frontend.syncbase.v2",
  });

  function noop() {}

  // igualdad profunda de valores planos: el orden de las claves no cuenta
  function statesEqual(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object")
      return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      return (
        a.length === b.length &&
        a.every(function (x, i) {
          return statesEqual(x, b[i]);
        })
      );
    }
    var ka = Object.keys(a);
    return (
      ka.length === Object.keys(b).length &&
      ka.every(function (k) {
        return (
          Object.prototype.hasOwnProperty.call(b, k) && statesEqual(a[k], b[k])
        );
      })
    );
  }

  // ---------- adaptador compuesto: local nunca pierde datos, remoto sincroniza si puede ----------
  // respeta el mismo contrato load()/save(state); ni el núcleo ni las vistas lo notan
  function makeCompositeAdapter(local, remote, baseline) {
    var baseState = null; // último estado remoto válido que este equipo confirmó
    var queue = Promise.resolve(); // los guardados van en serie: nunca dos PUT a la vez

    // encadena un trabajo tras el guardado en curso y devuelve su promesa
    function enqueue(job) {
      var run = queue.then(function () {
        return job();
      });
      queue = run.then(noop, noop);
      return run;
    }

    // adopta un estado ya sincronizado: base en memoria y copias en local y baseline
    function adopt(state) {
      baseState = state;
      local.save(state).then(noop, noop);
      baseline.save(state).then(noop, noop);
    }

    // sube un estado con su If-Match; ante un 409 fusiona con el estado vigente y
    // reintenta con el ETag nuevo, hasta 3 veces; al agotar los reintentos o si la
    // fusión no es válida, el error sale marcado y lo local queda intacto
    function upload(state) {
      var pending = state;
      var retries = 0;
      function failSync(e) {
        SYNC = "localonly";
        if (e) e.exhausted = true;
        return Promise.reject(e);
      }
      function attempt() {
        return remote.save(pending).then(
          function (accepted) {
            adopt(accepted);
            SYNC = "ok";
            return accepted;
          },
          function (e) {
            if (e && e.conflict === true) {
              // la nube quedó vacía o ilegible: se reintenta tal cual contra el ETag nuevo
              if (!e.state) {
                if (retries < 3) {
                  retries += 1;
                  return attempt();
                }
                return failSync(e);
              }
              // la nube ya tiene exactamente esto: se adopta sin otra revisión ni PUT
              if (statesEqual(e.state, pending)) {
                adopt(e.state);
                SYNC = "ok";
                return e.state;
              }
              if (retries < 3) {
                retries += 1;
                var merged = Core.mergeStates(
                  baseState,
                  pending,
                  e.state,
                  now(),
                );
                if (merged.ok) {
                  pending = merged.state;
                  return attempt();
                }
                return failSync(new Error(merged.error || "fusión inválida"));
              }
              return failSync(e);
            }
            SYNC = "localonly";
            return Promise.reject(e);
          },
        );
      }
      return attempt();
    }

    // subida en segundo plano durante la carga: su resultado solo mueve el indicador
    function enqueueUpload(state) {
      enqueue(function () {
        return upload(state);
      }).then(noop, noop);
    }

    return {
      load: function () {
        return Promise.all([
          local.load(),
          baseline.load(),
          remote.load().then(
            function (v) {
              return { ok: true, value: v };
            },
            function () {
              return { ok: false };
            },
          ),
        ]).then(function (triple) {
          var localState = usableRemote(triple[0]);
          baseState = usableRemote(triple[1]);
          var r = triple[2];
          if (!r.ok) {
            SYNC = "localonly";
            return localState;
          }
          var remoteState = usableRemote(r.value);
          // remoto vacío: lo local sube como punto de partida, contra el ETag "empty"
          if (!remoteState) {
            SYNC = "ok";
            if (localState) enqueueUpload(localState);
            return localState;
          }
          // sin copia local: la nube manda y queda de base
          if (!localState) {
            SYNC = "ok";
            adopt(remoteState);
            return remoteState;
          }
          if (statesEqual(localState, remoteState)) {
            SYNC = "ok";
            adopt(localState);
            return localState;
          }
          // un solo lado cambió desde la base: se conserva el otro sin fusionar
          if (baseState && statesEqual(localState, baseState)) {
            SYNC = "ok";
            adopt(remoteState);
            return remoteState;
          }
          if (baseState && statesEqual(remoteState, baseState)) {
            SYNC = "ok";
            enqueueUpload(localState);
            return localState;
          }
          // cambios en ambos lados: fusión a tres vías (conservadora si no hay base válida)
          var merged = Core.mergeStates(
            baseState,
            localState,
            remoteState,
            now(),
          );
          if (!merged.ok) {
            SYNC = "localonly";
            return localState;
          }
          SYNC = "ok";
          local.save(merged.state).then(noop, noop);
          enqueueUpload(merged.state);
          return merged.state;
        });
      },
      save: function (state) {
        // lo pedido se guarda en local de inmediato: la cola del remoto nunca lo retiene;
        // la base se captura al pedir el guardado y, si otra escritura encolada la avanzó,
        // lo que se sube se reconcilia con la base nueva para no perder su fusión
        var capturedBase = baseState;
        return local.save(state).then(function () {
          return enqueue(function () {
            var pending = state;
            if (baseState && baseState !== capturedBase) {
              var rec = Core.mergeStates(
                capturedBase,
                pending,
                baseState,
                now(),
              );
              if (!rec.ok) {
                SYNC = "localonly";
                var invalid = new Error(rec.error || "fusión inválida");
                invalid.exhausted = true;
                throw invalid;
              }
              pending = rec.state;
            }
            return local.save(pending).then(function () {
              return upload(pending).then(
                function (accepted) {
                  return accepted;
                },
                function (e) {
                  // conflicto sin resolver: el guardado falla y lo local queda como estaba
                  if (e && e.exhausted) throw e;
                  return pending; // remoto caído: queda en local y SYNC ya es 'localonly'
                },
              );
            });
          });
        });
      },
    };
  }

  // elige adaptador: doble clic (file://) trabaja solo en local; servido, sincroniza
  function makeAdapter() {
    // El backend no venía adjunto. Se activa solo con configuración explícita.
    var config = globalThis.SiguienteConfig;
    if (!config || config.sync !== true || location.protocol !== "https:") {
      SYNC = "off";
      return LocalStorageAdapter;
    }
    SYNC = "ok";
    return makeCompositeAdapter(
      LocalStorageAdapter,
      RemoteAdapter,
      BaselineAdapter,
    );
  }

  // ---------- reloj y fecha que la interfaz inyecta al núcleo ----------
  // marca ISO 8601 UTC
  function now() {
    return new Date().toISOString();
  }
  // fecha local YYYY-MM-DD
  function localDate() {
    var d = new Date();
    return (
      d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
    );
  }
  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  var DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  var DIAS_LARGOS = [
    "Domingo",
    "Lunes",
    "Martes",
    "Miércoles",
    "Jueves",
    "Viernes",
    "Sábado",
  ];
  var MESES = [
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sep",
    "oct",
    "nov",
    "dic",
  ];

  // 'YYYY-MM-DD' a Date local a medianoche
  function parseLocalDate(s) {
    var a = s.split("-");
    return new Date(+a[0], +a[1] - 1, +a[2]);
  }
  // rango [inicio, fin) de un día local como marcas ISO UTC
  function localDayRange(s) {
    var start = parseLocalDate(s);
    var end = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + 1,
    );
    return { startIso: start.toISOString(), endIso: end.toISOString() };
  }
  // las fechas de la semana (lunes a hoy) que contiene s
  function weekUpToToday(s) {
    var d = parseLocalDate(s);
    var offset = (d.getDay() + 6) % 7;
    var out = [];
    for (var i = offset; i >= 0; i--) {
      var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
      out.push(
        x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate()),
      );
    }
    return out;
  }
  function fmtDayName(s) {
    return DIAS[parseLocalDate(s).getDay()];
  }
  function fmtDayDate(s) {
    var d = parseLocalDate(s);
    return d.getDate() + " " + MESES[d.getMonth()];
  }
  function fmtHeaderDate(s) {
    var d = parseLocalDate(s);
    return DIAS_LARGOS[d.getDay()] + " " + d.getDate();
  }
  // marca ISO a '9 abr, 14:03'
  function fmtStamp(iso) {
    var d = new Date(iso);
    return (
      d.getDate() +
      " " +
      MESES[d.getMonth()] +
      ", " +
      d.getHours() +
      ":" +
      pad(d.getMinutes())
    );
  }
  // marca ISO a solo la hora '14:03'
  function fmtClock(iso) {
    var d = new Date(iso);
    return d.getHours() + ":" + pad(d.getMinutes());
  }
  // mes local 'YYYY-MM' de una marca ISO
  function monthOf(iso) {
    var d = new Date(iso);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1);
  }
  // solo la primera letra en mayúscula, como se escribe en español: 'Octubre de 2026'
  function capitalize(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }
  // tamaño del titular según su largo, para que la acción y sus botones sigan a la vista
  function heroSize(text) {
    var n = String(text || "").length;
    return n > 180 ? " hero--long hero--xlong" : n > 120 ? " hero--long" : "";
  }

  // ---------- estado de la aplicación ----------
  var STATE = Core.emptyState(); // única fuente de verdad
  var VIEW = { name: "hoy" }; // vista actual y datos transitorios de interfaz
  var SAVE = "saved"; // 'saved' | 'saving' | 'error'
  var SYNC = "off"; // 'off' | 'ok' | 'localonly'
  var elapsedTimer = null; // solo repinta el tiempo transcurrido
  var UNDO = null; // { state, label } del deshacer breve
  var undoTimer = null; // temporizador del aviso de deshacer
  var saveSeq = 0; // número del último guardado pedido: una respuesta vieja no pisa el indicador
  var REDUCE = false;
  try {
    REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) {}

  var adapter = makeAdapter();

  // calcula una fecha YYYY-MM-DD desplazada por días
  function localPlus(offset) {
    var d = new Date();
    d.setDate(d.getDate() + offset);
    return (
      d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
    );
  }

  // ---------- utilidades ----------
  // escapa el texto de la persona antes de insertarlo en HTML
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  }

  // texto de búsqueda comparable sin diferencias de mayúsculas ni acentos
  function foldSearch(text) {
    return String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  // duración legible larga a partir de milisegundos
  function fmtDur(ms) {
    var totalMin = Math.floor(ms / 60000);
    if (totalMin < 1) return "menos de 1 min";
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    if (h < 1) return m + " min";
    return h + " h " + pad(m) + " min";
  }
  // duración compacta para las cifras de Progreso
  function fmtDurShort(ms) {
    var m = Math.floor(ms / 60000);
    if (m < 60) return m + " min";
    var h = Math.floor(m / 60);
    var r = m % 60;
    return r ? h + " h " + r : h + " h";
  }

  // texto del indicador de guardado, honesto sobre dónde quedaron los datos
  function saveText() {
    if (DEMO_PREV !== null) return "Ejemplo · no se guarda";
    if (RECOVERY_RAW !== null) return "Datos pendientes de recuperar";
    var time = STATE.savedAt ? " · " + fmtClock(STATE.savedAt) : "";
    if (SAVE === "saving")
      return SYNC === "off" ? "Guardando…" : "Sincronizando…";
    if (SAVE === "error") return "No se pudo guardar · exporta una copia";
    if (LOAD_NOTICE && !STATE.savedAt) return "Guardado local no disponible";
    if (SYNC === "off") return "Guardado en este navegador" + time;
    return SYNC === "localonly"
      ? "Guardado solo en este navegador" + time
      : "Sincronizado" + time;
  }

  // busca una tarea por id para la interfaz
  function findTaskUi(id) {
    return Core.taskById(STATE, id);
  }

  // clase y palabra del resultado de una sesión, derivadas de lo que se guardó
  function outcomeKind(s) {
    if (s.finished || s.nextStep === null || s.progress === "yes")
      return "done";
    if (s.progress === "some") return "progress";
    return "stuck";
  }
  function outcomeWord(s) {
    if (s.finished || s.nextStep === null) return "Tarea terminada";
    if (s.progress === "yes") return "Avanzaste bien";
    if (s.progress === "some") return "Avanzaste un poco";
    return "Sin avance, pero con tiempo dedicado";
  }

  // posición de la marca sobre la línea: una pasada por hora, solo señal de que el tiempo corre (no se llena ni marca una meta)
  function tempoPos(ms) {
    return ((((ms / 1000) % 3600) / 3600) * 88).toFixed(2);
  }

  // ---------- guardado ----------
  // adopta un estado nuevo, repinta y guarda solo si cambió
  function apply(next) {
    if (RECOVERY_RAW !== null) {
      announce("Recupera tus datos desde Ajustes antes de hacer cambios.");
      return false;
    }
    if (EXTERNAL_CHANGED) {
      announce("Hay cambios en otra pestaña. Recarga para no sobrescribirlos.");
      return false;
    }
    clearUndo();
    if (next === STATE) {
      render();
      return true;
    }
    STATE = Core.stampSave(next, now());
    if (DEMO_PREV !== null) {
      SAVE = "saved";
      render();
      return true;
    }
    SAVE = "saving";
    render();
    var submitted = STATE,
      seq = ++saveSeq;
    adapter.save(submitted).then(
      function (resolved) {
        if (resolved && typeof resolved === "object" && STATE === submitted) {
          var checked = Core.validateState(Core.migrate(resolved));
          if (checked.ok) {
            STATE = Core.migrate(resolved);
            render();
          }
        }
        if (seq === saveSeq) {
          SAVE = "saved";
          refreshSaveIndicator();
        }
      },
      function () {
        if (seq === saveSeq) {
          SAVE = "error";
          refreshSaveIndicator();
          announce(
            "No se pudo guardar. Tus cambios siguen en pantalla: exporta una copia desde Ajustes.",
          );
        }
      },
    );
    return true;
  }

  // actualiza solo el indicador, sin repintar toda la vista
  function refreshSaveIndicator() {
    var el = document.getElementById("saveind");
    if (el) el.textContent = saveText();
    var icon = document.getElementById("save-icon");
    if (icon)
      icon.innerHTML =
        SAVE === "error" || LOAD_NOTICE
          ? ICON.warning
          : SAVE === "saving"
            ? ICON.clock
            : ICON.check;
  }

  // ---------- deshacer breve: una ventana de 10 s tras acciones destructivas ----------
  function setUndo(prevState, label) {
    UNDO = { state: prevState, label: label };
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = setTimeout(function () {
      UNDO = null;
      undoTimer = null;
      var el = document.getElementById("undobar");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }, 10000);
    render();
  }

  function clearUndo() {
    UNDO = null;
    if (undoTimer) {
      clearTimeout(undoTimer);
      undoTimer = null;
    }
  }

  function doUndo() {
    if (!UNDO) return;
    var prev = UNDO.state;
    UNDO = null;
    if (undoTimer) {
      clearTimeout(undoTimer);
      undoTimer = null;
    }
    VIEW = { name: "hoy" };
    apply(prev);
  }

  function undoBarHtml() {
    if (!UNDO) return "";
    return (
      '<div class="notice undobar" id="undobar"><span>' +
      esc(UNDO.label) +
      "</span>" +
      '<button type="button" class="link" data-action="undo">Deshacer</button></div>'
    );
  }

  // ---------- acciones de interfaz ----------
  // captura el nombre sin exigir la acción y abre su campo dentro de Bandeja
  function doCapture(title) {
    var r = Core.captureTask(STATE, { title: title }, now());
    if (!r.ok) {
      announce(r.error);
      return;
    }
    if (RECOVERY_RAW !== null || EXTERNAL_CHANGED) {
      apply(r.state);
      return;
    }
    CAPTURE_DRAFT = "";
    var task = r.state.tasks[r.state.tasks.length - 1];
    VIEW = { name: "bandeja", editTaskId: task.id, focusAction: true };
    apply(r.state);
    announce("Tarea capturada. Define ahora su siguiente acción.");
  }

  // elegir para hoy; si falta acción, se escribe en la misma tarjeta
  function doChooseForToday(taskId) {
    var r = Core.chooseForToday(
      STATE,
      { taskId: taskId, date: localDate() },
      now(),
    );
    if (r.ok) {
      VIEW = { name: "hoy" };
      apply(r.state);
      announce("Tarea añadida al plan de hoy.");
      return;
    }
    var task = findTaskUi(taskId);
    if (!task || task.nextAction) {
      announce(r.error);
      return;
    }
    VIEW = {
      name: "bandeja",
      editTaskId: taskId,
      chooseAfterAction: true,
      focusAction: true,
    };
    render();
  }

  // guarda la acción desde Bandeja y elige para hoy si se pidió al abrirla
  function onSaveInlineAction() {
    var input = document.getElementById("inline-action");
    var task = findTaskUi(VIEW.editTaskId);
    if (!input || !task) return;
    var r = Core.defineTask(
      STATE,
      {
        taskId: task.id,
        outcome: task.outcome,
        nextAction: input.value,
      },
      now(),
    );
    if (!r.ok) {
      VIEW.actionError = r.error;
      VIEW.actionDraft = input.value;
      VIEW.focusAction = true;
      render();
      return;
    }
    var next = r.state;
    if (VIEW.chooseAfterAction) {
      var chosen = Core.chooseForToday(
        next,
        { taskId: task.id, date: localDate() },
        now(),
      );
      if (chosen.ok) {
        VIEW = { name: "hoy" };
        apply(chosen.state);
        return;
      }
    }
    var inToday = Core.todayPlan(next, localDate()).some(function (it) {
      return it.taskId === task.id;
    });
    VIEW = inToday
      ? { name: "bandeja", focusCapture: true }
      : { name: "bandeja", focusChooseId: task.id };
    apply(next);
  }

  // subir una tarea al primer lugar del plan de hoy
  function doMoveToFirst(taskId) {
    var r = Core.moveToFirst(
      STATE,
      { date: localDate(), taskId: taskId },
      now(),
    );
    if (r.ok) apply(r.state);
    else announce(r.error);
  }

  // quitar una tarea del plan de hoy y volver a Hoy
  function doRemoveFromToday(taskId) {
    var r = Core.removeFromToday(
      STATE,
      { date: localDate(), taskId: taskId },
      now(),
    );
    if (r.ok) {
      VIEW = { name: "hoy" };
      apply(r.state);
    }
  }

  // marcar una tarea como terminada directamente y volver a Hoy
  function doMarkDone(taskId) {
    var prev = STATE;
    var r = Core.markTaskDone(STATE, { taskId: taskId }, now());
    if (r.ok) {
      VIEW = { name: "hoy" };
      if (apply(r.state)) setUndo(prev, "Tarea terminada.");
    } else announce(r.error);
  }

  // pausar: aparta la tarea de todos los planes y vuelve a Hoy
  function doPause(id) {
    var r = Core.pauseTask(STATE, { taskId: id }, now());
    if (!r.ok) {
      announce(r.error);
      return;
    }
    var previous = STATE;
    VIEW = { name: "bandeja", inboxFilter: "paused" };
    if (apply(r.state)) setUndo(previous, "Tarea puesta en pausa.");
  }

  // reprogramar: confirma el traslado de la tarea al plan de la fecha elegida
  function onSaveReschedule() {
    var input = document.getElementById("rs-date");
    var toDate = input ? input.value : "";
    VIEW.rescheduleDraft = toDate;
    var r = Core.rescheduleTask(
      STATE,
      { taskId: VIEW.taskId, fromDate: localDate(), toDate: toDate },
      now(),
    );
    if (!r.ok) {
      VIEW.rescheduleError = r.error;
      render();
      var field = document.getElementById("rs-date");
      if (field) field.focus();
      return;
    }
    VIEW = { name: "hoy" };
    apply(r.state);
  }

  // empezar: abre una sesión y muestra la vista Sesión
  function doStart(taskId) {
    var r = Core.startSession(STATE, { taskId: taskId }, now());
    if (!r.ok) {
      announce(r.error);
      return;
    }
    VIEW = { name: "sesion", focusHeading: true };
    apply(r.state);
  }

  // pausar la sesión abierta: el tiempo se congela hasta reanudar
  function doPauseSession() {
    var r = Core.pauseSession(STATE, {}, now());
    if (r.ok) {
      apply(r.state);
      announce("Sesión en pausa. El tiempo de pausa no se registra.");
    } else announce(r.error);
  }

  // reanudar la sesión en pausa
  function doResumeSession() {
    var r = Core.resumeSession(STATE, {}, now());
    if (r.ok) {
      apply(r.state);
      announce("Sesión reanudada.");
    } else announce(r.error);
  }

  // edita solo la acción; conserva el resultado que traigan tareas antiguas
  function onSaveDefine() {
    var n = document.getElementById("d-next"),
      title = document.getElementById("d-title"),
      outcome = document.getElementById("d-outcome");
    var task = findTaskUi(VIEW.taskId);
    if (!task) return;
    var r = Core.defineTask(
      STATE,
      {
        taskId: VIEW.taskId,
        title: title ? title.value : task.title,
        outcome: outcome ? outcome.value : task.outcome,
        nextAction: n ? n.value : "",
      },
      now(),
    );
    if (!r.ok) {
      var titleText = (title ? title.value : task.title || "").trim();
      VIEW.defineError = r.error;
      // el campo que causa el error: nombre vacío o largo, o acción vacía
      VIEW.defineField =
        !titleText || titleText.length > 240
          ? "d-title"
          : !(n && n.value.trim())
            ? "d-next"
            : null;
      VIEW.draftNext = n ? n.value : "";
      VIEW.draftTitle = title ? title.value : task.title;
      VIEW.draftOutcome = outcome ? outcome.value : task.outcome;
      render();
      var el = document.getElementById(VIEW.defineField || "d-next");
      if (el) el.focus();
      return;
    }
    VIEW = { name: VIEW.back || "hoy" };
    apply(r.state);
    announce("Tarea actualizada.");
  }

  // un sí o un no cierra la sesión, sin dar por terminada la tarea
  function doCloseSession(progress) {
    var complete = document.getElementById("cl-finished"),
      next = document.getElementById("cl-next");
    var r = Core.closeSession(
      STATE,
      {
        progress: progress,
        finished: !!(complete && complete.checked),
        nextStep: next ? next.value : undefined,
      },
      now(),
    );
    if (!r.ok) {
      VIEW.closeError = r.error;
      var error = document.getElementById("close-error");
      if (error) {
        error.textContent = r.error;
        error.hidden = false;
      }
      if (next && !next.disabled && !next.value.trim()) {
        next.setAttribute("aria-invalid", "true");
        next.setAttribute("aria-describedby", "close-error");
        next.focus();
      } else announce(r.error);
      return;
    }
    stopElapsed();
    VIEW = { name: "hoy", focusHeading: true };
    apply(r.state);
    announce("Sesión guardada. Cada paso cuenta.");
  }

  // exportar el estado como archivo JSON
  function doExport() {
    downloadText(Core.exportState(STATE), "siguiente-" + localDate() + ".json");
  }

  // importar un archivo JSON: avisa si es más nuevo; el núcleo valida y reemplaza
  function doImport(file) {
    if (file.size > 5 * 1024 * 1024) {
      VIEW.importError = "El archivo supera los 5 MB.";
      render();
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var r = Core.importState(STATE, String(reader.result));
      if (!r.ok) {
        VIEW.importError = r.error;
        PENDING_IMPORT = null;
        render();
        return;
      }
      PENDING_IMPORT = r.state;
      VIEW.importError = null;
      render();
      var confirm = document.getElementById("import-confirm");
      if (confirm) confirm.focus();
    };
    reader.onerror = function () {
      VIEW.importError = "No se pudo leer el archivo.";
      render();
    };
    reader.readAsText(file);
  }

  // borrar todo, tras confirmación
  function doDeleteAll() {
    var previous = STATE;
    var incompatible = RECOVERY_RAW !== null;
    RECOVERY_RAW = null;
    LOAD_NOTICE = "";
    EXTERNAL_CHANGED = false;
    PENDING_IMPORT = null;
    CAPTURE_DRAFT = "";
    stopElapsed();
    VIEW = { name: "hoy" };
    apply(Core.emptyState());
    if (!incompatible) setUndo(previous, "Se borraron las tareas y sesiones.");
  }

  // datos de ejemplo: se construyen con los mismos casos de uso
  function doLoadSample() {
    if (
      STATE.tasks.length ||
      STATE.sessions.length ||
      DEMO_PREV !== null ||
      RECOVERY_RAW !== null ||
      EXTERNAL_CHANGED
    )
      return;
    DEMO_PREV = STATE;
    function at(dayOffset, h, m) {
      var d = new Date();
      d.setDate(d.getDate() + dayOffset);
      d.setHours(h, m, 0, 0);
      return d.toISOString();
    }
    var s = STATE;
    s = Core.captureTask(
      s,
      { title: "Enviar la factura al cliente" },
      at(-1, 9, 2),
    ).state;
    var t1 = s.tasks[s.tasks.length - 1].id;
    s = Core.defineTask(
      s,
      {
        taskId: t1,
        outcome: "Factura enviada y cobrada",
        nextAction: "Adjuntar el PDF y escribir el correo",
      },
      at(-1, 9, 3),
    ).state;
    s = Core.chooseForToday(
      s,
      { taskId: t1, date: localPlus(-1) },
      at(-1, 9, 4),
    ).state;
    s = Core.startSession(s, { taskId: t1 }, at(-1, 9, 5)).state;
    s = Core.closeSession(
      s,
      { progress: "yes", finished: true },
      at(-1, 9, 40),
    ).state;

    s = Core.captureTask(
      s,
      { title: "Leer el capítulo 3 de historia" },
      at(0, 8, 15),
    ).state;
    var t2 = s.tasks[s.tasks.length - 1].id;
    s = Core.defineTask(
      s,
      {
        taskId: t2,
        outcome: "Capítulo 3 leído con apuntes",
        nextAction: "Leer las páginas 40 a 52",
      },
      at(0, 8, 16),
    ).state;
    s = Core.chooseForToday(
      s,
      { taskId: t2, date: localDate() },
      at(0, 8, 17),
    ).state;
    s = Core.startSession(s, { taskId: t2 }, at(0, 8, 30)).state;
    s = Core.pauseSession(s, {}, at(0, 8, 40)).state;
    s = Core.resumeSession(s, {}, at(0, 8, 50)).state;
    s = Core.closeSession(
      s,
      {
        progress: "some",
        finished: false,
        nextStep: "Leer las páginas 53 a 60",
      },
      at(0, 9, 0),
    ).state;

    s = Core.captureTask(
      s,
      { title: "Ordenar el escritorio" },
      at(0, 8, 20),
    ).state;
    var t3 = s.tasks[s.tasks.length - 1].id;
    s = Core.defineTask(
      s,
      {
        taskId: t3,
        outcome: "Escritorio despejado",
        nextAction: "Vaciar el cajón de arriba",
      },
      at(0, 8, 21),
    ).state;
    s = Core.chooseForToday(
      s,
      { taskId: t3, date: localDate() },
      at(0, 8, 22),
    ).state;

    s = Core.captureTask(
      s,
      { title: "Ideas para el regalo de mamá" },
      at(0, 8, 25),
    ).state;
    VIEW = { name: "hoy" };
    apply(s);
  }

  // Iconos SVG de trazo uniforme: decorativos, con nombre en el control.
  function svg(path) {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      path +
      "</svg>"
    );
  }
  var ICON = {
    hoy: svg(
      '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
    ),
    bandeja: svg(
      '<path d="M4 4h16l2 11v5H2v-5L4 4Z"/><path d="M2 15h6l2 3h4l2-3h6"/>',
    ),
    semana: svg(
      '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18M8 15h1M15 15h1"/>',
    ),
    progreso: svg('<path d="M4 20V4M4 20h16M8 15l4-4 4 2 4-7"/>'),
    settings: svg(
      '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--surface)"/><circle cx="15" cy="17" r="3" fill="var(--surface)"/>',
    ),
    close: svg('<path d="m6 6 12 12M18 6 6 18"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
    left: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
    prev: svg('<path d="m15 6-6 6 6 6"/>'),
    next: svg('<path d="m9 6 6 6-6 6"/>'),
    play: svg('<path d="m8 5 11 7-11 7V5Z"/>'),
    pause: svg('<path d="M8 5v14M16 5v14"/>'),
    check: svg('<path d="m5 12 4 4L19 6"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    search: svg(
      '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    ),
    warning: svg(
      '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
    ),
    save: svg(
      '<path d="M5 3h12l4 4v14H3V3h2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
    ),
    moon: svg('<path d="M20.7 13.2A9 9 0 0 1 10.8 3.3 9 9 0 1 0 20.7 13.2Z"/>'),
    screen: svg(
      '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M12 16v5M8 21h8"/>',
    ),
    export: svg('<path d="M12 15V3M7 8l5-5 5 5M4 15v6h16v-6"/>'),
    import: svg('<path d="M12 3v12M7 10l5 5 5-5M4 15v6h16v-6"/>'),
    trash: svg(
      '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    ),
    edit: svg('<path d="m4 16-1 5 5-1L20 8l-4-4L4 16ZM14 6l4 4"/>'),
  };
  var BRAND_ICON =
    '<svg class="brand-icon" viewBox="0 0 28 28" fill="none" aria-hidden="true"><rect x="1" y="1" width="26" height="26" rx="7" stroke="currentColor" stroke-width="1.5"/><path d="M8 14h12m-5-5 5 5-5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function brandHtml(mobile) {
    return (
      '<div class="brand' +
      (mobile ? " mobile-brand" : "") +
      '">' +
      BRAND_ICON +
      'siguiente<span class="brand-period">.</span></div>'
    );
  }
  function isDark() {
    return (
      THEME === "dark" ||
      (THEME === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches)
    );
  }
  function setTheme(value) {
    if (!["system", "light", "dark"].includes(value)) return;
    THEME = value;
    document.documentElement.setAttribute("data-theme", value);
    try {
      localStorage.setItem("siguiente.theme", value);
    } catch (e) {}
    render();
  }
  // pinta la barra del navegador con el fondo del tema efectivo
  function paintThemeColor() {
    var color = isDark() ? "#171513" : "#f5f3ee";
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) {
      if (m.getAttribute("content") !== color) m.setAttribute("content", color);
    });
  }
  // aviso solo para lectores de pantalla, en una región fija que nunca se repinta
  var srTimer = null;
  function srAnnounce(message, delay) {
    var el = document.getElementById("sr-status");
    if (!el || !message) return;
    clearTimeout(srTimer);
    srTimer = setTimeout(function () {
      // el mismo texto dos veces no se anuncia: se alterna un espacio fino
      el.textContent = el.textContent === message ? message + "\u00a0" : message;
    }, delay || 0);
  }
  // título de la pestaña: la sección actual y, durante una sesión, la acción en curso
  var lastTitle = null;
  function pageTitle() {
    var open = Core.openSession(STATE);
    if (VIEW.menu) return "Ajustes · Siguiente";
    if ((VIEW.name === "sesion" || VIEW.name === "cerrar") && open)
      return (
        (VIEW.name === "cerrar"
          ? "Cierre de sesión"
          : open.pausedAt
            ? "En pausa"
            : "En sesión") +
        ": " +
        open.action +
        " · Siguiente"
      );
    var names = {
      bandeja: "Bandeja",
      semana: "Semana",
      progreso: "Progreso",
      definir: "Editar tarea",
      ajustar: "Ajustar tarea",
      reprogramar: "Mover a otro día",
    };
    return names[VIEW.name]
      ? names[VIEW.name] + " · Siguiente"
      : "Siguiente · Un paso a la vez";
  }
  function announce(message) {
    var el = document.getElementById("announcement");
    if (!el) return;
    clearTimeout(toastTimer);
    el.textContent = message;
    toastTimer = setTimeout(function () {
      el.textContent = "";
    }, 5200);
  }
  function elapsedClock(ms) {
    var secs = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(secs / 3600),
      m = Math.floor((secs % 3600) / 60),
      s = secs % 60;
    return (h ? pad(h) + ":" : "") + pad(m) + ":" + pad(s);
  }
  function activeSection() {
    if (VIEW.name === "bandeja") return "bandeja";
    if (VIEW.name === "semana" || VIEW.name === "progreso") return VIEW.name;
    if (VIEW.back === "bandeja") return "bandeja";
    return "hoy";
  }
  function navItems() {
    return [
      ["hoy", "Hoy"],
      ["bandeja", "Bandeja"],
      ["semana", "Semana"],
      ["progreso", "Progreso"],
    ];
  }
  function sidebarHtml() {
    var selected = activeSection();
    var counts = {
      hoy: Core.todayPlan(STATE, localDate()).length,
      bandeja: Core.inbox(STATE).length,
    };
    return (
      '<aside class="sidebar" aria-label="Espacio de enfoque">' +
      brandHtml(false) +
      '<p class="brand-caption">Menos ruido.<br>Un siguiente paso.</p><nav class="sidenav" aria-label="Secciones">' +
      navItems()
        .map(function (item) {
          var current = !VIEW.menu && selected === item[0];
          return (
            '<button type="button" class="nav-item" data-action="go" data-view="' +
            item[0] +
            '"' +
            (current ? ' aria-current="page"' : "") +
            ">" +
            ICON[item[0]] +
            "<span>" +
            item[1] +
            "</span>" +
            (counts[item[0]] !== undefined
              ? '<span class="nav-count">' + counts[item[0]] + "</span>"
              : "") +
            "</button>"
          );
        })
        .join("") +
      '</nav><div class="sidebar-bottom"><div class="sidebar-note"><strong>No todo a la vez.<br>Solo lo siguiente.</strong><p>Una acción concreta vale más que un plan perfecto.</p></div>' +
      '<div class="sidebar-actions"><button type="button" class="nav-item" data-action="toggle-menu"' +
      (VIEW.menu ? ' aria-current="page"' : "") +
      ">" +
      ICON.settings +
      '<span>Ajustes</span></button><button type="button" class="iconbtn" id="theme-toggle-side" data-action="theme-toggle" aria-label="Activar modo ' +
      (isDark() ? "claro" : "oscuro") +
      '" title="Cambiar apariencia">' +
      (isDark() ? ICON.hoy : ICON.moon) +
      "</button></div>" +
      '<div class="sidebar-footer">' +
      ICON.save +
      "<span>" +
      (DEMO_PREV !== null ? "Ejemplo sin guardar" : "Datos en este navegador") +
      "</span></div></div></aside>"
    );
  }
  function dailyRailHtml() {
    var range = localDayRange(localDate()),
      sessions = Core.sessionsBetween(STATE, range.startIso, range.endIso);
    var done = STATE.tasks.filter(function (t) {
      return (
        t.status === "done" &&
        t.completedAt &&
        Date.parse(t.completedAt) >= Date.parse(range.startIso) &&
        Date.parse(t.completedAt) < Date.parse(range.endIso)
      );
    }).length;
    return (
      '<aside class="today-rail" aria-label="Tu día y guía de enfoque"><section class="rail-card"><h2 class="rail-title">Tu día, hasta ahora ' +
      ICON.hoy +
      '</h2><div class="daily-metrics"><div class="daily-metric"><span>Sesiones cerradas</span><strong>' +
      sessions.length +
      '</strong></div><div class="daily-metric"><span>Tiempo de enfoque</span><strong>' +
      esc(fmtDurShort(Core.sessionsTotalDuration(sessions, null))) +
      '</strong></div><div class="daily-metric"><span>Tareas terminadas</span><strong>' +
      done +
      '</strong></div></div><p class="rail-caption">Cada intento también cuenta.</p></section><section class="rail-card"><h2 class="rail-title">Un método sencillo</h2><ol class="guide-list"><li><div><strong>Captura</strong><p>Saca las ideas de tu cabeza.</p></div></li><li><div><strong>Define</strong><p>Elige una acción pequeña.</p></div></li><li><div><strong>Empieza</strong><p>Dale tu atención.</p></div></li></ol></section></aside>'
    );
  }
  function recoveryNoticeHtml() {
    if (EXTERNAL_CHANGED)
      return '<div class="notice notice--accent" role="status"><span>Hay cambios desde otra pestaña. Recarga antes de editar para no sobrescribirlos.</span><button type="button" class="link" data-action="reload">Recargar</button></div>';
    if (!LOAD_NOTICE) return "";
    return (
      '<div class="notice notice--error" role="status"><span>' +
      esc(LOAD_NOTICE) +
      '</span><button type="button" class="link" data-action="open-settings">Ajustes</button></div>'
    );
  }

  // atributos de un campo con error: lo marca y lo une al mensaje que lo explica
  function invalidAttrs(invalid, errorId) {
    return invalid
      ? ' aria-invalid="true" aria-describedby="' + errorId + '"'
      : "";
  }

  // ---------- render ----------
  var lastViewKey = null; // la entrada de vista solo se anima al cambiar de sección
  function render() {
    var app = document.getElementById("app");
    paintThemeColor();
    var announcementNode = document.getElementById("announcement");
    var previousWorkspace = document.getElementById("main-content");
    var previousScroll = previousWorkspace ? previousWorkspace.scrollTop : 0;
    var previousWindowScroll = window.scrollY;
    var oldFocus = document.activeElement,
      focusId = oldFocus && oldFocus.id;
    var nextKey = VIEW.name + "|" + (VIEW.menu ? "menu" : "");
    if (nextKey === lastViewKey) {
      var oldInline = document.getElementById("inline-action");
      if (
        oldInline &&
        oldInline.getAttribute("data-task-id") === VIEW.editTaskId
      )
        VIEW.actionDraft = oldInline.value;
      var oldDefine = document.getElementById("define-form");
      if (oldDefine && oldDefine.getAttribute("data-task-id") === VIEW.taskId) {
        VIEW.draftNext = document.getElementById("d-next").value;
        VIEW.draftTitle = document.getElementById("d-title").value;
        VIEW.draftOutcome = document.getElementById("d-outcome").value;
      }
      var oldDate = document.getElementById("rs-date");
      if (oldDate) VIEW.rescheduleDraft = oldDate.value;
      var oldClose = document.getElementById("close-form");
      if (oldClose) {
        VIEW.closeDraftNext = document.getElementById("cl-next").value;
        VIEW.closeFinished = document.getElementById("cl-finished").checked;
        var selected = document.querySelector(
          '[name="session-progress"]:checked',
        );
        VIEW.closeProgress = selected ? selected.value : "yes";
      }
    }
    var keepCapture = focusId === "capture" && !VIEW.focusAction;
    var full = (VIEW.name === "sesion" || VIEW.name === "cerrar") && !VIEW.menu;
    var key = VIEW.name + "|" + (VIEW.menu ? "menu" : "");
    var entering = key !== lastViewKey;
    lastViewKey = key;
    var body = VIEW.menu ? menuHtml() : viewHtml();
    if (!full && !VIEW.menu) body = undoBarHtml() + body;
    var demo =
      DEMO_PREV !== null
        ? '<div class="demo-banner"><span>Modo de ejemplo · los cambios no se guardan.</span><button type="button" class="link" data-action="demo-exit">Salir</button></div>'
        : "";
    var chrome = full
      ? '<div class="session-top"><button type="button" class="link" data-action="go" data-view="hoy">' +
        ICON.left +
        'Volver a Hoy</button><span class="saveind" id="saveind">' +
        esc(saveText()) +
        '</span></div><div id="status-message-slot" class="session-feedback"></div>'
      : appbarHtml() + captureSlot();
    app.innerHTML =
      sidebarHtml() +
      '<main class="workspace" id="main-content" tabindex="-1"><div class="content">' +
      chrome +
      demo +
      recoveryNoticeHtml() +
      '<div class="view' +
      (full ? " view--full" : "") +
      (entering ? " view--enter" : "") +
      '">' +
      body +
      "</div></div></main>" +
      tabbarHtml();
    var statusSlot = document.getElementById("status-message-slot");
    if (statusSlot && announcementNode)
      statusSlot.appendChild(announcementNode);
    // solo se escribe si cambió: no pisa un título puesto desde fuera
    var title = pageTitle();
    if (title !== lastTitle) {
      document.title = title;
      lastTitle = title;
    }
    wire();
    var currentWorkspace = document.getElementById("main-content");
    if (!entering) {
      currentWorkspace.scrollTop = previousScroll;
      window.scrollTo({ top: previousWindowScroll, behavior: "instant" });
    } else {
      currentWorkspace.scrollTop = 0;
      window.scrollTo({ top: 0, behavior: "instant" });
    }
    if (keepCapture || VIEW.focusCapture) {
      var cap = document.getElementById("capture");
      if (cap) {
        cap.focus({ preventScroll: true });
        if (VIEW.focusCapture)
          cap.scrollIntoView({ block: "center", behavior: "instant" });
      }
      VIEW.focusCapture = false;
    }
    if (VIEW.focusAction) {
      var actionInput = document.getElementById("inline-action");
      if (actionInput) {
        actionInput.focus({ preventScroll: true });
        actionInput.scrollIntoView({ block: "nearest" });
      }
      VIEW.focusAction = false;
    }
    if (VIEW.focusChooseId) {
      var choose = document.getElementById("choose-action");
      if (choose) {
        choose.focus({ preventScroll: true });
        choose.scrollIntoView({ block: "nearest" });
      }
      VIEW.focusChooseId = null;
    }
    if (VIEW.focusHeading && !keepCapture) {
      var heading = document.querySelector("#main-content h1");
      if (heading) heading.focus({ preventScroll: true });
      VIEW.focusHeading = false;
    }
    if (!entering && focusId && focusId !== "capture" && !VIEW.focusAction) {
      var restore = document.getElementById(focusId);
      if (restore && !restore.disabled && restore.getClientRects().length)
        restore.focus({ preventScroll: true });
    }
    if (VIEW.name === "sesion" && !VIEW.menu) startElapsed();
    else stopElapsed();
  }

  // barra superior común
  function appbarHtml() {
    var titles = {
      hoy: [
        "Lo importante, primero.",
        "Hoy · " +
          fmtDayDate(localDate()) +
          ". No necesitas hacerlo todo. Solo dar el siguiente paso.",
      ],
      bandeja: [
        "Dale espacio a tus ideas.",
        "Captura primero. Decide después. Todo empieza con una acción concreta.",
      ],
      semana: [
        "Tu semana, a tu ritmo.",
        "Un registro de lo que trabajaste, sin rachas ni presión.",
      ],
      progreso: [
        "El avance también se ve.",
        "Tiempo dedicado, sesiones reales y pequeños pasos que se acumulan.",
      ],
      definir: ["Hazlo concreto.", "Una tarea clara es más fácil de empezar."],
      ajustar: [
        "Ajustar esta tarea.",
        "Tu plan puede cambiar. Haz que trabaje a tu favor.",
      ],
      reprogramar: [
        "Un mejor momento.",
        "Mueve tu siguiente paso a un día en el que tenga sentido.",
      ],
    };
    var data = VIEW.menu
      ? [
          "Tu espacio, a tu manera.",
          "Apariencia, copias de seguridad y control sobre tus datos.",
        ]
      : titles[VIEW.name] || titles.hoy;
    var date = new Intl.DateTimeFormat("es", {
      weekday: "short",
      day: "numeric",
      month: "long",
    }).format(new Date());
    return (
      '<header class="appbar"><div class="topline"><p class="eyebrow">Tu espacio de enfoque</p>' +
      brandHtml(true) +
      '<div class="topline-right"><time class="date-label" datetime="' +
      localDate() +
      '">' +
      esc(date) +
      '</time><button type="button" class="iconbtn" id="theme-toggle-top" data-action="theme-toggle" aria-label="Activar modo ' +
      (isDark() ? "claro" : "oscuro") +
      '" title="Cambiar apariencia">' +
      (isDark() ? ICON.hoy : ICON.moon) +
      '</button><button type="button" class="iconbtn" data-action="toggle-menu" aria-label="' +
      (VIEW.menu ? "Cerrar ajustes" : "Abrir ajustes") +
      '">' +
      (VIEW.menu ? ICON.close : ICON.settings) +
      '</button></div></div><h1 id="page-title" tabindex="-1">' +
      esc(data[0]) +
      '</h1><p class="appbar-subtitle">' +
      esc(data[1]) +
      '</p><div class="appbar-save"><span id="save-icon">' +
      (SAVE === "error" || LOAD_NOTICE
        ? ICON.warning
        : SAVE === "saving"
          ? ICON.clock
          : ICON.check) +
      '</span><span class="saveind" id="saveind">' +
      esc(saveText()) +
      '</span><span id="status-message-slot"></span></div></header>'
    );
  }

  // campo de captura: presente en Hoy y en Bandeja, con botón que aparece al escribir
  function captureSlot() {
    if (VIEW.menu || (VIEW.name !== "hoy" && VIEW.name !== "bandeja"))
      return "";
    return (
      '<form class="capture-form" id="capture-form">' +
      ICON.plus +
      '<label class="sr-only" for="capture">Nombre de una nueva tarea</label><input id="capture" class="capture" type="text" autocomplete="off" autocapitalize="sentences" enterkeyhint="done" maxlength="240" placeholder="¿Qué tienes en mente?" value="' +
      esc(CAPTURE_DRAFT) +
      '"><span class="capture-hint" aria-hidden="true"><kbd>↵</kbd></span><button type="button" class="capture-add" data-action="capture-add" aria-label="Añadir tarea"' +
      (!CAPTURE_DRAFT.trim() ? " disabled" : "") +
      ">" +
      ICON.plus +
      "<span>Añadir</span></button></form>"
    );
  }

  // navegación inferior de cuatro secciones
  function tabbarHtml() {
    return (
      '<nav class="tabbar" aria-label="Secciones">' +
      navItems()
        .map(function (item) {
          var current = !VIEW.menu && activeSection() === item[0];
          return (
            '<button type="button" class="tab" data-action="go" data-view="' +
            item[0] +
            '"' +
            (current ? ' aria-current="page"' : "") +
            ">" +
            ICON[item[0]] +
            "<span>" +
            item[1] +
            "</span></button>"
          );
        })
        .join("") +
      "</nav>"
    );
  }

  // enruta a la vista actual
  function viewHtml() {
    switch (VIEW.name) {
      case "bandeja":
        return bandejaHtml();
      case "definir":
        return definirHtml();
      case "ajustar":
        return ajustarHtml();
      case "reprogramar":
        return reprogramarHtml();
      case "sesion":
        return sessionScreen();
      case "cerrar":
        return sessionScreen();
      case "semana":
        return semanaHtml();
      case "progreso":
        return progresoHtml();
      default:
        return hoyHtml();
    }
  }

  // aviso para volver a una sesión abierta desde otra vista
  function sessionBanner() {
    var s = Core.openSession(STATE);
    if (!s || VIEW.name === "sesion" || VIEW.name === "cerrar") return "";
    return (
      '<button type="button" class="notice as-button notice--accent" data-action="go" data-view="sesion"><span>' +
      (s.pausedAt
        ? "Tu sesión está en pausa."
        : "Tienes una sesión en curso.") +
      " Volver al enfoque</span>" +
      ICON.arrow +
      "</button>"
    );
  }

  // Hoy: la primera acción del plan como elemento principal, y debajo el resto
  function hoyHtml() {
    var plan = Core.todayPlan(STATE, localDate());
    var html =
      sessionBanner() + '<div class="today-layout"><div class="today-main">';
    if (!plan.length) {
      html +=
        '<section class="empty-state"><div class="empty-mark">' +
        ICON.arrow +
        '</div><span class="empty-index">TU SIGUIENTE PASO</span><h2>Empieza pequeño.</h2><p>No hace falta tener todo resuelto. Anota una tarea o elige una de tu bandeja para darle tu atención.</p><div class="empty-links"><button type="button" class="btn btn--primary" data-action="go" data-view="bandeja">Elegir una tarea ' +
        ICON.arrow +
        "</button>" +
        (!STATE.tasks.length &&
        !STATE.sessions.length &&
        DEMO_PREV === null &&
        RECOVERY_RAW === null &&
        !EXTERNAL_CHANGED
          ? '<button type="button" class="link" data-action="sample">Explorar con ejemplos</button>'
          : "") +
        "</div></section>";
    } else {
      var first = plan[0],
        total = Core.taskTotalDuration(STATE, first.taskId),
        rest = plan.slice(1);
      html +=
        '<section class="focus-card" aria-label="Tu siguiente acción"><div class="focus-top"><p class="panel-kicker">TU SIGUIENTE ACCIÓN</p><span class="focus-number">' +
        ICON.check +
        "01 de " +
        pad(plan.length) +
        '</span></div><p class="task-context">' +
        esc(first.task.title) +
        '</p><h2 class="hero' +
        heroSize(first.task.nextAction) +
        '">' +
        esc(first.task.nextAction) +
        "</h2>" +
        (first.task.outcome
          ? '<p class="for-outcome"><strong>Para:</strong> ' +
            esc(first.task.outcome) +
            "</p>"
          : "") +
        '<div class="now-actions"><button type="button" class="btn btn--primary" data-action="start" data-id="' +
        esc(first.taskId) +
        '">' +
        ICON.play +
        'Empezar sesión</button><button type="button" class="btn btn--text" data-action="adjust" data-id="' +
        esc(first.taskId) +
        '">Ajustar tarea ' +
        ICON.edit +
        '</button></div><p class="focus-foot">' +
        ICON.clock +
        (total
          ? esc(fmtDur(total)) + " dedicados a esta tarea"
          : "Empieza cuando quieras. El tiempo cuenta desde ahí.") +
        "</p></section>";
      if (rest.length) {
        html +=
          '<div class="section-heading"><h2>Después</h2><span>' +
          rest.length +
          (rest.length === 1 ? " tarea" : " tareas") +
          '</span></div><ul class="rows tight">';
        rest.forEach(function (item, i) {
          html +=
            '<li class="later"><span class="later-index">' +
            pad(i + 2) +
            '</span><span class="txt">' +
            esc(item.task.nextAction) +
            '<span class="sub">' +
            esc(item.task.title) +
            '</span></span><button type="button" class="iconbtn" data-action="tofirst" data-id="' +
            esc(item.taskId) +
            '" aria-label="Hacer primero: ' +
            esc(item.task.title) +
            '" title="Hacer primero">' +
            ICON.up +
            "</button></li>";
        });
        html += "</ul>";
      }
      html +=
        '<div class="plan-footer"><p>Un plan pequeño deja espacio para avanzar.</p><button type="button" class="link" data-action="go" data-view="bandeja">Ver bandeja ' +
        ICON.arrow +
        "</button></div>";
    }
    return html + "</div>" + dailyRailHtml() + "</div>";
  }

  // Bandeja: tareas en inbox o active, con dos acciones por tarea
  function bandejaHtml() {
    var filter = VIEW.inboxFilter || "pending",
      query = foldSearch(VIEW.inboxQuery || ""),
      today = Core.todayPlan(STATE, localDate());
    var inToday = {};
    today.forEach(function (it) {
      inToday[it.taskId] = true;
    });
    var all = STATE.tasks
      .filter(function (t) {
        return (
          (filter === "all" ||
            (filter === "pending" && ["inbox", "active"].includes(t.status)) ||
            t.status === filter) &&
          foldSearch(t.title + " " + (t.nextAction || "")).includes(query)
        );
      })
      .sort(function (a, b) {
        return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      });
    var limit = VIEW.inboxLimit || 30,
      tasks = all.slice(0, limit);
    var html =
      sessionBanner() +
      '<div class="inbox-controls"><div class="search-field">' +
      ICON.search +
      '<label class="sr-only" for="inbox-search">Buscar tareas</label><input class="log-search" id="inbox-search" type="search" placeholder="Buscar una tarea…" value="' +
      esc(VIEW.inboxQuery || "") +
      '"></div><label class="sr-only" for="inbox-filter">Estado de las tareas</label><select id="inbox-filter" class="filter-select">' +
      [
        ["pending", "Pendientes"],
        ["paused", "En pausa"],
        ["done", "Terminadas"],
        ["all", "Todas las tareas"],
      ]
        .map(function (it) {
          return (
            '<option value="' +
            it[0] +
            '"' +
            (filter === it[0] ? " selected" : "") +
            ">" +
            it[1] +
            "</option>"
          );
        })
        .join("") +
      '</select></div><p class="results-count">' +
      all.length +
      (all.length === 1 ? " tarea" : " tareas") +
      (query ? (all.length === 1 ? " encontrada" : " encontradas") : "") +
      "</p>";
    VIEW.inboxSummary =
      query && !all.length
        ? "No encontramos esa tarea."
        : all.length +
          (all.length === 1 ? " tarea" : " tareas") +
          (query ? (all.length === 1 ? " encontrada" : " encontradas") : "");
    if (!tasks.length) {
      return (
        html +
        '<section class="plain-empty">' +
        ICON.bandeja +
        "<h2>" +
        (query
          ? "No encontramos esa tarea."
          : filter === "done"
            ? "Cada cierre aparecerá aquí."
            : filter === "paused"
              ? "No hay tareas en pausa."
              : "Tu cabeza puede descansar.") +
        "</h2><p>" +
        (query
          ? "Prueba con otra palabra o cambia el filtro."
          : filter === "paused"
            ? "Si apartas una tarea, podrás recuperarla desde esta vista."
            : filter === "done"
              ? "Las tareas que termines se conservarán en tu registro."
              : "Anota arriba la primera tarea que tienes en mente.") +
        "</p></section>"
      );
    }
    html += '<ul class="rows">';
    tasks.forEach(function (t) {
      var editing = VIEW.editTaskId === t.id,
        dur = Core.taskTotalDuration(STATE, t.id),
        pending = ["inbox", "active"].includes(t.status);
      html +=
        '<li class="task' +
        (editing ? " task--captured" : "") +
        '"><div class="t-topline"><div class="t-title">' +
        esc(t.title) +
        '</div><span class="t-tag' +
        (t.status === "done"
          ? " badge--green"
          : inToday[t.id]
            ? " badge--accent"
            : "") +
        '">' +
        (t.status === "done"
          ? "Terminada"
          : t.status === "paused"
            ? "En pausa"
            : inToday[t.id]
              ? "En tu plan de hoy"
              : t.nextAction
                ? "Lista para empezar"
                : "Por definir") +
        "</span></div>";
      if (!editing)
        html +=
          '<div class="t-next' +
          (!t.nextAction ? " none" : "") +
          '">' +
          (t.nextAction ? esc(t.nextAction) : "Todavía sin siguiente acción") +
          "</div>";
      if (dur)
        html +=
          '<p class="t-dur">' +
          ICON.clock +
          esc(fmtDur(dur)) +
          " de enfoque</p>";
      if (editing) {
        var action =
          "actionDraft" in VIEW ? VIEW.actionDraft : t.nextAction || "";
        if (VIEW.actionError)
          html +=
            '<p class="notice notice--error" id="action-error" role="alert">' +
            esc(VIEW.actionError) +
            "</p>";
        html +=
          '<label class="field" for="inline-action"><span>¿Cuál es el siguiente paso?</span></label><input id="inline-action" data-task-id="' +
          esc(t.id) +
          '" class="capture" type="text" maxlength="500" autocomplete="off" placeholder="Ej.: escribir el primer párrafo" value="' +
          esc(action) +
          '"' +
          (VIEW.actionError
            ? ' aria-invalid="true" aria-describedby="action-error"'
            : "") +
          '><p class="action-hint">Algo pequeño, concreto y que puedas empezar ahora.</p><div class="t-actions"><button type="button" class="btn btn--primary btn--small" data-action="save-inline-action">' +
          (VIEW.chooseAfterAction
            ? "Guardar y elegir para hoy"
            : "Guardar acción") +
          '</button><button type="button" class="link" data-action="cancel-inline-action">Ahora no</button></div>';
      } else if (pending) {
        html +=
          '<div class="t-actions"><button type="button" class="btn btn--quiet btn--small" data-action="edit-inline-action" data-id="' +
          esc(t.id) +
          '">' +
          (t.nextAction ? "Editar acción" : "Definir acción") +
          "</button>" +
          (inToday[t.id]
            ? '<button type="button" class="link" data-action="adjust" data-id="' +
              esc(t.id) +
              '">Más opciones</button>'
            : '<button type="button" class="btn btn--primary btn--small" data-action="choose" data-id="' +
              esc(t.id) +
              '"' +
              (VIEW.focusChooseId === t.id ? ' id="choose-action"' : "") +
              ">Elegir para hoy</button>") +
          "</div>";
      } else if (t.status === "paused") {
        html +=
          '<div class="t-actions"><button type="button" class="btn btn--quiet btn--small" data-action="task-resume" data-id="' +
          esc(t.id) +
          '">' +
          ICON.play +
          "Recuperar tarea</button></div>";
      }
      html += "</li>";
    });
    html += "</ul>";
    if (all.length > limit)
      html +=
        '<button type="button" class="btn btn--quiet more-button" id="inbox-more" data-action="inbox-more">Mostrar más tareas (' +
        (all.length - limit) +
        ")</button>";
    return html;
  }

  // desde Ajustar se edita la acción de Hoy sin alterar el resultado guardado
  function definirHtml() {
    var task = findTaskUi(VIEW.taskId);
    if (!task) return '<div class="plain-empty">No se encontró la tarea.</div>';
    var action = "draftNext" in VIEW ? VIEW.draftNext : task.nextAction || "",
      title = "draftTitle" in VIEW ? VIEW.draftTitle : task.title,
      outcome = "draftOutcome" in VIEW ? VIEW.draftOutcome : task.outcome || "";
    return (
      '<form class="define-card" id="define-form" data-task-id="' +
      esc(task.id) +
      '"><p class="panel-kicker">NOMBRE, ACCIÓN, RESULTADO</p>' +
      (VIEW.defineError
        ? '<p class="notice notice--error" id="define-error" role="alert">' +
          esc(VIEW.defineError) +
          "</p>"
        : "") +
      '<label class="field" for="d-title"><span>Nombre de la tarea</span><input id="d-title" type="text" maxlength="240" value="' +
      esc(title) +
      '" required' +
      invalidAttrs(VIEW.defineError && VIEW.defineField === "d-title", "define-error") +
      '></label><label class="field" for="d-next"><span>Siguiente acción</span><input id="d-next" type="text" maxlength="500" value="' +
      esc(action) +
      '" required' +
      invalidAttrs(VIEW.defineError && VIEW.defineField === "d-next", "define-error") +
      '></label><p class="action-hint">Piensa en el primer paso, no en toda la tarea.</p><label class="field" for="d-outcome"><span>¿Para qué? <small>Opcional</small></span><input id="d-outcome" type="text" maxlength="500" value="' +
      esc(outcome) +
      '" placeholder="El resultado que quieres conseguir"></label><div class="stack stack--form"><button type="submit" class="btn btn--primary">Guardar cambios ' +
      ICON.check +
      '</button><button type="button" class="link" data-action="cancel-define">Cancelar</button></div></form>'
    );
  }

  // opciones de ajuste para la tarea del plan de hoy
  function ajustarHtml() {
    var task = findTaskUi(VIEW.taskId);
    if (!task) return '<div class="plain-empty">No se encontró la tarea.</div>';
    return (
      '<section class="define-card"><p class="panel-kicker">UN PLAN QUE SE ADAPTA</p><h2 class="ajustar-title">' +
      esc(task.title) +
      '</h2><p class="ajustar-note"><strong>Siguiente acción:</strong> ' +
      esc(task.nextAction || "Por definir") +
      "</p>" +
      (task.outcome
        ? '<p class="ajustar-note"><strong>Para:</strong> ' +
          esc(task.outcome) +
          "</p>"
        : "") +
      '<div class="stack"><button type="button" class="btn btn--quiet" data-action="adjust-edit" data-id="' +
      esc(task.id) +
      '">Editar tarea y acción ' +
      ICON.edit +
      '</button><button type="button" class="btn btn--quiet" data-action="adjust-remove" data-id="' +
      esc(task.id) +
      '">Quitar del plan de hoy ' +
      ICON.bandeja +
      '</button><button type="button" class="btn btn--quiet" data-action="adjust-reschedule" data-id="' +
      esc(task.id) +
      '">Mover a otro día ' +
      ICON.semana +
      '</button><button type="button" class="btn btn--quiet" data-action="adjust-pause" data-id="' +
      esc(task.id) +
      '">Pausar esta tarea ' +
      ICON.pause +
      '</button><button type="button" class="btn btn--quiet" data-action="adjust-done" data-id="' +
      esc(task.id) +
      '">Marcar como terminada ' +
      ICON.check +
      '</button><button type="button" class="link" data-action="go" data-view="' +
      esc(VIEW.back || "hoy") +
      '">Volver sin cambios</button></div></section>'
    );
  }

  // reprogramar: elegir a qué día se mueve la tarea del plan de hoy
  function reprogramarHtml() {
    var task = findTaskUi(VIEW.taskId);
    if (!task) return '<div class="plain-empty">No se encontró la tarea.</div>';
    return (
      '<form class="define-card" id="reschedule-form"><p class="panel-kicker">CAMBIAR DE DÍA</p><h2 class="ajustar-title">' +
      esc(task.title) +
      '</h2><p class="ajustar-note">La tarea sigue en tu bandeja; su siguiente acción no cambia.</p>' +
      (VIEW.rescheduleError
        ? '<p class="notice notice--error" role="alert" id="reschedule-error">' +
          esc(VIEW.rescheduleError) +
          "</p>"
        : "") +
      '<label class="field" for="rs-date"><span>¿Cuándo quieres trabajarla?</span><input id="rs-date" type="date" min="' +
      localPlus(1) +
      '" value="' +
      esc(VIEW.rescheduleDraft || localPlus(1)) +
      '" required' +
      invalidAttrs(!!VIEW.rescheduleError, "reschedule-error") +
      '></label><div class="stack stack--form"><button type="submit" class="btn btn--primary">Mover a ese día ' +
      ICON.arrow +
      '</button><button type="button" class="link" data-action="adjust" data-id="' +
      esc(task.id) +
      '">Cancelar</button></div></form>'
    );
  }

  // pantalla de sesión: en curso o en cierre
  function sessionScreen() {
    var s = Core.openSession(STATE);
    if (!s) {
      return (
        '<div class="empty"><p>No hay ninguna sesión abierta.</p>' +
        '<button type="button" class="btn btn--quiet" data-action="go" data-view="hoy">Ir a Hoy</button></div>'
      );
    }
    return VIEW.name === "cerrar" ? cerrarHtml() : sesionHtml(s);
  }

  // sesión en curso: acción, tiempo transcurrido con su barra, pausa y cierre
  function sesionHtml(s) {
    var paused = !!s.pausedAt;
    return (
      '<section class="session">' +
      (VIEW.reentry
        ? '<p class="notice">Retomaste una sesión abierta desde el ' +
          esc(fmtStamp(s.startedAt)) +
          ".</p>"
        : "") +
      '<div class="session-heading"><span class="session-kicker"><span class="live-dot"></span>' +
      (paused ? "TU SESIÓN ESTÁ EN PAUSA" : "AHORA, SOLO ESTO") +
      '</span><p class="session-task-name">' +
      esc(s.title) +
      '</p><h1 id="page-title" class="hero' +
      heroSize(s.action) +
      '" tabindex="-1">' +
      esc(s.action) +
      '</h1></div><div class="tempo-stage' +
      (paused ? " is-paused" : "") +
      '"><p class="tempo-label">Tiempo de enfoque</p><output class="tempo-time" id="elapsed" role="timer" aria-live="off" aria-label="Tiempo de enfoque">' +
      elapsedClock(Core.sessionDuration(s, now())) +
      '</output><div class="tempo" aria-hidden="true"><div class="tempo-fill" style="left:' +
      tempoPos(Core.sessionDuration(s, now())) +
      '%"></div></div><p class="tempo-note">' +
      (paused
        ? "El tiempo de pausa no se registra."
        : "Desde las " +
          esc(fmtClock(s.startedAt)) +
          ". Sin una meta que perseguir.") +
      '</p></div><div class="session-end"><button type="button" class="btn btn--primary" data-action="finish">Cerrar sesión ' +
      ICON.check +
      '</button><button type="button" class="btn btn--quiet" id="session-pause" data-action="session-pause-toggle">' +
      (paused ? ICON.play + "Reanudar" : ICON.pause + "Pausar") +
      '</button></div><p class="session-hint">' +
      (paused
        ? "Toma el espacio que necesites."
        : "Puedes hacer una pausa cuando lo necesites.") +
      "</p></section>"
    );
  }

  // cierre rápido: la respuesta guarda el resultado y conserva la acción vigente
  function cerrarHtml() {
    var session = Core.openSession(STATE),
      task = session && findTaskUi(session.taskId);
    var closeNext =
      "closeDraftNext" in VIEW
        ? VIEW.closeDraftNext
        : task
          ? task.nextAction
          : "";
    var selectedProgress = VIEW.closeProgress || "yes";
    return (
      '<section class="session"><form class="close-screen" id="close-form"><span class="session-kicker">CIERRE DE SESIÓN</span><h1 id="page-title" tabindex="-1">Un momento para cerrar.</h1><p>Sea como sea, este tiempo cuenta. Guarda el avance y deja listo tu próximo paso.</p><p class="notice notice--error" id="close-error" role="alert" hidden></p><fieldset class="progress-options"><legend>¿Cómo te fue?</legend><div class="choice-grid"><label class="choice"><input type="radio" name="session-progress" value="yes"' +
      (selectedProgress === "yes" ? " checked" : "") +
      '>Avancé bien</label><label class="choice"><input type="radio" name="session-progress" value="some"' +
      (selectedProgress === "some" ? " checked" : "") +
      '>Avancé un poco</label><label class="choice"><input type="radio" name="session-progress" value="no"' +
      (selectedProgress === "no" ? " checked" : "") +
      '>Hoy no avancé</label></div></fieldset><label class="check-row" for="cl-finished"><input id="cl-finished" type="checkbox"' +
      (VIEW.closeFinished ? " checked" : "") +
      '>Esta tarea quedó terminada</label><label class="field" id="next-step-field" for="cl-next"' +
      (VIEW.closeFinished ? " hidden" : "") +
      '><span>Deja listo tu siguiente paso</span><input id="cl-next" type="text" maxlength="500" value="' +
      esc(closeNext) +
      '"' +
      (VIEW.closeFinished ? " disabled" : "") +
      '></label><div class="stack stack--form"><button type="submit" class="btn btn--primary">Guardar sesión ' +
      ICON.check +
      '</button><button type="button" class="link" data-action="cl-cancel">Volver al enfoque</button></div></form></section>'
    );
  }

  // Semana: lo que trabajaste, de lunes a hoy; un día vacío es solo un día vacío
  function semanaHtml() {
    var today = localDate();
    var days = weekUpToToday(today);
    var banner = sessionBanner();

    // datos de cada día: sesiones cerradas y, solo hoy, lo que queda en el plan
    var perDay = days.map(function (ds) {
      var range = localDayRange(ds);
      var sessions = Core.sessionsBetween(STATE, range.startIso, range.endIso);
      var planned = [];
      if (ds === today) {
        var already = {};
        sessions.forEach(function (x) {
          already[x.taskId] = true;
        });
        Core.todayPlan(STATE, today).forEach(function (it) {
          if (it.task && !already[it.taskId]) planned.push(it.task);
        });
      }
      return { ds: ds, sessions: sessions, planned: planned };
    });

    var range =
      days.length === 1
        ? "Esta semana: " + fmtDayDate(today)
        : "Del " + fmtDayDate(days[0]) + " al " + fmtDayDate(today);
    var html = banner + '<p class="week-range">' + esc(range) + "</p>";
    var hasData = perDay.some(function (d) {
      return d.sessions.length || d.planned.length;
    });
    if (!hasData) {
      return (
        html +
        '<div class="plain-empty">Todavía no has trabajado ninguna sesión esta semana.<br>' +
        '<button type="button" class="link" data-action="go" data-view="hoy">Ir a Hoy</button></div>' +
        upcomingHtml()
      );
    }

    html += '<div class="week-stack">';
    perDay.forEach(function (d) {
      html +=
        '<section class="day' +
        (d.ds === today ? " today" : "") +
        '">' +
        '<h2 class="day-head"><span class="d-name">' +
        esc(fmtDayName(d.ds)) +
        "</span>" +
        '<span class="d-date">' +
        esc(fmtDayDate(d.ds)) +
        "</span>" +
        (d.ds === today ? '<span class="d-today">Hoy</span>' : "") +
        '</h2><div class="day-body">';
      if (d.sessions.length) {
        html +=
          '<p class="d-total">' +
          esc(fmtDur(Core.sessionsTotalDuration(d.sessions, null))) +
          " registrados</p>" +
          '<ul class="day-items">';
        d.sessions.forEach(function (x) {
          var t = Core.taskById(STATE, x.taskId);
          html +=
            '<li class="d-item"><span class="d-time">' +
            esc(fmtClock(x.startedAt)) +
            "</span>" +
            '<span class="d-task">' +
            esc(x.title || (t ? t.title : "(tarea eliminada)")) +
            "</span>" +
            '<span class="d-dur">' +
            esc(fmtDur(Core.sessionDuration(x, x.endedAt))) +
            "</span></li>";
        });
        html += "</ul>";
      } else if (!d.planned.length) {
        html += '<p class="day-empty">Sin sesiones</p>';
      }
      if (d.planned.length) {
        html +=
          '<div class="day-plan"><p class="day-plan-label">En el plan de hoy</p><ul class="day-items">';
        d.planned.forEach(function (t) {
          html +=
            '<li class="d-item"><span class="d-task">' +
            esc(t.nextAction) +
            "</span></li>";
        });
        html += "</ul></div>";
      }
      html += "</div></section>";
    });
    return (
      html +
      "</div>" +
      '<p class="week-note">Se muestran sesiones cerradas según el día en que empezaron. Las pausas no cuentan.</p>' +
      upcomingHtml()
    );
  }

  // Progreso: cifras globales y registro acotado por mes y búsqueda
  function progresoHtml() {
    var stats = Core.sessionStats(STATE);
    var log = Core.closedSessions(STATE);
    var html = sessionBanner();

    html +=
      '<section class="panel" aria-label="Resumen de todo el registro">' +
      '<p class="panel-note">Desde el inicio</p><div class="figures">' +
      '<div class="figure"><strong>' +
      stats.count +
      "</strong><span>Sesiones</span></div>" +
      '<div class="figure"><strong>' +
      esc(fmtDurShort(stats.totalMs)) +
      "</strong><span>Tiempo registrado</span></div>" +
      '<div class="figure"><strong>' +
      stats.completedTasks +
      "</strong><span>Tareas terminadas</span></div>" +
      "</div></section>";

    if (log.length === 0) {
      html +=
        '<div class="plain-empty">Cuando cierres tu primera sesión aparecerá aquí. Tu registro se conserva hasta que decidas borrarlo.</div>';
      return html;
    }

    // sin mes elegido, el de la sesión más reciente: tras un cambio de mes el registro no aparece vacío
    VIEW.logMonth = VIEW.logMonth || monthOf(log[0].startedAt);
    var month = VIEW.logMonth,
      isLatest = month >= localDate().slice(0, 7);
    var monthLabel = capitalize(
      new Intl.DateTimeFormat("es", {
        month: "long",
        year: "numeric",
      }).format(parseLocalDate(month + "-01")),
    );
    var query = foldSearch((VIEW.logQuery || "").trim());
    var filtered = log.filter(function (x) {
      if (monthOf(x.startedAt) !== month) return false;
      var t = Core.taskById(STATE, x.taskId);
      return foldSearch(
        [
          x.title || "",
          t ? t.title : "",
          x.action || "",
          outcomeWord(x),
          x.nextStep || "",
        ].join(" "),
      ).includes(query);
    });
    html +=
      '<p class="section-label">Registro</p>' +
      '<div class="log-controls"><div class="log-month">' +
      '<button type="button" class="log-month-btn" id="log-prev" data-action="log-prev" aria-label="Mes anterior">' +
      ICON.prev +
      "</button>" +
      "<span>" +
      esc(monthLabel) +
      "</span>" +
      '<button type="button" class="log-month-btn" id="log-next" data-action="log-next" aria-label="Mes siguiente"' +
      (isLatest ? ' aria-disabled="true"' : "") +
      ">" +
      ICON.next +
      "</button></div>" +
      '<div class="search-field">' +
      ICON.search +
      '<input id="log-search" class="log-search" type="search" autocomplete="off" ' +
      'placeholder="Buscar en el registro" aria-label="Buscar en el registro" value="' +
      esc(VIEW.logQuery || "") +
      '"></div></div>' +
      '<ul class="log" data-month="' +
      esc(monthLabel) +
      '">';
    filtered.slice(0, VIEW.logLimit || 50).forEach(function (x) {
      var t = Core.taskById(STATE, x.taskId);
      html +=
        '<li><div class="log-line">' +
        '<span class="l-task">' +
        esc(x.title || (t ? t.title : "(tarea eliminada)")) +
        "</span>" +
        '<span class="l-dur">' +
        esc(fmtDur(Core.sessionDuration(x, x.endedAt))) +
        "</span>" +
        "</div>" +
        '<p class="log-date">' +
        esc(fmtStamp(x.startedAt)) +
        "</p>" +
        '<div class="log-outcome"><span class="dot dot--' +
        outcomeKind(x) +
        '"></span><span>' +
        esc(outcomeWord(x)) +
        "</span></div>" +
        (x.nextStep
          ? '<span class="log-step">Siguiente: ' + esc(x.nextStep) + "</span>"
          : "") +
        "</li>";
    });
    html += "</ul>";
    VIEW.logSummary =
      monthLabel +
      ": " +
      (filtered.length
        ? filtered.length +
          (filtered.length === 1 ? " sesión" : " sesiones") +
          (query ? (filtered.length === 1 ? " encontrada" : " encontradas") : "")
        : query
          ? "ninguna sesión coincide"
          : "sin sesiones");
    if (!filtered.length)
      html +=
        '<p class="log-empty">' +
        (query
          ? "No hay sesiones que coincidan en este mes."
          : "No hay sesiones registradas en este mes.") +
        "</p>";
    if (filtered.length > (VIEW.logLimit || 50))
      html +=
        '<button type="button" class="btn btn--quiet more-button" id="log-more" data-action="log-more">Mostrar más sesiones</button>';
    if (filtered.length)
      html +=
        '<button type="button" class="link" data-action="print">Imprimir este registro</button>';
    return html;
  }

  // menú: exportar, importar, borrar todo y una nota de sincronización
  function menuHtml() {
    var html =
      '<section class="menu-card"><p class="menu-intro">Tus datos. Tus decisiones.</p><section class="menu-section"><h2>Apariencia</h2><div class="theme-options">' +
      [
        ["system", "Sistema", "screen"],
        ["light", "Claro", "hoy"],
        ["dark", "Oscuro", "moon"],
      ]
        .map(function (t) {
          return (
            '<button type="button" id="theme-opt-' +
            t[0] +
            '" data-action="theme-set" data-value="' +
            t[0] +
            '" aria-pressed="' +
            (THEME === t[0]) +
            '">' +
            ICON[t[2]] +
            t[1] +
            "</button>"
          );
        })
        .join("") +
      '</div></section><section class="menu-section"><h2>Copia de seguridad</h2><p>Los datos viven en este navegador. Exporta una copia para conservarlos o llevarlos a otro equipo. La importación reemplaza los datos actuales solo después de confirmar.</p>';
    if (RECOVERY_RAW !== null)
      html +=
        '<div class="notice notice--error"><span>Hay datos que esta versión no puede leer. Descarga el original antes de reemplazarlos.</span></div><button type="button" class="btn btn--quiet" data-action="recovery-export">Descargar datos originales ' +
        ICON.export +
        "</button>";
    if (VIEW.importError)
      html +=
        '<p class="notice notice--error" role="alert">' +
        esc(VIEW.importError) +
        "</p>";
    html +=
      '<div class="stack"><button type="button" class="btn btn--quiet" data-action="export">Exportar copia JSON ' +
      ICON.export +
      '</button><label class="btn btn--quiet filelabel">Importar una copia JSON ' +
      ICON.import +
      '<input id="importfile" type="file" accept="application/json,.json" aria-label="Importar una copia JSON"></label></div>';
    if (PENDING_IMPORT)
      html +=
        '<div class="menu-section"><h2>Confirmar importación</h2><p>La copia contiene ' +
        PENDING_IMPORT.tasks.length +
        (PENDING_IMPORT.tasks.length === 1 ? " tarea y " : " tareas y ") +
        PENDING_IMPORT.sessions.length +
        (PENDING_IMPORT.sessions.length === 1 ? " sesión." : " sesiones.") +
        ' Los datos actuales serán reemplazados.</p><div class="stack stack--form"><button type="button" id="import-confirm" class="btn btn--primary" data-action="import-confirm">Importar y reemplazar</button><button type="button" class="link" data-action="import-cancel">Cancelar</button></div></div>';
    html += "</section>";
    if (
      !STATE.tasks.length &&
      !STATE.sessions.length &&
      DEMO_PREV === null &&
      RECOVERY_RAW === null &&
      !EXTERNAL_CHANGED
    )
      html +=
        '<section class="menu-section"><h2>Explora sin compromiso</h2><p>Prueba las pantallas con tareas y sesiones de ejemplo. Nada de lo que hagas en ese modo se guardará.</p><button type="button" class="btn btn--quiet" data-action="sample">Abrir modo de ejemplo ' +
        ICON.arrow +
        "</button></section>";
    if (SYNC !== "off") {
      html +=
        '<section class="menu-section"><h2>Sincronización</h2><p>' +
        (SYNC === "localonly"
          ? "No se pudo contactar con tu API. La copia local sigue disponible."
          : "Cliente de sincronización conectado a la API configurada en este origen.") +
        '</p><label class="field" for="synctoken"><span>Token de acceso</span><input id="synctoken" type="password" autocomplete="off" placeholder="' +
        (syncToken() ? "Hay un token guardado" : "Token de tu API") +
        '"></label><div class="stack"><button type="button" class="btn btn--quiet" data-action="save-token">Guardar token</button>' +
        (syncToken()
          ? '<button type="button" class="link" data-action="clear-token">Quitar token</button>'
          : "") +
        "</div></section>";
    }
    html +=
      '<section class="menu-section menu-section--keys"><h2>Atajos de teclado</h2><ul class="shortcut-list"><li><kbd>N</kbd>Nueva tarea</li><li><kbd>Espacio</kbd>Empezar desde Hoy</li><li><kbd>P</kbd>Pausar o reanudar</li><li><kbd>Esc</kbd>Volver a Hoy</li></ul></section><section class="menu-section"><h2>Empezar de nuevo</h2><p>Esta acción borra las tareas, los planes y las sesiones. Antes de hacerlo, exporta una copia.</p>';
    if (!VIEW.confirmWipe)
      html +=
        '<button type="button" class="btn btn--danger" data-action="wipe-ask">Borrar todos los datos ' +
        ICON.trash +
        "</button>";
    else
      html +=
        '<p class="notice notice--error" role="alert">¿Borrar todo? Exporta una copia antes. El borrado de datos compatibles se puede deshacer durante 10 segundos; un archivo incompatible no se puede restaurar desde aquí.</p><div class="stack stack--form"><button type="button" class="btn btn--danger" data-action="wipe-yes">Sí, borrar todo</button><button type="button" class="link" data-action="wipe-no">Cancelar</button></div>';
    return (
      html +
      '</section><p class="menu-footer">' +
      (SYNC === "off"
        ? "Versión local: no envía tus tareas a servidores. La sincronización necesita una API propia y está desactivada por defecto."
        : "La sincronización depende de la API configurada. Exporta una copia periódicamente.") +
      "</p></section>"
    );
  }

  // ---------- eventos ----------
  function wire() {
    var inline = document.getElementById("inline-action");
    if (inline)
      inline.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.isComposing) {
          e.preventDefault();
          onSaveInlineAction();
        }
      });
    var cap = document.getElementById("capture"),
      form = document.getElementById("capture-form");
    if (cap)
      cap.addEventListener("input", function () {
        CAPTURE_DRAFT = cap.value;
        var add = document.querySelector(".capture-add");
        if (add) add.disabled = !cap.value.trim();
      });
    if (form)
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (cap.value.trim()) doCapture(cap.value);
      });
    function wireSearch(id, key, summary) {
      var input = document.getElementById(id);
      if (!input) return;
      input.addEventListener("input", function () {
        var start = input.selectionStart,
          end = input.selectionEnd;
        VIEW[key] = input.value;
        VIEW.inboxLimit = 30;
        VIEW.logLimit = 50;
        render();
        var next = document.getElementById(id);
        if (next) {
          next.focus({ preventScroll: true });
          next.setSelectionRange(start, end);
        }
        srAnnounce(VIEW[summary], 700);
      });
    }
    wireSearch("inbox-search", "inboxQuery", "inboxSummary");
    wireSearch("log-search", "logQuery", "logSummary");
    var filter = document.getElementById("inbox-filter");
    if (filter)
      filter.addEventListener("change", function () {
        VIEW.inboxFilter = filter.value;
        VIEW.inboxLimit = 30;
        VIEW.editTaskId = null;
        render();
        var next = document.getElementById("inbox-filter");
        if (next) next.focus();
        srAnnounce(VIEW.inboxSummary, 100);
      });
    var imp = document.getElementById("importfile");
    if (imp)
      imp.addEventListener("change", function () {
        if (imp.files && imp.files[0]) doImport(imp.files[0]);
      });
    var define = document.getElementById("define-form");
    if (define)
      define.addEventListener("submit", function (e) {
        e.preventDefault();
        onSaveDefine();
      });
    var reschedule = document.getElementById("reschedule-form");
    if (reschedule)
      reschedule.addEventListener("submit", function (e) {
        e.preventDefault();
        onSaveReschedule();
      });
    var close = document.getElementById("close-form");
    if (close)
      close.addEventListener("submit", function (e) {
        e.preventDefault();
        var selected = document.querySelector(
          '[name="session-progress"]:checked',
        );
        doCloseSession(selected ? selected.value : "");
      });
    var closeNext = document.getElementById("cl-next");
    if (closeNext)
      closeNext.addEventListener("input", function () {
        if (closeNext.value.trim()) closeNext.removeAttribute("aria-invalid");
      });
    var finished = document.getElementById("cl-finished");
    if (finished)
      finished.addEventListener("change", function () {
        var field = document.getElementById("next-step-field"),
          next = document.getElementById("cl-next");
        field.hidden = finished.checked;
        next.disabled = finished.checked;
      });
  }

  // clic delegado sobre el contenedor
  function onClick(e) {
    var btn = e.target.closest ? e.target.closest("[data-action]") : null;
    if (!btn || btn.disabled) return;
    var action = btn.getAttribute("data-action"),
      id = btn.getAttribute("data-id"),
      view = btn.getAttribute("data-view"),
      value = btn.getAttribute("data-value");
    if (action === "go") {
      VIEW = { name: view, focusHeading: true };
      render();
      document
        .getElementById("main-content")
        .scrollIntoView({ block: "start", behavior: "instant" });
    } else if (action === "capture-add") {
      var cap = document.getElementById("capture");
      if (cap && cap.value.trim()) doCapture(cap.value);
    } else if (action === "toggle-menu") {
      VIEW.menu = !VIEW.menu;
      VIEW.confirmWipe = false;
      VIEW.importError = null;
      VIEW.focusHeading = true;
      PENDING_IMPORT = null;
      render();
    } else if (action === "open-settings") {
      VIEW = { name: "hoy", menu: true, focusHeading: true };
      render();
    } else if (action === "theme-toggle") setTheme(isDark() ? "light" : "dark");
    else if (action === "theme-set") setTheme(value);
    else if (action === "edit-inline-action") {
      VIEW = { name: "bandeja", editTaskId: id, focusAction: true };
      render();
    } else if (action === "save-inline-action") onSaveInlineAction();
    else if (action === "cancel-inline-action") {
      VIEW = { name: "bandeja" };
      render();
    } else if (action === "choose") doChooseForToday(id);
    else if (action === "adjust") {
      VIEW = {
        name: "ajustar",
        taskId: id,
        back:
          VIEW.name === "bandeja" || VIEW.back === "bandeja"
            ? "bandeja"
            : "hoy",
        focusHeading: true,
      };
      render();
    } else if (action === "adjust-edit") {
      VIEW = {
        name: "definir",
        taskId: id,
        back: VIEW.back || "hoy",
        focusHeading: true,
      };
      render();
    } else if (action === "adjust-remove") doRemoveFromToday(id);
    else if (action === "adjust-done") doMarkDone(id);
    else if (action === "adjust-pause") doPause(id);
    else if (action === "adjust-reschedule") {
      VIEW = {
        name: "reprogramar",
        taskId: id,
        back: VIEW.back,
        focusHeading: true,
      };
      render();
    } else if (action === "reschedule-save") onSaveReschedule();
    else if (action === "task-resume") {
      var resumed = Core.resumeTask(STATE, { taskId: id }, now());
      if (resumed.ok) {
        VIEW = { name: "bandeja" };
        apply(resumed.state);
        announce("Tarea recuperada en tu bandeja.");
      } else announce(resumed.error);
    } else if (action === "start") doStart(id);
    else if (action === "tofirst") doMoveToFirst(id);
    else if (action === "save-define") onSaveDefine();
    else if (action === "cancel-define") {
      VIEW = { name: VIEW.back || "hoy" };
      render();
    } else if (action === "finish") {
      VIEW = { name: "cerrar", focusHeading: true };
      render();
    } else if (action === "cl-progress") doCloseSession(value);
    else if (action === "cl-cancel") {
      VIEW = { name: "sesion" };
      render();
    } else if (action === "export") doExport();
    else if (action === "recovery-export")
      downloadText(
        RECOVERY_RAW || LOAD_RAW || "{}",
        "siguiente-recuperacion.json",
      );
    else if (action === "import-confirm") {
      if (!PENDING_IMPORT) return;
      var previous = STATE,
        imported = PENDING_IMPORT;
      RECOVERY_RAW = null;
      LOAD_NOTICE = "";
      EXTERNAL_CHANGED = false;
      PENDING_IMPORT = null;
      stopElapsed();
      VIEW = { name: Core.openSession(imported) ? "sesion" : "hoy" };
      apply(imported);
      setUndo(previous, "Copia importada.");
    } else if (action === "import-cancel") {
      PENDING_IMPORT = null;
      render();
    } else if (action === "wipe-ask") {
      VIEW.confirmWipe = true;
      render();
      var confirmWipe = document.querySelector('[data-action="wipe-yes"]');
      if (confirmWipe) confirmWipe.focus();
    } else if (action === "wipe-yes") doDeleteAll();
    else if (action === "wipe-no") {
      VIEW.confirmWipe = false;
      render();
    } else if (action === "session-pause-toggle") {
      var open = Core.openSession(STATE);
      if (open) {
        if (open.pausedAt) doResumeSession();
        else doPauseSession();
      }
    } else if (action === "undo") doUndo();
    else if (action === "sample") doLoadSample();
    else if (action === "demo-exit") {
      if (DEMO_PREV !== null) {
        STATE = DEMO_PREV;
        DEMO_PREV = null;
        clearUndo();
        CAPTURE_DRAFT = "";
        SAVE = "saved";
        VIEW = { name: "hoy" };
        render();
      }
    } else if (action === "log-prev" || action === "log-next") {
      if (btn.getAttribute("aria-disabled") === "true") return;
      var month = parseLocalDate(VIEW.logMonth + "-01");
      month.setMonth(month.getMonth() + (action === "log-prev" ? -1 : 1));
      VIEW.logMonth = month.getFullYear() + "-" + pad(month.getMonth() + 1);
      VIEW.logLimit = 50;
      render();
      srAnnounce(VIEW.logSummary, 100);
    } else if (action === "inbox-more") {
      VIEW.inboxLimit = (VIEW.inboxLimit || 30) + 30;
      render();
    } else if (action === "log-more") {
      VIEW.logLimit = (VIEW.logLimit || 50) + 50;
      render();
    } else if (action === "print") window.print();
    else if (action === "reload") location.reload();
    else if (action === "save-token") {
      var tk = document.getElementById("synctoken");
      if (tk && tk.value.trim()) {
        setSyncToken(tk.value);
        VIEW = { name: "hoy" };
        adapter.load().then(
          function (loaded) {
            STATE = usableState(loaded);
            SAVE = "saved";
            render();
          },
          function () {
            announce("No se pudo conectar a la API.");
          },
        );
      }
    } else if (action === "clear-token") {
      setSyncToken("");
      render();
    }
  }

  // ---------- tiempo transcurrido: el intervalo solo repinta, nunca cuenta ni guarda ----------
  function startElapsed() {
    stopElapsed();
    tickElapsed();
    elapsedTimer = setInterval(tickElapsed, 1000);
  }
  function tickElapsed() {
    var session = Core.openSession(STATE),
      el = document.getElementById("elapsed");
    if (!session || !el) {
      stopElapsed();
      return;
    }
    var duration = Core.sessionDuration(session, now());
    el.textContent = elapsedClock(duration);
    if (!session.pausedAt && !REDUCE) {
      var fill = document.querySelector(".tempo-fill");
      if (fill) fill.style.left = tempoPos(duration) + "%";
    }
  }
  function stopElapsed() {
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  }

  // ---------- arranque ----------
  // normaliza lo cargado a un estado usable
  function usableState(loaded) {
    if (loaded === null || loaded === undefined) return Core.emptyState();
    var state = Core.migrate(loaded),
      checked = Core.validateState(state);
    if (checked.ok) return state;
    RECOVERY_RAW = LOAD_RAW || JSON.stringify(loaded);
    LOAD_NOTICE =
      "Hay datos de un formato no compatible. No los sobrescribimos: descarga el original desde Ajustes antes de reemplazarlos.";
    return Core.emptyState();
  }

  function init() {
    document.getElementById("app").addEventListener("click", onClick);
    document.documentElement.setAttribute("data-theme", THEME);
    LAST_DAY = localDate();
    window.addEventListener("keydown", function (e) {
      if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      var tag = e.target && e.target.tagName;
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(tag) ||
        (e.target && e.target.isContentEditable)
      ) {
        if (e.key === "Escape") e.target.blur();
        return;
      }
      var key = e.key.toLowerCase();
      if (key === "n" || key === "/") {
        e.preventDefault();
        VIEW = { name: "hoy", focusCapture: true };
        render();
      } else if (key === "escape") {
        VIEW = { name: "hoy", focusHeading: true };
        render();
      } else if (
        key === " " &&
        VIEW.name === "hoy" &&
        !VIEW.menu &&
        tag !== "BUTTON" &&
        tag !== "A"
      ) {
        var plan = Core.todayPlan(STATE, localDate());
        if (plan.length) {
          e.preventDefault();
          doStart(plan[0].taskId);
        }
      } else if (key === "p" && VIEW.name === "sesion" && !VIEW.menu) {
        var session = Core.openSession(STATE);
        if (session) {
          if (session.pausedAt) doResumeSession();
          else doPauseSession();
        }
      }
    });
    window.addEventListener("storage", function (e) {
      if (e.key === "siguiente.theme") {
        THEME = ["system", "dark", "light"].includes(e.newValue)
          ? e.newValue
          : "system";
        document.documentElement.setAttribute("data-theme", THEME);
        render();
      }
      if (
        e.key === LocalStorageAdapter.key &&
        DEMO_PREV === null &&
        e.newValue !== JSON.stringify(STATE)
      ) {
        EXTERNAL_CHANGED = true;
        render();
      }
    });
    window.addEventListener("beforeprint", function () {
      if (VIEW.name !== "progreso" || VIEW.menu || PRINT_LIMIT !== null) return;
      PRINT_LIMIT = VIEW.logLimit || 50;
      VIEW.logLimit = Number.MAX_SAFE_INTEGER;
      render();
    });
    window.addEventListener("afterprint", function () {
      if (PRINT_LIMIT === null) return;
      if (VIEW.name === "progreso") VIEW.logLimit = PRINT_LIMIT;
      PRINT_LIMIT = null;
      render();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) return;
      tickElapsed();
      if (localDate() !== LAST_DAY) {
        LAST_DAY = localDate();
        render();
      }
    });
    try {
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", function () {
          if (THEME === "system") render();
        });
    } catch (e) {}
    adapter.load().then(
      function (loaded) {
        STATE = usableState(loaded);
        SAVE = "saved";
        VIEW = Core.openSession(STATE)
          ? { name: "sesion", reentry: true }
          : { name: "hoy" };
        render();
      },
      function () {
        STATE = Core.emptyState();
        SAVE = "error";
        VIEW = { name: "hoy" };
        LOAD_NOTICE =
          "No se pudieron cargar los datos. Intenta recargar antes de hacer cambios.";
        render();
      },
    );
  }

  function downloadText(text, filename) {
    var url = URL.createObjectURL(
      new Blob([text], { type: "application/json" }),
    );
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 2000);
  }
  function upcomingHtml() {
    var upcoming = STATE.plans
      .filter(function (p) {
        return p.date > localDate() && Core.todayPlan(STATE, p.date).length;
      })
      .sort(function (a, b) {
        return a.date.localeCompare(b.date);
      });
    if (!upcoming.length) return "";
    var html =
      '<div class="section-heading"><h2>Próximos pasos</h2><span>Tareas reprogramadas</span></div><div class="week-stack">';
    upcoming.forEach(function (p) {
      html +=
        '<section class="day"><h3 class="day-head"><span class="d-name">' +
        esc(fmtDayName(p.date)) +
        '</span><span class="d-date">' +
        esc(fmtDayDate(p.date)) +
        '</span></h3><div class="day-body"><ul class="day-items">';
      Core.todayPlan(STATE, p.date).forEach(function (it) {
        html +=
          '<li class="d-item"><span class="d-task">' +
          esc(it.task.nextAction) +
          '<span class="sub">' +
          esc(it.task.title) +
          "</span></span></li>";
      });
      html += "</ul></div></section>";
    });
    return html + "</div>";
  }

  init();
})();
