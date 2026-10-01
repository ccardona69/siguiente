/* Prueba autocontenida para las páginas aisladas generadas por make-qa-pages.py. */
(async function () {
  "use strict";
  var assertions = 0;
  var KEY = "siguiente.qa.v2";
  var wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  var all = (q) => [...document.querySelectorAll(q)];
  var get = (q) => document.querySelector(q);
  function check(value, message) {
    assertions++;
    if (!value) throw new Error("UI #" + assertions + ": " + message);
  }
  function visible(q) {
    return all(q).find(
      (e) =>
        getComputedStyle(e).display !== "none" &&
        e.getClientRects().length &&
        !e.closest("[hidden]") &&
        e.offsetWidth > 0,
    );
  }
  function click(q) {
    var el = visible(q);
    check(!!el, "Control no disponible: " + q);
    el.scrollIntoView({ block: "nearest", behavior: "instant" });
    el.click();
    return el;
  }
  function input(q, value) {
    var el = get(q);
    check(!!el, "Campo no disponible: " + q);
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return get(q);
  }
  function submit(q, native = true) {
    var el = get(q);
    check(!!el, "Formulario no disponible: " + q);
    if (native) el.requestSubmit();
    else
      el.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
  }
  function go(view) {
    click('[data-action="go"][data-view="' + view + '"]');
  }
  function state() {
    return JSON.parse(localStorage.getItem(KEY));
  }
  function valid() {
    check(
      SiguienteCore.validateState(state()).ok,
      "Estado persistido inválido",
    );
  }
  async function until(q) {
    for (let n = 0; n < 180; n++) {
      if (get(q)) return get(q);
      await wait(10);
    }
    throw new Error("No apareció " + q);
  }
  function upload(data, filename = "prueba.json") {
    var dt = new DataTransfer();
    dt.items.add(new File([data], filename, { type: "application/json" }));
    var el = get("#importfile");
    el.files = dt.files;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function finish(name) {
    document.title =
      "QA PASS · " + name + " · " + assertions + " comprobaciones";
    document.documentElement.dataset.qaStatus = "pass";
    get("#announcement").textContent = "";
  }
  await until("#capture");
  check(get("h1") && all("h1").length === 1, "Una sola cabecera principal");
  check(
    get('[lang="es"]') || document.documentElement.lang === "es",
    "Idioma español",
  );

  // Contrato mobile-first: móvil es la base; escritorio se añade por min-width.
  var phoneShell = innerWidth < 1024;
  var mainBox = get("#main-content").getBoundingClientRect();
  var tabBox = get(".tabbar").getBoundingClientRect();
  check(
    (getComputedStyle(get(".tabbar")).display !== "none") === phoneShell,
    "Navegación inferior solo en móvil/tablet",
  );
  check(
    (getComputedStyle(get(".sidebar")).display !== "none") === !phoneShell,
    "Navegación lateral solo en escritorio",
  );
  check(
    !phoneShell || Math.abs(mainBox.bottom - tabBox.top) < 1,
    "Navegación fuera del contenido, sin superponerlo",
  );
  check(
    !phoneShell ||
      Math.abs(get("#app").getBoundingClientRect().height - innerHeight) < 1,
    "Shell móvil dentro del viewport",
  );
  check(
    document.documentElement.scrollWidth <= innerWidth,
    "Sin desplazamiento horizontal",
  );
  check(
    parseFloat(getComputedStyle(get("#capture")).fontSize) >= 16,
    "Campo móvil de 16 px, sin zoom por fuente pequeña",
  );
  check(
    !/@media[^{}]*\(\s*max-width\s*:/.test(document.querySelector("style").textContent),
    "Breakpoints solo min-width",
  );
  check(
    ["theme-toggle", "toggle-menu"].every(
      (a) =>
        all('[data-action="' + a + '"]').filter((e) => e.getClientRects().length)
          .length === 1,
    ),
    "Tema y ajustes sin controles duplicados a la vista",
  );
  check(
    /^data:image\/png;base64,/.test(get('link[rel="icon"]').getAttribute("href")),
    "Icono de pestaña en línea, sin archivos externos",
  );
  check(
    all(phoneShell ? ".tab" : ".sidenav .nav-item").every((e) => {
      var r = e.getBoundingClientRect();
      return r.width >= 44 && r.height >= 44;
    }),
    "Navegación con objetivos táctiles de 44 px",
  );

  if (globalThis.QA_KIND === "workflow") {
    input("#capture", "   ");
    check(get(".capture-add").disabled, "Captura vacía deshabilitada");
    input("#capture", "Preparar el informe");
    click(".capture-add");
    await wait(0);
    check(state().tasks.length === 1, "Captura persistida");
    check(
      document.activeElement.id === "inline-action",
      "Foco en la siguiente acción",
    );
    click('[data-action="save-inline-action"]');
    check(!!get("#action-error"), "Error de acción vacía visible");
    check(state().tasks[0].nextAction === null, "Error no modifica datos");
    input("#inline-action", "Redactar el primer párrafo");
    click('[data-action="theme-toggle"]');
    check(
      all('meta[name="theme-color"]').every((m) => m.content === "#171513"),
      "La barra del navegador sigue al tema oscuro",
    );
    check(
      get("#inline-action").value === "Redactar el primer párrafo",
      "Borrador sobrevive al cambio de tema",
    );
    click('[data-action="save-inline-action"]');
    await wait(0);
    check(
      state().tasks[0].nextAction === "Redactar el primer párrafo",
      "Acción guardada",
    );
    click('[data-action="choose"]');
    await wait(0);
    check(!!get(".focus-card"), "Plan de hoy visible");
    valid();
    click('[data-action="start"]');
    await wait(0);
    check(!!get("#elapsed"), "Temporizador visible");
    check(SiguienteCore.openSession(state()), "Sesión persistida");
    check(
      /^En sesión: .+ · Siguiente$/.test(document.title),
      "La pestaña muestra la acción en curso",
    );
    await wait(1080);
    check(get("#elapsed").textContent !== "00:00", "Temporizador avanza");
    click('[data-action="session-pause-toggle"]');
    await wait(0);
    var frozen = get("#elapsed").textContent;
    check(!!SiguienteCore.openSession(state()).pausedAt, "Pausa persistida");
    check(/^En pausa: /.test(document.title), "La pestaña indica la pausa");
    await wait(1100);
    check(get("#elapsed").textContent === frozen, "Tiempo congelado en pausa");
    go("bandeja");
    check(!!get(".as-button"), "Acceso a la sesión desde otras vistas");
    click(".as-button");
    click('[data-action="session-pause-toggle"]');
    await wait(0);
    check(!SiguienteCore.openSession(state()).pausedAt, "Sesión reanudada");
    click('[data-action="finish"]');
    click("#cl-finished");
    check(
      get("#next-step-field").hidden && get("#cl-next").disabled,
      "Terminar oculta el próximo paso",
    );
    click("#cl-finished");
    input("#cl-next", "");
    submit("#close-form");
    check(!get("#close-error").hidden, "Error de cierre visible");
    check(
      get("#cl-next").getAttribute("aria-invalid") === "true" &&
        get("#cl-next").getAttribute("aria-describedby") === "close-error" &&
        document.activeElement.id === "cl-next",
      "El error marca el campo, lo enlaza al mensaje y le da el foco",
    );
    check(
      SiguienteCore.openSession(state()),
      "No se pierde una sesión por un error",
    );
    input("#cl-next", "Revisar la introducción");
    check(
      !get("#cl-next").hasAttribute("aria-invalid"),
      "Al corregirlo deja de marcarse",
    );
    click('[name="session-progress"][value="some"]');
    submit("#close-form");
    await wait(0);
    check(!SiguienteCore.openSession(state()), "Sesión cerrada");
    check(state().sessions[0].progress === "some", "Resultado persistido");
    check(
      state().tasks[0].nextAction === "Revisar la introducción",
      "Próximo paso actualizado",
    );
    valid();
    go("progreso");
    check(all(".log > li").length === 1, "Registro de sesiones");
    check(document.title === "Progreso · Siguiente", "Título de pestaña por sección");
    var monthName = get(".log-month span").textContent;
    check(
      /^\p{Lu}\p{Ll}+ de \d{4}$/u.test(monthName),
      "Mes escrito como en español (solo la inicial en mayúscula)",
    );
    check(
      get("#log-next").getAttribute("aria-disabled") === "true",
      "No se avanza más allá del mes actual",
    );
    var pane = get("#main-content");
    if (pane.scrollHeight - pane.clientHeight > 48) pane.scrollTop = 48;
    var scrollBeforeSearch = pane.scrollTop;
    input("#log-search", "NO_COINCIDE");
    await wait(750);
    check(
      get("#sr-status").textContent.includes("ninguna sesión coincide"),
      "El resultado de la búsqueda se anuncia a lectores de pantalla",
    );
    check(
      get("#main-content").scrollTop === scrollBeforeSearch,
      "Buscar no reinicia el desplazamiento del panel",
    );
    check(
      all(".log > li").length === 0 && !!get(".log-empty"),
      "Búsqueda sin resultados",
    );
    input("#log-search", "");
    check(all(".log > li").length === 1, "Búsqueda restablecida");
    get("#log-prev").focus();
    click('[data-action="log-prev"]');
    check(all(".log > li").length === 0, "Cambio a mes sin registros");
    check(
      document.activeElement.id === "log-prev",
      "El foco sigue en el botón del mes tras repintar",
    );
    check(
      get(".log-empty").textContent.includes("registradas"),
      "Mes vacío sin búsqueda: mensaje propio",
    );
    click('[data-action="log-next"]');
    check(all(".log > li").length === 1, "Volver al mes actual");
    click("#log-next");
    check(
      get(".log-month span").textContent === monthName &&
        all(".log > li").length === 1,
      "El botón desactivado no cambia de mes",
    );
    go("bandeja");
    input(
      "#capture",
      'Leer <img src=x onerror="globalThis.pwned=true"> y tomar notas',
    );
    click(".capture-add");
    input("#inline-action", "Leer una página");
    click('[data-action="save-inline-action"]');
    click('[data-action="choose"]');
    await wait(0);
    check(
      !get("#app img") && !globalThis.pwned,
      "Texto del usuario no ejecuta HTML",
    );
    check(
      SiguienteCore.todayPlan(state(), globalThis.QA_TODAY).length === 2,
      "Dos tareas elegidas",
    );
    click('[data-action="tofirst"]');
    await wait(0);
    check(
      get(".task-context").textContent.startsWith("Leer <img"),
      "Reordenar plan",
    );
    click('[data-action="adjust"]');
    click('[data-action="adjust-edit"]');
    input("#d-title", "Leer y tomar notas");
    input("#d-next", "Leer dos páginas");
    input("#d-outcome", "Apuntes preparados");
    click('[data-action="theme-toggle"]');
    check(
      get("#d-title").value === "Leer y tomar notas" &&
        get("#d-next").value === "Leer dos páginas",
      "Edición completa conserva borradores",
    );
    submit("#define-form");
    await wait(0);
    check(
      state().tasks[1].nextAction === "Leer dos páginas",
      "Edición completa guardada",
    );
    click('[data-action="adjust"]');
    click('[data-action="adjust-reschedule"]');
    input("#rs-date", "2020-01-01");
    submit("#reschedule-form", false);
    check(!!get("#reschedule-error"), "Fecha pasada genera error");
    input("#rs-date", globalThis.QA_TOMORROW);
    submit("#reschedule-form");
    await wait(0);
    check(
      SiguienteCore.todayPlan(state(), QA_TODAY).length === 1 &&
        SiguienteCore.todayPlan(state(), QA_TOMORROW).length === 1,
      "Reprogramación correcta",
    );
    go("semana");
    check(
      document.querySelector(".view").textContent.includes("Próximos pasos"),
      "Planes futuros recuperables",
    );
    go("hoy");
    click('[data-action="adjust"]');
    click('[data-action="adjust-pause"]');
    await wait(0);
    check(get("#inbox-filter").value === "paused", "Filtro de pausa");
    click('[data-action="task-resume"]');
    await wait(0);
    check(state().tasks[0].status === "active", "Tarea recuperada");
    click('[data-action="choose"][data-id="' + state().tasks[0].id + '"]');
    await wait(0);
    click('[data-action="adjust"]');
    click('[data-action="adjust-done"]');
    await wait(0);
    check(state().tasks[0].status === "done", "Tarea terminada");
    click('[data-action="undo"]');
    await wait(0);
    check(state().tasks[0].status === "active", "Deshacer finalización");
    valid();
    click('[data-action="toggle-menu"]');
    check(
      (getComputedStyle(get(".menu-section--keys")).display !== "none") ===
        matchMedia("(hover: hover) and (pointer: fine)").matches,
      "Atajos de teclado solo donde hay teclado y puntero fino",
    );
    check(document.title === "Ajustes · Siguiente", "Título de pestaña en Ajustes");
    var create = URL.createObjectURL;
    var blob = null;
    URL.createObjectURL = function (value) {
      blob = value;
      return create.call(URL, value);
    };
    click('[data-action="export"]');
    check(!!blob, "Exportación genera archivo");
    var exported = JSON.parse(await blob.text());
    check(
      exported.tasks.length === 2 && exported.sessions.length === 1,
      "Copia exportada completa",
    );
    URL.createObjectURL = create;
    var before = localStorage.getItem(KEY);
    upload("not json");
    await wait(30);
    check(!!get('[role="alert"]'), "Importación inválida informa error");
    check(
      localStorage.getItem(KEY) === before,
      "Importación inválida no sobrescribe",
    );
    var imported = SiguienteCore.captureTask(
      SiguienteCore.emptyState(),
      { title: "Tarea de una copia" },
      new Date().toISOString(),
    ).state;
    upload(JSON.stringify(imported));
    await until("#import-confirm");
    check(state().tasks.length === 2, "Importar requiere confirmación");
    click('[data-action="import-cancel"]');
    check(state().tasks.length === 2, "Cancelar importación mantiene datos");
    upload(JSON.stringify(imported));
    await until("#import-confirm");
    click('[data-action="import-confirm"]');
    await wait(0);
    check(
      state().tasks.length === 1 &&
        state().tasks[0].title === "Tarea de una copia",
      "Importación confirmada",
    );
    click('[data-action="undo"]');
    await wait(0);
    check(state().tasks.length === 2, "Deshacer importación");
    click('[data-action="toggle-menu"]');
    click('[data-action="wipe-ask"]');
    check(state().tasks.length === 2, "Borrar requiere confirmación");
    click('[data-action="wipe-no"]');
    check(state().tasks.length === 2, "Cancelar borrado");
    click('[data-action="wipe-ask"]');
    click('[data-action="wipe-yes"]');
    await wait(0);
    check(state().tasks.length === 0, "Borrado confirmado");
    click('[data-action="undo"]');
    await wait(0);
    check(state().tasks.length === 2, "Deshacer borrado");
    valid();
    go("hoy");
    click('[data-action="adjust"]');
    click('[data-action="adjust-edit"]');
    input("#d-title", "Informe revisado");
    submit("#define-form");
    await wait(0);
    go("progreso");
    input("#log-search", "Preparar el informe");
    check(
      all(".log > li").length === 1,
      "Búsqueda encuentra el título histórico después de renombrar",
    );
    input("#log-search", "Informe revisado");
    check(
      all(".log > li").length === 1,
      "Búsqueda encuentra también el nombre actual",
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "n", bubbles: true }),
    );
    check(document.activeElement.id === "capture", "Atajo N");
    input("#capture", "Un borrador sin guardar");
    click('[data-action="theme-toggle"]');
    check(
      get("#capture").value === "Un borrador sin guardar",
      "Captura conserva borrador",
    );
    check(
      document.documentElement.scrollWidth <= window.innerWidth,
      "Sin desbordamiento horizontal",
    );
    check(
      !performance
        .getEntriesByType("resource")
        .some((x) => x.name.includes("/api/state")),
      "Modo local no intenta sincronizar",
    );
    finish("Recorrido completo");
  } else if (QA_KIND === "recovery") {
    var raw = localStorage.getItem(KEY);
    check(!!get(".notice--error"), "Aviso de recuperación");
    input("#capture", "No sobrescribir");
    click(".capture-add");
    check(
      localStorage.getItem(KEY) === raw,
      "Datos incompatibles no se sobrescriben",
    );
    click('[data-action="open-settings"]');
    check(
      !!get('[data-action="recovery-export"]'),
      "Descarga del original disponible",
    );
    click('[data-action="wipe-ask"]');
    click('[data-action="wipe-no"]');
    check(localStorage.getItem(KEY) === raw, "Cancelar conserva el original");
    finish("Recuperación no destructiva");
  } else if (QA_KIND === "quota") {
    input("#capture", "Tarea en memoria");
    click(".capture-add");
    await wait(20);
    check(
      get("#saveind").textContent.includes("No se pudo guardar"),
      "Error de cuota no se presenta como guardado",
    );
    check(localStorage.getItem(KEY) === null, "No finge persistencia");
    click('[data-action="toggle-menu"]');
    check(!!get('[data-action="export"]'), "Exportación disponible tras fallo");
    finish("Error de almacenamiento");
  } else if (QA_KIND === "tabs") {
    var external = SiguienteCore.captureTask(
      SiguienteCore.emptyState(),
      { title: "Cambio de otra pestaña" },
      new Date().toISOString(),
    ).state;
    var raw = JSON.stringify(external);
    localStorage.setItem(KEY, raw);
    window.dispatchEvent(
      new StorageEvent("storage", { key: KEY, newValue: raw }),
    );
    check(!!get('[data-action="reload"]'), "Conflicto entre pestañas visible");
    input("#capture", "No pisar datos");
    click(".capture-add");
    check(localStorage.getItem(KEY) === raw, "No pisa cambios externos");
    finish("Conflicto entre pestañas");
  } else if (QA_KIND === "pagination") {
    go("bandeja");
    check(all(".task").length === 30, "Paginación inicial de 30");
    click('[data-action="inbox-more"]');
    check(all(".task").length === 40, "Segunda página");
    input("#inbox-search", "tarea 39");
    check(
      all(".task").length === 1,
      "Búsqueda global, no solo la primera página",
    );
    input("#inbox-search", "zzzz");
    check(!!get(".plain-empty"), "Vacío de búsqueda");
    finish("Paginación y búsqueda");
  } else if (QA_KIND === "print") {
    go("progreso");
    check(all(".log > li").length === 50, "El registro inicia paginado");
    window.dispatchEvent(new Event("beforeprint"));
    check(
      all(".log > li").length === 60,
      "Se imprimen todos los registros filtrados, no solo los visibles",
    );
    window.dispatchEvent(new Event("afterprint"));
    check(
      all(".log > li").length === 50,
      "La paginación se restaura después de imprimir",
    );
    valid();
    finish("Registro imprimible completo");
  } else if (QA_KIND === "reload") {
    if (sessionStorage.getItem("siguiente.qa.reload") !== "done") {
      input("#capture", "Persistencia al recargar");
      click(".capture-add");
      await wait(0);
      sessionStorage.setItem("siguiente.qa.reload", "done");
      location.reload();
      return;
    }
    check(
      state().tasks.length === 1 &&
        state().tasks[0].title === "Persistencia al recargar",
      "Estado conservado tras recarga",
    );
    go("bandeja");
    check(
      get(".t-title").textContent === "Persistencia al recargar",
      "UI rehidratada",
    );
    finish("Recarga real");
  }
})().catch(function (e) {
  document.title = "QA FAIL · " + e.message;
  setTimeout(function () {
    throw e;
  }, 0);
});
