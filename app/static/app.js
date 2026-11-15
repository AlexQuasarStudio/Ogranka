/* Application orchestration: results, progress, run and init. */
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
  const minMs = 1250;
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

function startWelcomeTour() {
  if (tourSeen()) return;
  const begin = () => setTimeout(() => startTour(), 260);
  if (splashDone) { begin(); return; }
  window.addEventListener("ogranka:splash-done", begin, { once: true });
}

function updateDiff() {
  const model = currentModel();
  if (!model || App.viewers.length < 2) {
    $("diffLine").textContent = "Сравнение: —";
    return;
  }
  const a = model.results.find((r) => r.id === App.viewers[0].select.value);
  const b = model.results.find((r) => r.id === App.viewers[1].select.value);
  if (!a || !b) return;
  const ma = a.metrics || {}, mb = b.metrics || {};
  const d = (x, y) => (x != null && y != null ? y - x : null);
  $("diffLine").textContent =
    `Сравнение: ${a.label} → ${b.label} · ΔMSE ${fmt(d(ma.mse, mb.mse))} · ` +
    `ΔRMSE ${fmt(d(ma.rmse, mb.rmse))} · Δdmax ${fmt(d(ma.dmax, mb.dmax))}`;
}

function modelLabels() {
  const counts = {};
  App.models.forEach((m) => { counts[m.name] = (counts[m.name] || 0) + 1; });
  return App.models.map((m) => (m.run_label && counts[m.name] > 1
    ? `${m.name} · ${m.run_label}`
    : m.name));
}

async function loadResults(selectNew = false) {
  const prev = App.models[App.modelIdx] || null;
  const data = await (await fetch("/api/results")).json();
  App.models = data.models || [];
  App.meshes = {};
  const labels = modelLabels();
  $("modelSel").innerHTML = App.models.map((m, i) => `<option value="${i}">${escapeHtml(labels[i])}</option>`).join("");
  let idx = -1;
  if (selectNew && App.runBaseCount != null) idx = App.runBaseCount;
  if (idx < 0 || idx >= App.models.length) {
    if (prev && prev.uid) idx = App.models.findIndex((m) => m.uid === prev.uid);
    if (idx < 0 && prev) idx = App.models.findIndex((m) => m.name === prev.name);
  }
  if (idx < 0) idx = 0;
  App.modelIdx = idx;
  $("modelSel").value = String(App.modelIdx);
  if (selectNew) App.runBaseCount = null;
  renderBatch();
  await renderModel();
}

async function renderModel() {
  const model = currentModel();
  if (!model) return;
  App.liveSource = sourceForModel(model);
  App.viewers.forEach((v, i) => {
    v.modelIdx = App.modelIdx;
    populateViewer(v, i);
  });
  renderTable(model.results);
  App.viewers.forEach((v) => { v.select.onchange = () => { setActiveViewer(v); loadViewer(v); }; });
  await loadAllViewers();
  updateBatchInfo();
}

function updateBatchInfo() {
  if (!App.models.length) {
    $("batchInfo").textContent = "прогонов пока нет";
    return;
  }
  const total = App.lastElapsed ? ` · всего ${fmtDur(App.lastElapsed)}` : "";
  const v = activeViewer();
  const active = App.viewers.length > 1 && v ? ` · окно ${App.viewers.indexOf(v) + 1}` : "";
  $("batchInfo").textContent = `модель ${App.modelIdx + 1} из ${App.models.length}${active}${total}`;
}

function syncPrimaryFromViewer(v) {
  if (!v || !App.models.length) return;
  if (!Number.isInteger(v.modelIdx) || !App.models[v.modelIdx]) return;
  App.modelIdx = v.modelIdx;
  const model = App.models[App.modelIdx];
  App.liveSource = sourceForModel(model);
  const sel = $("modelSel");
  if (sel) sel.value = String(App.modelIdx);
  if ($("metricsTable")) renderTable(model.results);
  updateBatchInfo();
}

async function setActiveViewerModel(idx) {
  if (!App.models[idx]) return;
  const v = activeViewer();
  if (!v) return;
  v.modelIdx = idx;
  populateViewer(v, App.viewers.indexOf(v));
  setActiveViewer(v);
  syncPrimaryFromViewer(v);
  await loadViewer(v);
}

async function cycleActiveModel(delta) {
  if (App.models.length < 2) return;
  const v = activeViewer();
  const cur = v && Number.isInteger(v.modelIdx) ? v.modelIdx : App.modelIdx;
  const next = (cur + delta + App.models.length) % App.models.length;
  await setActiveViewerModel(next);
}

function renderTable(results) {
  const tb = $("metricsTable").querySelector("tbody");
  tb.innerHTML = "";
  orderedResults(results).forEach((r) => {
    const tr = document.createElement("tr");
    const m = r.metrics || {};
    tr.className = hasMesh(r) ? "" : "fail";
    tr.innerHTML = `<td>${escapeHtml(r.label)}</td><td>${badge(r.quality)}</td><td>${fmt(m.mse)}</td>
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
  const labels = modelLabels();
  App.models.forEach((model, i) => {
    const cand = model.results.filter((r) => hasMesh(r) && !r.id.includes(":ref") && r.metrics && r.metrics.mse != null);
    cand.sort((a, b) => a.metrics.mse - b.metrics.mse);
    const best = cand[0];
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(labels[i])}</td><td>${best ? escapeHtml(best.label) : "—"}</td>
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
    noise_model: $("noiseModel").value,
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
  App.poll = null;
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

function setFolderSources(sources) {
  App.uploading = false;
  App.sources = sources;
  App.liveSource = sources[0];
  $("fileName").textContent = `папка: ${sources.length}`;
  $("harm").value = 32;
  document.querySelectorAll(".demo").forEach((x) => x.classList.remove("active"));
  $("statusText").textContent = "Папка выбрана";
  hideProgress();
}

async function loadFolder(path) {
  showProgress("Сканирование папки", path);
  try {
    const r = await fetch("/api/folder", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "не удалось прочитать папку");
    if (!j.sources || !j.sources.length) throw new Error("в папке нет файлов .obj или .txt");
    setFolderSources(j.sources);
  } catch (e) {
    showProgressError(e.message);
  }
}

async function chooseFolder() {
  const api = window.pywebview && window.pywebview.api;
  if (api && typeof api.pick_folder === "function") {
    try {
      const res = await api.pick_folder();
      if (!res || res.cancelled) return;
      if (res.error) { alert("Не удалось выбрать папку: " + res.error); return; }
      if (res.path) await loadFolder(res.path);
    } catch (e) {
      alert("Не удалось выбрать папку: " + e.message);
    }
    return;
  }
  $("dirInput").click();
}

async function run() {
  $("runBtn").disabled = true;
  App.liveSeq++;
  App.lastElapsed = 0;
  clearTimeout(App.liveTimer);
  setLiveHint("Конвейер выполняется…");
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
    App.runBaseCount = App.models.length;
    poll();
  } catch (e) {
    showProgressError(e.message);
  }
}

function poll() {
  clearInterval(App.poll);
  App.poll = null;
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
      if (st.state === "done") App.lastElapsed = st.elapsed || 0;
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
        App.poll = null;
        if (App.tick) clearInterval(App.tick);
        updateProgress({ ...st, state: "done", progress: 1 });
        $("progressText").textContent = "Готово";
        $("progressDetail").textContent = st.elapsed ? `обработано за ${fmtDur(st.elapsed)}` : "";
        $("progressTime").textContent = "";
        $("runBtn").disabled = false;
        App.hideTimer = setTimeout(hideProgress, 2500);
        await loadResults(true);
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

async function openExternal(url) {
  if (!url) return;
  try {
    if (window.pywebview?.api?.open_url) {
      await window.pywebview.api.open_url(url);
      return;
    }
  } catch (error) {
  }
  window.open(url, "_blank", "noopener");
}

function renderReleaseInline(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  return html;
}

function renderPatchNotes(text, truncated) {
  const source = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!source) return '<p class="update-empty">В описании релиза пока нет подробностей.</p>';
  const lines = source.split("\n");
  let html = "";
  let list = null;
  let paragraph = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    html += "<p>" + paragraph.map(renderReleaseInline).join("<br>") + "</p>";
    paragraph = [];
  };
  const closeList = () => {
    if (!list) return;
    html += "</" + list + ">";
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      closeList();
      continue;
    }
    if (/^-{3,}$/.test(line)) {
      flushParagraph();
      closeList();
      html += "<hr>";
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const tag = heading[1].length === 1 ? "h3" : "h4";
      html += "<" + tag + ">" + renderReleaseInline(heading[2]) + "</" + tag + ">";
      continue;
    }
    if (/^[-*+]\s+/.test(line)) {
      flushParagraph();
      if (list !== "ul") {
        closeList();
        html += "<ul>";
        list = "ul";
      }
      html += "<li>" + renderReleaseInline(line.replace(/^[-*+]\s+/, "")) + "</li>";
      continue;
    }
    if (/^\d+[.)]\s+/.test(line)) {
      flushParagraph();
      if (list !== "ol") {
        closeList();
        html += "<ol>";
        list = "ol";
      }
      html += "<li>" + renderReleaseInline(line.replace(/^\d+[.)]\s+/, "")) + "</li>";
      continue;
    }
    closeList();
    paragraph.push(line);
  }
  flushParagraph();
  closeList();
  if (truncated) html += '<p class="update-truncated">Показаны первые 12 000 символов описания.</p>';
  return html;
}

function formatReleaseDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric", month: "long", year: "numeric",
  }).format(date);
}

function showUpdateModal(info) {
  if (!info || !info.available) return;
  const version = info.version || info.tag || "";
  $("updateTitle").textContent = version ? "Что нового в " + version : "Что нового";
  const date = formatReleaseDate(info.published_at);
  $("updateMeta").textContent = date ? "Опубликовано " + date : "Новая версия";
  $("updateNotes").innerHTML = renderPatchNotes(info.notes, info.notes_truncated);
  const download = $("updateDownload");
  download.textContent = info.asset ? "Скачать обновление" : "Открыть страницу релиза";
  download.disabled = !info.url;
  download.title = info.asset || "Страница релиза";
  const release = $("updateRelease");
  release.classList.toggle("hidden", !info.release_url || info.release_url === info.url);
  $("updateModal").classList.remove("hidden");
}

async function checkForUpdates(force = false) {
  const button = $("updateBtn");
  const state = $("updateState");
  if (force && state) {
    state.className = "update-state";
    state.textContent = "Проверяю обновления…";
  }
  try {
    const response = await fetch("/api/update" + (force ? "?force=1" : ""));
    if (!response.ok) throw new Error("update unavailable");
    const info = await response.json();
    App.update = info;
    if (button) {
      if (info.available) {
        button.textContent = "Обновление " + info.version;
        button.title = "Что нового в " + info.version;
        button.classList.remove("hidden");
      } else {
        button.classList.add("hidden");
      }
    }
    if (force && state) {
      if (info.available) {
        state.className = "update-state good";
        state.textContent = "Доступна версия " + info.version + ".";
      } else if (info.checked) {
        state.className = "update-state";
        state.textContent = "Обновлений нет — установлена последняя версия (" + info.current + ").";
      } else {
        state.className = "update-state warn";
        state.textContent = "Не удалось проверить обновления. Попробуйте позже.";
      }
    }
    return info;
  } catch (error) {
    if (force && state) {
      state.className = "update-state warn";
      state.textContent = "Не удалось проверить обновления. Проверьте подключение.";
    }
    return null;
  }
}

function init() {
  initSplash();
  addViewer();
  addViewer();
  layoutViewers();
  updateViewButtons();

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
      const r = await fetch("/api/levels", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: src }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "не удалось построить уровни");
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
  $("addView").onclick = () => { addViewer(); App.viewers.forEach((v) => v.applySelection(App.sel.points, App.sel.mode, App.sel.polys, App.sel.ids)); };
  $("delView").onclick = () => removeViewer();
  $("syncCam").onchange = () => { App.syncCam = $("syncCam").checked; };
  $("selTarget").onchange = () => {
    App.selTarget = $("selTarget").value;
    App.viewers.forEach((v) => { v.selTarget = App.selTarget; v.rebuild(App.mode); });
    broadcastSelection();
  };
  $("selAll").onclick = () => {
    const v = App.viewers[0];
    if (!v || !v.mesh) return;
    const target = App.selTarget;
    if (target === "edge") {
      App.sel.mode = "edge";
      App.sel.points = v.edges.map((_, ei) => v.edgePoint(ei));
      App.sel.polys = [];
    } else if (target === "section") {
      App.sel.mode = "section";
      App.sel.points = v.sectionCentroid.map((c) => c.slice());
      App.sel.polys = [];
    } else if (target === "vertex" || App.mode === "points") {
      App.sel.mode = "vert";
      App.sel.points = v.verts.map((p) => p.slice());
      App.sel.polys = [];
    } else {
      App.sel.mode = "face";
      App.sel.points = v.faceCentroids.map((c) => c.slice());
      App.sel.polys = v.facePolys.map((poly) => poly.map((p) => p.slice()));
    }
    App.sel.ids = [];
    App.sel.anchor = null;
    broadcastSelection();
  };
  $("selClear").onclick = () => { App.sel.points = []; App.sel.polys = []; App.sel.ids = []; App.sel.anchor = null; broadcastSelection(); };
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
    App.viewers.forEach((v) => v.mesh && v.frame(v.mesh));
    if (App.syncCam && App.viewers.length) { App.camLock = true; App.viewers.forEach((v) => v.copyCamera(App.viewers[0])); App.camLock = false; }
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
    await fetch("/api/clear-cache", { method: "POST" });
    App.models = []; App.meshes = {}; App.partialDone = 0;
    App.liveSource = null; App.runBaseCount = null;
    $("modelSel").innerHTML = "";
    $("batchTable").querySelector("tbody").innerHTML = "";
    $("metricsTable").querySelector("tbody").innerHTML = "";
    App.viewers.forEach((v) => { v.select.innerHTML = ""; v.meta.textContent = ""; v.setMesh(null, App.mode); });
    $("batchInfo").textContent = "кеш очищен · приветствие при следующем запуске";
    $("diffLine").textContent = "Сравнение: —";
    $("selectionInfo").textContent = "Выделение: —";
    resetTourSeen();
    App.liveSeq++;
    clearTimeout(App.liveTimer);
  };
  $("pngBtn").onclick = async () => {
    const v = activeViewer();
    if (!v || !v.renderer) return;
    const name = exportBase(v) + ".png";
    const dataUrl = v.renderer.domElement.toDataURL("image/png");
    if (window.pywebview && window.pywebview.api && window.pywebview.api.save_png) {
      const res = await window.pywebview.api.save_png(dataUrl, name);
      if (res && res.path) {
        $("statusText").textContent = "PNG сохранён";
        $("statusText").title = res.path;
        return;
      }
      if (res && res.cancelled) return;
      if (res && res.error) { alert("Не удалось сохранить PNG: " + res.error); return; }
    }
    downloadDataUrl(name, dataUrl);
    $("statusText").textContent = "PNG скачан в загрузки";
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
  $("updateBtn").onclick = () => showUpdateModal(App.update);
  $("updateClose").onclick = () => $("updateModal").classList.add("hidden");
  $("updateDownload").onclick = () => {
    if (App.update && App.update.url) openExternal(App.update.url);
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
    const code = e.code || "";
    const k = code.startsWith("Key") ? code.slice(3).toLowerCase() : e.key.toLowerCase();
    const modes = ["solid_edges", "solid", "face", "area", "wire", "edges", "points"];
    const num = /^([1-7])$/.exec(e.key) || (!e.shiftKey && /^Digit([1-7])$/.exec(code));
    if (num) { setViewMode(modes[+num[1] - 1]); e.preventDefault(); return; }
    if (e.code === "BracketLeft" || e.code === "BracketRight") {
      e.preventDefault();
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
    else if (k === "c") { const c = $("syncCam"); c.checked = !c.checked; c.dispatchEvent(new Event("change")); }
    else if (k === "a") { $("selAll").click(); }
    else if (k === "l") { const c = $("isoSel"); c.checked = !c.checked; c.dispatchEvent(new Event("change")); }
    else if (k === "p") { const c = $("orthoSel"); c.checked = !c.checked; c.dispatchEvent(new Event("change")); }
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
