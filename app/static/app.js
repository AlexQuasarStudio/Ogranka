/* Application orchestration: results, progress, run and init. */
function updateDiff() {
  const model = currentModel();
  if (!model || App.viewers.length < 2) return;
  const a = model.results.find((r) => r.id === App.viewers[0].select.value);
  const b = model.results.find((r) => r.id === App.viewers[1].select.value);
  if (!a || !b) return;
  const ma = a.metrics || {}, mb = b.metrics || {};
  const d = (x, y) => (x != null && y != null ? y - x : null);
  $("diffLine").textContent =
    `Сравнение: ${a.label} → ${b.label} · ΔMSE ${fmt(d(ma.mse, mb.mse))} · ` +
    `ΔRMSE ${fmt(d(ma.rmse, mb.rmse))} · Δdmax ${fmt(d(ma.dmax, mb.dmax))}`;
}

async function loadResults() {
  const prevName = App.models[App.modelIdx] ? App.models[App.modelIdx].name : null;
  const data = await (await fetch("/api/results")).json();
  App.models = data.models || [];
  App.meshes = {};
  $("modelSel").innerHTML = App.models.map((m, i) => `<option value="${i}">${m.name}</option>`).join("");
  const idx = prevName ? App.models.findIndex((m) => m.name === prevName) : -1;
  App.modelIdx = idx >= 0 ? idx : 0;
  $("modelSel").value = String(App.modelIdx);
  renderBatch();
  await renderModel();
}

async function renderModel() {
  const model = currentModel();
  if (!model) return;
  App.liveSource = sourceForModel(model);
  App.viewers.forEach((v, i) => populateViewer(v, i));
  renderTable(model.results);
  App.viewers.forEach((v) => { v.select.onchange = () => { setActiveViewer(v); loadViewer(v); }; });
  await loadAllViewers();
  $("batchInfo").textContent = `модель ${App.modelIdx + 1} из ${App.models.length}`;
}

function renderTable(results) {
  const tb = $("metricsTable").querySelector("tbody");
  tb.innerHTML = "";
  results.forEach((r) => {
    const tr = document.createElement("tr");
    const m = r.metrics || {};
    tr.className = r.mesh ? "" : "fail";
    tr.innerHTML = `<td>${r.label}</td><td>${badge(r.quality)}</td><td>${fmt(m.mse)}</td>
      <td>${fmt(m.rmse)}</td><td>${fmt(m.dmax)}</td><td>${r.vertices ?? "—"}</td>
      <td>${r.faces ?? "—"}</td><td>${r.points ?? "—"}</td>
      <td>${r.time != null ? r.time + " с" : "—"}</td>`;
    tr.onclick = async (e) => {
      const target = e.shiftKey ? App.viewers[0] : App.viewers[1];
      if (!target) return;
      setActiveViewer(target);
      target.select.value = r.id;
      await loadViewer(target);
    };
    tb.appendChild(tr);
  });
}

function renderBatch() {
  const tb = $("batchTable").querySelector("tbody");
  tb.innerHTML = "";
  App.models.forEach((model, i) => {
    const cand = model.results.filter((r) => r.mesh && !r.id.includes(":ref") && r.metrics && r.metrics.mse != null);
    cand.sort((a, b) => a.metrics.mse - b.metrics.mse);
    const best = cand[0];
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${model.name}</td><td>${best ? best.label : "—"}</td>
      <td>${best ? fmt(best.metrics.mse) : "—"}</td><td>${best ? fmt(best.metrics.rmse) : "—"}</td>
      <td>${best ? fmt(best.metrics.dmax) : "—"}</td><td>${best ? badge(best.quality) : ""}</td>
      <td>${best && best.time != null ? best.time + " с" : "—"}</td>`;
    tr.onclick = async () => {
      App.modelIdx = i;
      $("modelSel").value = String(i);
      await renderModel();
    };
    tb.appendChild(tr);
  });
}

// ---------------------------------------------------------------- запуск

function params() {
  const levels = [];
  if ($("noise8").checked) levels.push(0.008);
  if ($("noise80").checked) levels.push(0.08);
  if ($("noiseCustom").checked) {
    $("customNoise").value.split(",").forEach((t) => {
      const x = parseFloat(t.trim().replace(",", "."));
      if (isFinite(x) && x >= 0) levels.push(x);
    });
  }
  const methods = [];
  if ($("mFft").checked) methods.push("fft");
  if ($("mUni").checked) methods.push("uni");
  if ($("mNone").checked) methods.push("none");
  return {
    noise: levels, methods: methods.length ? methods : ["fft"],
    mode: $("mode").value, minimal: $("minimal").checked,
    layers: +$("layers").value, angles: +$("angles").value,
    harmonics: +$("harm").value, window: +$("win").value,
    loss: +$("lossPct").value, angle: +$("angleDeg").value,
  };
}

function updateProgress(st) {
  if (!st) return;
  const p = Math.max(0, Math.min(100, Math.round((st.progress || 0) * 100)));
  $("barFill").style.width = p + "%";
  $("progressPct").textContent = p + "%";
  $("progressText").textContent = st.stage || "…";
  const bits = [];
  if (st.detail) bits.push(st.detail);
  if (st.models > 1) bits.push(`модель ${st.model || 1}/${st.models}`);
  if (st.total) bits.push(`вариант ${Math.min(st.done || 0, st.total)}/${st.total}`);
  $("progressDetail").textContent = bits.join(" · ") || "—";
  let elapsed = st.elapsed || 0;
  if (st.state === "running" && st.started) elapsed = Math.max(elapsed, Date.now() / 1000 - st.started);
  let eta = st.eta;
  if (st.state === "running" && eta == null && p > 2 && p < 100) eta = elapsed * (100 - p) / p;
  const parts = [];
  if (elapsed >= 1) parts.push(`прошло ${fmtDur(elapsed)}`);
  if (st.state === "running" && eta) parts.push(`осталось ~${fmtDur(eta)}`);
  $("progressTime").textContent = parts.join(" · ");
  const busy = App.uploading || (st.state === "running" && (st.progress || 0) < 0.30);
  $("loadOverlay").classList.toggle("hidden", !busy);
  if (busy) {
    $("loadTitle").textContent = st.stage || "Загрузка модели…";
    $("loadSub").textContent = st.detail || "";
  }
}

function showProgress(stage, detail) {
  clearTimeout(App.hideTimer);
  $("progress").classList.remove("hidden", "error");
  $("progressClose").classList.add("hidden");
  document.body.classList.add("progress-on");
  updateProgress({ state: "running", stage: stage || "Запуск", detail: detail || "",
                   progress: 0, eta: null, started: Date.now() / 1000 });
}

function hideProgress() {
  clearTimeout(App.hideTimer);
  $("progress").classList.add("hidden");
  $("loadOverlay").classList.add("hidden");
  $("statusText").classList.remove("running");
  document.body.classList.remove("progress-on");
}

function showProgressError(msg) {
  clearTimeout(App.hideTimer);
  if (App.poll) clearInterval(App.poll);
  if (App.tick) clearInterval(App.tick);
  $("progress").classList.remove("hidden");
  $("progress").classList.add("error");
  $("progressClose").classList.remove("hidden");
  $("loadOverlay").classList.add("hidden");
  $("statusText").classList.remove("running");
  document.body.classList.add("progress-on");
  $("progressText").textContent = "Ошибка";
  $("progressPct").textContent = "";
  $("progressDetail").textContent = msg || "неизвестная ошибка";
  $("progressTime").textContent = "";
  $("statusText").textContent = "Ошибка";
  $("runBtn").disabled = false;
}

function uploadFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.setRequestHeader("X-Filename", file.name);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) onProgress(ev.loaded / ev.total);
    };
    xhr.onload = () => {
      let j = {};
      try { j = JSON.parse(xhr.responseText || "{}"); } catch (e) {}
      if (xhr.status >= 200 && xhr.status < 300) resolve({ kind: "file", path: j.path, name: j.name });
      else reject(new Error(j.error || "ошибка загрузки"));
    };
    xhr.onerror = () => reject(new Error("сеть недоступна"));
    xhr.send(file);
  });
}

async function setFiles(fileList, folder) {
  const files = [...fileList].filter((f) => /\.(obj|txt)$/i.test(f.name));
  if (!files.length) { alert("Нужны файлы .obj или .txt"); return; }
  const sources = [];
  const started = Date.now() / 1000;
  App.uploading = true;
  showProgress(`Загрузка файлов 0/${files.length}`, folder ? "папка" : "файлы");
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    try {
      const src = await uploadFile(f, (frac) => {
        updateProgress({ state: "running", stage: `Загрузка ${i + 1}/${files.length}`,
                         detail: f.name, progress: (i + frac) / files.length,
                         started, eta: null });
      });
      sources.push(src);
      updateProgress({ state: "running", stage: `Загрузка ${i + 1}/${files.length}`,
                       detail: f.name, progress: (i + 1) / files.length,
                       started, eta: null });
    } catch (e) { console.warn(e); }
  }
  if (!sources.length) { App.uploading = false; showProgressError("Не удалось загрузить файлы"); return; }
  App.uploading = false;
  App.sources = sources;
  App.liveSource = sources[0];
  $("fileName").textContent = (folder ? "папка: " : "файлы: ") + sources.length;
  $("harm").value = 32;
  document.querySelectorAll(".demo").forEach((x) => x.classList.remove("active"));
  $("progressText").textContent = "Файлы загружены";
  $("progressPct").textContent = "100%";
  $("barFill").style.width = "100%";
  $("progressDetail").textContent = `${sources.length} файл(ов)`;
  $("loadOverlay").classList.add("hidden");
  App.hideTimer = setTimeout(hideProgress, 1200);
}

async function run() {
  $("runBtn").disabled = true;
  App.liveSeq++;
  clearTimeout(App.liveTimer);
  $("liveHint").textContent = "Конвейер выполняется…";
  App.uploading = false;
  App.meshes = {};
  App.partialDone = 0;
  App.lastProgress = null;
  showProgress("Отправка задания", "подготовка параметров");
  $("statusText").textContent = "Выполняется";
  $("statusText").classList.add("running");
  try {
    const r = await fetch("/api/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: App.sources, params: params() }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "не удалось запустить");
    poll();
  } catch (e) {
    showProgressError(e.message);
  }
}

function poll() {
  clearInterval(App.poll);
  if (App.tick) clearInterval(App.tick);
  App.pollBusy = false;
  App.lastProgress = null;
  App.tick = setInterval(() => {
    if (App.lastProgress && App.lastProgress.state === "running") updateProgress(App.lastProgress);
  }, 250);
  App.poll = setInterval(async () => {
    if (App.pollBusy) return;
    App.pollBusy = true;
    try {
      const st = await (await fetch("/api/status")).json();
      App.lastProgress = st;
      updateProgress(st);
      $("statusText").textContent = st.state === "running" ? "Выполняется"
        : st.state === "done" ? (st.elapsed ? `Готово · ${fmtDur(st.elapsed)}` : "Готово")
        : st.state || "";
      $("statusText").classList.toggle("running", st.state === "running");
      if (st.state === "running" && st.done && st.done !== App.partialDone) {
        App.partialDone = st.done;
        const data = await (await fetch("/api/results")).json();
        if (data.models && data.models.length) {
          App.models = data.models;
          renderBatch();
          if (currentModel()) renderTable(currentModel().results);
        }
      }
      if (st.state === "done") {
        clearInterval(App.poll);
        if (App.tick) clearInterval(App.tick);
        updateProgress({ ...st, state: "done", progress: 1 });
        $("progressText").textContent = "Готово";
        $("progressDetail").textContent = st.elapsed ? `обработано за ${fmtDur(st.elapsed)}` : "";
        $("progressTime").textContent = "";
        $("runBtn").disabled = false;
        App.hideTimer = setTimeout(hideProgress, 2500);
        await loadResults();
      } else if (st.state === "error") {
        showProgressError(st.error || "неизвестная ошибка");
      }
    } catch (e) {
      // временная ошибка сети: оставляем последний прогресс
    } finally {
      App.pollBusy = false;
    }
  }, 500);
}

function init() {
  addViewer();
  addViewer();
  layoutViewers();

  document.querySelectorAll(".demo").forEach((b) => b.onclick = () => {
    document.querySelectorAll(".demo").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    App.sources = [{ kind: "demo", name: b.dataset.demo }];
    App.liveSource = App.sources[0];
    $("fileName").textContent = "демо: " + b.textContent.toLowerCase();
    $("harm").value = 12;
  });

  $("fileInput").onchange = (e) => setFiles(e.target.files, false);
  $("dirInput").onchange = (e) => setFiles(e.target.files, true);
  $("levelsBtn").onclick = async () => {
    const src = currentLiveSource();
    if (!src) { alert("Сначала выберите модель"); return; }
    showProgress("6 уровней упрощения", "построение минимальных многогранников");
    try {
      const r = await fetch("/api/levels", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: src }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "не удалось построить уровни");
      await loadResults();
      const idx = App.models.findIndex((m) => m.name === j.name);
      if (idx >= 0) { App.modelIdx = idx; $("modelSel").value = String(idx); await renderModel(); }
      $("statusText").textContent = "6 уровней готовы";
      hideProgress();
    } catch (e) {
      showProgressError(e.message);
    }
  };

  $("runBtn").onclick = run;
  $("liveNoise").oninput = scheduleLive;
  $("liveSimplify").oninput = scheduleLive;
  ["mFft", "mUni", "mNone", "mode", "harm", "win", "layers", "angles", "angleDeg", "lossPct"].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener("change", scheduleLive);
  });
  updateLiveLabels();
  $("modelSel").onchange = async () => { App.modelIdx = +$("modelSel").value; await renderModel(); };
  $("colorMode").onchange = () => setViewMode($("colorMode").value);
  $("addView").onclick = () => { addViewer(); App.viewers.forEach((v) => v.applySelection(App.sel.points, App.sel.mode, App.sel.polys, App.sel.ids)); };
  $("delView").onclick = () => removeViewer();
  $("syncCam").onchange = () => { App.syncCam = $("syncCam").checked; };
  $("selTarget").onchange = () => {
    App.selTarget = $("selTarget").value;
    App.sel.points = [];
    App.sel.polys = [];
    App.sel.ids = [];
    App.sel.anchor = null;
    App.viewers.forEach((v) => { v.selTarget = App.selTarget; v.rebuild(App.mode); });
    broadcastSelection();
  };
  $("selAll").onclick = () => {
    const v = App.viewers[0];
    if (!v || !v.mesh) return;
    App.sel.mode = App.mode === "points" ? "vert" : "face";
    App.sel.points = App.sel.mode === "face" ? v.faceCentroids.map((c) => c.slice()) : v.verts.map((p) => p.slice());
    App.sel.polys = App.sel.mode === "face" ? v.facePolys.map((poly) => poly.map((p) => p.slice())) : [];
    App.sel.ids = [];
    App.sel.anchor = null;
    broadcastSelection();
  };
  $("selClear").onclick = () => { App.sel.points = []; App.sel.polys = []; App.sel.ids = []; App.sel.anchor = null; broadcastSelection(); };
  $("resetBtn").onclick = () => {
    App.viewers.forEach((v) => v.mesh && v.frame(v.mesh));
    if (App.syncCam && App.viewers.length) { App.camLock = true; App.viewers.forEach((v) => v.copyCamera(App.viewers[0])); App.camLock = false; }
  };
  $("objBtn").onclick = async () => {
    const v = App.viewers[1] || App.viewers[0];
    if (!v) return;
    const r = await meshOf(v.select.value);
    if (r.mesh) download("model.obj", toObj(r.mesh));
  };
  $("clearCache").onclick = async () => {
    if (!confirm("Удалить сохранённые результаты и загруженные файлы?")) return;
    await fetch("/api/clear-cache", { method: "POST" });
    App.models = []; App.meshes = {}; App.partialDone = 0; App.liveSource = null;
    $("modelSel").innerHTML = "";
    $("batchTable").querySelector("tbody").innerHTML = "";
    $("metricsTable").querySelector("tbody").innerHTML = "";
    App.viewers.forEach((v) => { v.select.innerHTML = ""; v.meta.textContent = ""; v.setMesh(null, App.mode); });
    $("batchInfo").textContent = "кеш очищен";
    $("diffLine").textContent = "Сравнение: —";
    $("selectionInfo").textContent = "Выделение: —";
    resetTourSeen();
    App.liveSeq++;
    clearTimeout(App.liveTimer);
    startTour(true);
  };
  $("pngBtn").onclick = () => {
    const v = App.viewers[1] || App.viewers[0];
    if (!v) return;
    const a = document.createElement("a");
    a.href = v.renderer.domElement.toDataURL("image/png");
    a.download = "view.png";
    a.click();
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
  $("progressClose").onclick = () => hideProgress();
  $("helpClose").onclick = () => $("helpModal").classList.add("hidden");
  $("aboutClose").onclick = () => $("aboutModal").classList.add("hidden");
  $("helpModal").onclick = (e) => { if (e.target.id === "helpModal") $("helpModal").classList.add("hidden"); };
  $("aboutModal").onclick = (e) => { if (e.target.id === "aboutModal") $("aboutModal").classList.add("hidden"); };
  $("tourSkip").onclick = finishTour;
  $("tourPrev").onclick = () => { if (App.tourStep > 0) showTourStep(App.tourStep - 1); };
  $("tourNext").onclick = () => {
    if (App.tourStep >= TOUR_STEPS.length - 1) finishTour();
    else showTourStep(App.tourStep + 1);
  };
  window.addEventListener("resize", () => {
    if ($("tour").classList.contains("hidden")) return;
    const step = TOUR_STEPS[App.tourStep];
    positionTour(step && step.target ? document.querySelector(step.target) : null);
  });

  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea" || e.target.isContentEditable) return;
    if (!$("tour").classList.contains("hidden")) {
      if (e.key === "Escape") finishTour();
      return;
    }
    if (e.key === "Escape") {
      $("helpModal").classList.add("hidden");
      $("aboutModal").classList.add("hidden");
      if (App.solo) toggleSolo(App.solo);
      return;
    }
    if (e.altKey && e.code === "KeyA") { e.preventDefault(); $("selClear").click(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const modes = ["solid_edges", "solid", "face", "area", "wire", "edges", "points"];
    if (/^[1-7]$/.test(e.key)) { setViewMode(modes[+e.key - 1]); e.preventDefault(); return; }
    if (e.code === "BracketLeft" || e.code === "BracketRight") {
      e.preventDefault();
      cycleViewerResult(e.code === "BracketRight" ? 1 : -1);
      return;
    }
    if (k === "r") { if (!$("runBtn").disabled) run(); }
    else if (k === "f") { if (App.solo) toggleSolo(App.solo); else if (App.viewers[0]) toggleSolo(App.viewers[0]); }
    else if (k === "v") { const s = $("selTarget"); s.value = s.value === "face" ? "vertex" : "face"; s.dispatchEvent(new Event("change")); }
    else if (k === "c") { const c = $("syncCam"); c.checked = !c.checked; c.dispatchEvent(new Event("change")); }
    else if (k === "a") { $("selAll").click(); }
    else if (k === "g") { $("resetBtn").click(); }
    else if (k === "o") { $("objBtn").click(); }
    else if (k === "s") { $("pngBtn").click(); }
    else if (e.key === "?" || k === "h") { $("aboutModal").classList.add("hidden"); $("helpModal").classList.toggle("hidden"); }
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
    else run();
  });
  if (!tourSeen()) setTimeout(() => startTour(), 900);
}

window.addEventListener("DOMContentLoaded", init);
