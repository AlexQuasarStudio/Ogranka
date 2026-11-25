/* Application bootstrap: splash, wiring, hotkeys. */
let splashDone = false;

function finishSplash() {
  const splash = $("splash");
  if (!splash || splash.classList.contains("done")) return;
  splash.classList.add("done");
  splash.setAttribute("aria-hidden", "true");
  const status = splash.querySelector(".splash-status");
  if (status) status.textContent = "Готово";
  const bar = splash.querySelector(".splash-progress span");
  if (bar) bar.classList.add("done");
  clearInterval(splash._statusTimer);
  setTimeout(() => {
    splashDone = true;
    window.dispatchEvent(new Event("ogranka:splash-done"));
  }, 700);
}

function initSplash() {
  const splash = $("splash");
  if (!splash) { splashDone = true; return; }
  const status = splash.querySelector(".splash-status");
  const stages = ["Собираю сечения…", "Строю опорные функции…", "Собираю грани…", "Сверяю метрики…"];
  let index = 0;
  splash._statusTimer = setInterval(() => {
    index = (index + 1) % stages.length;
    if (status) status.textContent = stages[index];
  }, 620);
  const started = performance.now();
  const minMs = 600;
  const hide = () => setTimeout(finishSplash, Math.max(0, minMs - (performance.now() - started)));
  if (document.readyState === "complete") hide();
  else window.addEventListener("load", hide, { once: true });
  setTimeout(finishSplash, 6000);
}

function setFullLiveCollapsed(collapsed, save = true) {
  const panel = $("fullLive");
  if (!panel) return;
  panel.classList.toggle("collapsed", !!collapsed);
  const btn = $("fullLiveToggle");
  const body = $("fullLiveBody");
  if (btn) {
    btn.setAttribute("aria-expanded", String(!collapsed));
    btn.title = collapsed ? "Развернуть панель" : "Свернуть панель";
  }
  if (body) {
    body.setAttribute("aria-hidden", String(!!collapsed));
    body.inert = !!collapsed;
  }
  if (save) {
    try { localStorage.setItem("ogranka.fullLiveCollapsed", collapsed ? "1" : "0"); } catch (e) { /* ignore */ }
  }
}

// ---------------------------------------------------------------- тема

const THEME_ORDER = ["system", "light", "dark"];
const THEME_LABELS = { system: "как в системе", light: "светлая", dark: "тёмная" };
const THEME_ICONS = { system: "#i-auto", light: "#i-sun", dark: "#i-moon" };
const darkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function themePreference() {
  try { return localStorage.getItem("ogranka.theme") || "system"; } catch (e) { return "system"; }
}

function applyTheme(pref = themePreference()) {
  const resolved = pref === "system" ? (darkQuery && !darkQuery.matches ? "light" : "dark") : pref;
  const root = document.documentElement;
  const changed = root.dataset.theme !== resolved;
  root.dataset.theme = resolved;
  root.dataset.themePref = pref;
  const btn = $("themeBtn");
  if (btn) {
    btn.title = "Тема: " + THEME_LABELS[pref] + " (клик — сменить)";
    const use = btn.querySelector("use");
    if (use) use.setAttribute("href", THEME_ICONS[pref]);
  }
  if (changed) App.viewers.forEach((v) => v.applyTheme());
}

function cycleTheme() {
  const next = THEME_ORDER[(THEME_ORDER.indexOf(themePreference()) + 1) % THEME_ORDER.length];
  try { localStorage.setItem("ogranka.theme", next); } catch (e) { /* ignore */ }
  applyTheme(next);
  $("statusText").textContent = "Тема: " + THEME_LABELS[next];
}

// ---------------------------------------------------------------- модальные окна

/* Фокус переходит в открытое окно и возвращается обратно при закрытии. */
function initModalFocus() {
  const lastFocus = new Map();
  const selector = "button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])";
  const inBody = selector.split(",").map((part) => ".modal-body " + part.trim()).join(", ");
  document.querySelectorAll(".modal").forEach((modal) => {
    let open = !modal.classList.contains("hidden");
    new MutationObserver(() => {
      const now = !modal.classList.contains("hidden");
      if (now === open) return;
      open = now;
      if (now) {
        lastFocus.set(modal, document.activeElement);
        const card = modal.querySelector(".modal-card");
        const target = card && (card.querySelector(inBody) || card.querySelector(selector));
        requestAnimationFrame(() => target && target.focus({ preventScroll: true }));
      } else {
        const prev = lastFocus.get(modal);
        if (prev && document.contains(prev) && typeof prev.focus === "function") prev.focus({ preventScroll: true });
      }
    }).observe(modal, { attributes: true, attributeFilter: ["class"] });
    modal.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const items = [...modal.querySelectorAll(selector)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  });
}

function startWelcomeTour() {
  if (tourSeen()) return;
  const begin = () => setTimeout(() => startTour(), 260);
  if (splashDone) { begin(); return; }
  window.addEventListener("ogranka:splash-done", begin, { once: true });
}

function init() {
  applyTheme();
  if (darkQuery) {
    const follow = () => { if (themePreference() === "system") applyTheme("system"); };
    if (darkQuery.addEventListener) darkQuery.addEventListener("change", follow);
    else if (darkQuery.addListener) darkQuery.addListener(follow);
  }
  initSplash();
  initModalFocus();
  initRestartToast();
  initShotEditor();
  $("shotBtn").onclick = () => {
    closeViewerShotMenus();
    startAppShot();
  };
  $("shotToggle").onclick = (event) => {
    event.stopPropagation();
    const menu = $("shotMenu");
    const open = !menu.classList.contains("open");
    closeViewerShotMenus(menu);
    menu.classList.toggle("open", open);
  };
  $("shotMenu").addEventListener("click", (event) => {
    const item = event.target.closest("[data-shot-target]");
    if (!item) return;
    event.stopPropagation();
    closeViewerShotMenus();
    if (item.dataset.shotTarget === "app") startAppShot();
    else startViewportShot(activeViewer());
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".vshot")) closeViewerShotMenus();
  });
  addViewer();
  addViewer();
  layoutViewers();
  updateViewButtons();
  updateSelectionActions();

  document.querySelectorAll(".demo").forEach((b) => b.onclick = () => {
    document.querySelectorAll(".demo").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    App.sources = [{ kind: "demo", name: b.dataset.demo }];
    App.liveSource = App.sources[0];
    $("fileName").textContent = "демо: " + b.textContent.toLowerCase();
    $("harm").value = 12;
  });

  $("fileInput").onchange = (e) => setFiles(e.target.files, false);
  $("dirBtn").onclick = chooseFolder;
  $("dirInput").onchange = (e) => setFiles(e.target.files, true);
  $("levelsBtn").onclick = async () => {
    const src = currentLiveSource();
    if (!src) { alert("У выбранной модели нет источника — выберите исходную модель"); return; }
    showProgress("6 уровней упрощения", "построение минимальных многогранников");
    try {
      const j = await apiPost("/api/levels", { source: src });
      await loadResults();
      let idx = App.models.findIndex((m) => m.id === j.id);
      if (idx < 0 && j.uid) idx = App.models.findIndex((m) => m.uid === j.uid);
      if (idx < 0) idx = App.models.findIndex((m) => m.name === j.name);
      if (idx < 0) throw new Error("модель уровней не появилась в списке моделей");
      App.modelIdx = idx;
      $("modelSel").value = String(idx);
      renderBatch();
      await renderModel();
      $("statusText").textContent = "6 уровней добавлены в список";
      hideProgress();
    } catch (e) {
      showProgressError(e.message);
    }
  };

  $("runBtn").onclick = run;
  $("liveNoise").oninput = scheduleLive;
  $("liveSimplify").oninput = scheduleLive;
  $("fullLiveNoise").oninput = () => { $("liveNoise").value = $("fullLiveNoise").value; scheduleLive(); };
  $("fullLiveSimplify").oninput = () => { $("liveSimplify").value = $("fullLiveSimplify").value; scheduleLive(); };
  const savedFullLive = (() => { try { return localStorage.getItem("ogranka.fullLiveCollapsed") === "1"; } catch (e) { return false; } })();
  setFullLiveCollapsed(savedFullLive, false);
  $("fullLiveToggle").onclick = () => setFullLiveCollapsed(!$("fullLive").classList.contains("collapsed"));
  ["mFft", "mUni", "mNone", "mode", "noiseModel", "harm", "win", "layers", "angles", "angleDeg", "lossPct"].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener("change", scheduleLive);
  });
  updateLiveLabels();
  $("modelSel").onchange = async () => { App.modelIdx = +$("modelSel").value; await renderModel(); };
  $("colorMode").onchange = () => setViewMode($("colorMode").value);
  $("addView").onclick = () => { addViewer(); App.viewers.forEach((v) => v.applySelection(App.sel)); };
  $("delView").onclick = () => removeViewer();
  $("syncCam").onchange = () => { App.syncCam = $("syncCam").checked; };
  $("selTarget").onchange = () => {
    App.selTarget = $("selTarget").value;
    App.viewers.forEach((v) => { v.selTarget = App.selTarget; v.rebuild(App.mode); });
    updateBoxHint();
    broadcastSelection();
  };
  $("boxSel").onclick = () => setBoxSelect(!App.boxSelect);
  $("selInvert").onclick = invertSelection;
  $("selGrow").onclick = () => growSelection(1);
  $("selShrink").onclick = () => growSelection(-1);
  $("selCopy").onclick = async () => {
    const text = $("selectionInfo").textContent;
    if (!text || text === "Выделение: —") return;
    try {
      await navigator.clipboard.writeText(text);
      $("statusText").textContent = "Сводка выделения скопирована";
    } catch (err) {
      download("ogranka-selection.txt", text);
      $("statusText").textContent = "Сводка сохранена в файл";
    }
  };
  $("themeBtn").onclick = cycleTheme;
  $("selAll").onclick = () => {
    const v = activeViewer() || App.viewers[0];
    if (!v || !v.mesh) return;
    const target = App.selTarget;
    const mode = (target === "vertex" || App.mode === "points") ? "vert" : target;
    loadSelBucket(mode);
    if (mode === "edge") {
      App.sel.points = v.edges.map((_, ei) => v.edgePoint(ei));
      App.sel.polys = [];
      App.sel.ids = v.edges.map((_, ei) => ({ viewer: v, type: "edge", index: ei }));
    } else if (mode === "section") {
      App.sel.points = v.sectionCentroid.map((c) => c.slice());
      App.sel.polys = [];
      App.sel.ids = v.sectionCentroid.map((_, si) => ({ viewer: v, type: "section", index: si }));
    } else if (mode === "vert") {
      App.sel.points = v.verts.map((p) => p.slice());
      App.sel.polys = [];
      App.sel.ids = v.verts.map((_, vi) => ({ viewer: v, type: "vert", index: vi }));
    } else {
      App.sel.points = v.faceCentroids.map((c) => c.slice());
      App.sel.polys = v.facePolys.map((poly) => poly.map((p) => p.slice()));
      App.sel.ids = v.faceCentroids.map((_, fi) => ({ viewer: v, type: "face", index: fi }));
    }
    App.sel.anchor = null;
    broadcastSelection();
  };
  $("selClear").onclick = clearSelection;
  $("isoSel").onchange = () => {
    App.isolate = $("isoSel").checked;
    App.viewers.forEach((v) => { v.isolate = App.isolate; v.rebuild(App.mode); });
    selectionText();
  };
  $("orthoSel").onchange = () => {
    App.ortho = $("orthoSel").checked;
    App.viewers.forEach((v) => v.setOrtho(App.ortho));
  };
  $("resetBtn").onclick = () => {
    const viewers = App.viewers.filter((v) => v.mesh);
    if (!viewers.length) return;
    if (App.resetTimer) clearTimeout(App.resetTimer);
    App.camLock = true;
    viewers.forEach((v) => v.resetView(v.mesh));
    App.resetTimer = setTimeout(() => {
      if (App.syncCam && App.viewers.length) {
        const source = App.viewers.find((v) => v.mesh) || App.viewers[0];
        App.viewers.forEach((v) => v.copyCamera(source));
      }
      App.camLock = false;
      App.resetTimer = null;
    }, 620);
  };
  $("objSelBtn").onclick = async () => {
    const v = activeViewer();
    if (!v || !v.mesh) return;
    const faces = [...(v.selFaces || [])];
    if (!faces.length) {
      $("statusText").textContent = "В активном окне нет выделенных граней";
      return;
    }
    const name = exportBase(v) + "-selection.obj";
    const text = toObj(v.mesh, faces.sort((a, b) => a - b));
    if (window.pywebview && window.pywebview.api && window.pywebview.api.save_obj) {
      const res = await window.pywebview.api.save_obj(text, name);
      if (res && res.path) {
        $("statusText").textContent = "OBJ выделения сохранён";
        $("statusText").title = res.path;
        return;
      }
      if (res && res.cancelled) return;
      if (res && res.error) { alert("Не удалось сохранить OBJ: " + res.error); return; }
    }
    download(name, text, "text/plain");
    $("statusText").textContent = "OBJ выделения скачан в загрузки";
  };
  $("objBtn").onclick = async () => {
    const v = activeViewer();
    if (!v || !v.mesh) { $("statusText").textContent = "Нет модели для OBJ"; return; }
    const name = exportBase(v) + ".obj";
    const text = toObj(v.mesh);
    if (window.pywebview && window.pywebview.api && window.pywebview.api.save_obj) {
      const res = await window.pywebview.api.save_obj(text, name);
      if (res && res.path) {
        $("statusText").textContent = "OBJ сохранён";
        $("statusText").title = res.path;
        return;
      }
      if (res && res.cancelled) return;
      if (res && res.error) { alert("Не удалось сохранить OBJ: " + res.error); return; }
    }
    download(name, text, "text/plain");
    $("statusText").textContent = "OBJ скачан в загрузки";
  };
  $("clearCache").onclick = async () => {
    if (!confirm("Удалить сохранённые результаты и загруженные файлы?")) return;
    try {
      await apiPost("/api/clear-cache", {});
    } catch (err) {
      alert("Не удалось очистить кеш: " + err.message);
      return;
    }
    App.models = []; App.meshes = {}; App.partialDone = 0;
    App.liveSource = null; App.runBaseCount = null;
    $("modelSel").innerHTML = "";
    $("batchTable").querySelector("tbody").innerHTML = "";
    $("metricsTable").querySelector("tbody").innerHTML = "";
    App.viewers.forEach((v) => { v.select.innerHTML = ""; v.meta.textContent = ""; v.setMesh(null, App.mode); });
    clearSelection();
    $("batchInfo").textContent = "кеш очищен · приветствие при следующем запуске";
    $("diffLine").textContent = "Сравнение: —";
    const status = $("statusText");
    status.textContent = "Готов к запуску";
    status.title = "";
    status.classList.remove("running");
    resetTourSeen();
    App.liveSeq++;
    clearTimeout(App.liveTimer);
  };
  $("csvLink").onclick = async (e) => {
    e.preventDefault();
    try {
      if (window.pywebview && window.pywebview.api && window.pywebview.api.save_csv) {
        const res = await window.pywebview.api.save_csv();
        if (res && res.path) { $("statusText").textContent = "CSV сохранён"; return; }
        if (res && res.cancelled) { $("statusText").textContent = "CSV не сохранён"; return; }
      }
      const r = await fetch("/api/export.csv");
      if (!r.ok) throw new Error("CSV недоступен");
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "metrics.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      $("statusText").textContent = "CSV скачан";
    } catch (err) {
      alert("Не удалось сохранить CSV: " + err.message);
    }
  };

  $("helpBtn").onclick = () => { $("aboutModal").classList.add("hidden"); $("helpModal").classList.remove("hidden"); };
  $("aboutBtn").onclick = () => { $("helpModal").classList.add("hidden"); $("aboutModal").classList.remove("hidden"); };
  $("tourBtn").onclick = () => { $("aboutModal").classList.add("hidden"); startTour(true); };
  $("checkUpdates").onclick = async () => {
    const info = await checkForUpdates(true);
    if (info && info.available) {
      $("aboutModal").classList.add("hidden");
      showUpdateModal(info);
    }
  };
  $("historyBtn").onclick = () => showChangelog(true);
  $("changelogBtn").onclick = () => {
    $("aboutModal").classList.add("hidden");
    showChangelog(true);
  };
  $("changelogClose").onclick = () => $("changelogModal").classList.add("hidden");
  $("changelogModal").onclick = (e) => { if (e.target.id === "changelogModal") $("changelogModal").classList.add("hidden"); };
  $("feedbackBtn").onclick = () => {
    $("aboutModal").classList.add("hidden");
    showFeedback();
  };
  $("feedbackClose").onclick = () => $("feedbackModal").classList.add("hidden");
  $("feedbackModal").onclick = (e) => { if (e.target.id === "feedbackModal") $("feedbackModal").classList.add("hidden"); };
  $("feedbackOpenBrowser").onclick = () => submitFeedback();
  document.querySelectorAll(".feedback-tab").forEach((button) => {
    button.onclick = () => switchFeedbackTab(button.dataset.feedbackTab);
  });
  $("githubIssuesRefresh").onclick = () => loadGithubIssues(true);
  $("githubIssuesList").addEventListener("click", (e) => {
    const link = e.target.closest("[data-github-url]");
    if (!link || !link.dataset.githubUrl) return;
    e.preventDefault();
    openExternal(link.dataset.githubUrl);
  });
  $("feedbackCopy").onclick = async () => {
    const data = composeFeedback();
    if (data.message.length < 3) {
      setFeedbackStatus("Напишите сообщение — хотя бы пару слов.", true);
      return;
    }
    try {
      await copyFeedback(data.title + "\n\n" + data.body);
      setFeedbackStatus("Текст скопирован.");
    } catch (error) {
      setFeedbackStatus("Не удалось скопировать текст.", true);
    }
  };
  $("changelogList").addEventListener("click", (e) => {
    const button = e.target.closest(".changelog-link");
    if (button && button.dataset.url) openExternal(button.dataset.url);
  });
  $("updateBtn").onclick = () => showUpdateModal(App.update);
  $("updateToastOpen").onclick = () => {
    hideUpdateToast();
    showUpdateModal(App.update);
  };
  $("updateToastClose").onclick = () => hideUpdateToast();
  $("updateClose").onclick = () => $("updateModal").classList.add("hidden");
  $("updateDownload").onclick = () => {
    if (App.update && App.update.installable) {
      installUpdate();
      return;
    }
    const url = App.update && (App.update.asset_url || App.update.url);
    if (url) openExternal(url);
  };
  $("updateRelease").onclick = () => {
    if (App.update && App.update.release_url) openExternal(App.update.release_url);
  };
  $("progressClose").onclick = () => hideProgress();
  $("helpClose").onclick = () => $("helpModal").classList.add("hidden");
  $("aboutClose").onclick = () => $("aboutModal").classList.add("hidden");
  $("helpModal").onclick = (e) => { if (e.target.id === "helpModal") $("helpModal").classList.add("hidden"); };
  $("aboutModal").onclick = (e) => { if (e.target.id === "aboutModal") $("aboutModal").classList.add("hidden"); };
  $("updateModal").onclick = (e) => { if (e.target.id === "updateModal") $("updateModal").classList.add("hidden"); };
  $("tourSkip").onclick = finishTour;
  $("tourPrev").onclick = tourPrev;
  $("tourNext").onclick = tourNext;
  window.addEventListener("resize", () => {
    if ($("tour").classList.contains("hidden")) return;
    const step = TOUR_STEPS[App.tourStep];
    positionTour(step && step.target ? document.querySelector(step.target) : null);
  });

  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (!$("shotLayer").classList.contains("hidden")) return;
    if (tag === "input" || tag === "select" || tag === "textarea" || e.target.isContentEditable) return;
    if (!$("tour").classList.contains("hidden")) {
      if (e.key === "Escape") {
        finishTour();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        tourNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        tourPrev();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      const modals = ["helpModal", "aboutModal", "changelogModal", "feedbackModal", "updateModal"];
      const hadModal = modals.some((id) => !$(id).classList.contains("hidden"));
      modals.forEach((id) => $(id).classList.add("hidden"));
      if (hadModal) return;
      if (App.boxSelect) setBoxSelect(false);
      if (App.fullscreen) {
        if (selectionTotal() > 0) {
          clearSelection();
          return;
        }
        toggleSolo(App.solo);
        return;
      }
      if (selectionTotal() > 0) clearSelection();
      return;
    }
    if (e.altKey && e.code === "KeyA") { e.preventDefault(); $("selClear").click(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const code = e.code || "";
    const k = code.startsWith("Key") ? code.slice(3).toLowerCase() : e.key.toLowerCase();
    const modes = ["solid_edges", "solid", "face", "area", "wire", "edges", "points"];
    const num = /^([1-7])$/.exec(e.key) || (!e.shiftKey && /^Digit([1-7])$/.exec(code));
    if (num) { setViewMode(modes[+num[1] - 1]); e.preventDefault(); return; }
    if (e.code === "BracketLeft" || e.code === "BracketRight") {
      e.preventDefault();
      if (e.shiftKey) { growSelection(e.code === "BracketRight" ? 1 : -1); return; }
      cycleViewerResult(e.code === "BracketRight" ? 1 : -1);
      return;
    }
    if (e.code === "Comma" || e.code === "Period") {
      e.preventDefault();
      cycleActiveModel(e.code === "Period" ? 1 : -1);
      return;
    }
    if (k === "r") { if (!$("runBtn").disabled) run(); }
    else if (k === "f") { if (App.solo) toggleSolo(App.solo); else if (App.viewers[0]) toggleSolo(App.viewers[0]); }
    else if (k === "v") {
      const s = $("selTarget");
      const order = ["face", "vertex", "edge", "section"];
      s.value = order[(order.indexOf(s.value) + 1) % order.length];
      s.dispatchEvent(new Event("change"));
    }
    else if (k === "b") { setBoxSelect(!App.boxSelect); }
    else if (k === "c") { const c = $("syncCam"); c.checked = !c.checked; c.dispatchEvent(new Event("change")); }
    else if (k === "a") { $("selAll").click(); }
    else if (k === "l") { const c = $("isoSel"); c.checked = !c.checked; c.dispatchEvent(new Event("change")); }
    else if (k === "p") { const c = $("orthoSel"); c.checked = !c.checked; c.dispatchEvent(new Event("change")); }
    else if (k === "g") { $("resetBtn").click(); }
    else if (e.shiftKey && k === "o") { $("objSelBtn").click(); }
    else if (k === "o") { $("objBtn").click(); }
    else if (e.shiftKey && k === "s") { startAppShot(); }
    else if (k === "s") { startViewportShot(activeViewer()); }
    else if (e.key === "?" || k === "h") { $("aboutModal").classList.add("hidden"); $("helpModal").classList.toggle("hidden"); }
    else if (e.shiftKey && k === "i") { invertSelection(); }
    else if (k === "i") { $("helpModal").classList.add("hidden"); $("aboutModal").classList.toggle("hidden"); }
    else if (e.key === "+" || e.key === "=") { $("addView").click(); }
    else if (e.key === "-" || e.key === "_") { $("delView").click(); }
  });

  $("hsplit").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    $("hsplit").setPointerCapture(e.pointerId);
    const ws = document.querySelector(".workspace");
    const startY = e.clientY;
    const startH = $("viewers").getBoundingClientRect().height;
    const move = (ev) => {
      const h = Math.min(ws.clientHeight - 170, Math.max(160, startH + ev.clientY - startY));
      document.documentElement.style.setProperty("--viewer-h", h + "px");
    };
    const up = () => {
      $("hsplit").removeEventListener("pointermove", move);
      $("hsplit").removeEventListener("pointerup", up);
    };
    $("hsplit").addEventListener("pointermove", move);
    $("hsplit").addEventListener("pointerup", up);
  });

  document.querySelector('.demo[data-demo="octa"]').classList.add("active");
  window.__app = App;
  fetch("/api/results").then((r) => r.json()).then((d) => {
    if (d.models && d.models.length) loadResults();
    else {
      $("statusText").textContent = "Готов к запуску";
      $("batchInfo").textContent = "прогонов пока нет";
    }
  });
  fetch("/api/welcome").then((r) => r.json()).then((j) => {
    if (j.seen) return;
    if (tourSeen()) { markTourSeen(); return; }
    startWelcomeTour();
  }).catch(() => startWelcomeTour());
  setTimeout(() => checkForUpdates(false), 1400);
}

window.addEventListener("DOMContentLoaded", init);
