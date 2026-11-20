/* Application orchestration: results, progress, run and init. */
let splashDone = false;
const GITHUB_REPO = "AlexQuasarStudio/Ogranka";

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
    const cand = model.results.filter((r) => hasMesh(r) && !r.id.includes(":ref") && r.metrics && r.metrics.mse != null && isSmoothedResult(r));
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
  const source = String(text || "").replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->/g, "").trim();
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

function isBuildUpdate(info) {
  if (!info) return false;
  if (info.update_kind) return info.update_kind === "build";
  return !!info.version && info.version === info.current;
}

function updateHeadline(info) {
  return "Доступно обновление";
}

function setUpdateInstall(state) {
  const text = $("updateInstallState");
  const bar = $("updateProgress");
  const fill = $("updateProgressFill");
  if (!text || !bar || !fill) return;
  const current = state || {};
  const progress = Math.max(0, Math.min(1, Number(current.progress) || 0));
  const active = ["downloading", "verifying", "installing", "restarting"].includes(current.state);
  bar.classList.toggle("hidden", !active);
  fill.style.width = Math.round(progress * 100) + "%";
  text.classList.toggle("error", current.state === "error");
  text.classList.toggle("busy", active);
  text.setAttribute("aria-busy", String(active));
  if (current.state === "error") {
    text.textContent = current.error || "Не удалось установить обновление.";
  } else if (current.detail) {
    text.textContent = current.detail;
  } else if (current.state === "restarting") {
    text.textContent = "Обновление установлено. Перезапускаю приложение…";
  } else if (current.state && current.state !== "idle") {
    text.textContent = "Подготовка…";
  } else {
    text.textContent = "";
  }
}

function showUpdateModal(info) {
  if (!info || !info.available) return;
  $("changelogModal").classList.add("hidden");
  const version = info.version || info.tag || "";
  const buildOnly = isBuildUpdate(info);
  $("updateTitle").textContent = updateHeadline(info);
  const date = formatReleaseDate(info.published_at);
  const meta = [];
  if (!buildOnly && version) meta.push("версия " + version);
  if (!buildOnly && info.build) meta.push("сборка " + info.build);
  if (date) meta.push("опубликовано " + date);
  $("updateMeta").textContent = meta.join(" · ");
  $("updateNotes").innerHTML = renderPatchNotes(info.notes, info.notes_truncated);
  const download = $("updateDownload");
  const installable = !!info.installable;
  download.textContent = installable ? "Установить и перезапустить" : (info.asset_url ? "Скачать обновление" : "Открыть страницу релиза");
  download.disabled = installable ? false : !(info.asset_url || info.url);
  download.title = installable
    ? "Скачать, установить и перезапустить приложение"
    : (info.asset || "Страница релиза");
  $("updateInstallHint").textContent = installable
    ? "Приложение скачает обновление, установит его и перезапустится."
    : (info.install_hint || "Автоустановка недоступна. Скачайте обновление вручную.");
  if (App.updateInstallActive) setUpdateInstall(App.updateInstall);
  else setUpdateInstall(null);
  const release = $("updateRelease");
  release.classList.toggle("hidden", !info.release_url || info.release_url === info.url);
  $("updateModal").classList.remove("hidden");
}

function renderChangelog(info) {
  const list = $("changelogList");
  const releases = info && Array.isArray(info.releases) ? info.releases : [];
  const current = document.querySelector('meta[name="version"]')?.content || "";
  if (!info || !info.checked) {
    $("changelogMeta").textContent = "Не удалось загрузить";
    list.innerHTML = '<p class="update-empty">История сейчас недоступна. Проверьте подключение к GitHub.</p>';
    return;
  }
  if (!releases.length) {
    $("changelogMeta").textContent = "Релизов пока нет";
    list.innerHTML = '<p class="update-empty">Опубликованных релизов пока нет.</p>';
    return;
  }
  const latestDate = formatReleaseDate(releases[0].published_at);
  $("changelogMeta").textContent = "Всего: " + releases.length + (latestDate ? " · последний " + latestDate : "");
  list.innerHTML = releases.map((release, index) => {
    const version = release.version || release.tag || "";
    const title = release.title || (version ? "Огранка " + version : "Релиз");
    const date = formatReleaseDate(release.published_at);
    const badges = [];
    if (index === 0) badges.push('<span class="changelog-badge">последний</span>');
    if (version && version === current) badges.push('<span class="changelog-badge current">установлена</span>');
    if (release.prerelease) badges.push('<span class="changelog-badge">pre-release</span>');
    const link = release.url
      ? '<button class="changelog-link" data-url="' + escapeHtml(release.url) + '">Страница релиза</button>'
      : "";
    return '<article class="changelog-entry">' +
      '<div class="changelog-head"><h3>' + escapeHtml(title) + '</h3>' +
      badges.join("") +
      '<span class="changelog-date">' + escapeHtml(date) + '</span></div>' +
      '<div class="changelog-notes update-notes">' +
      renderPatchNotes(release.notes, release.notes_truncated) +
      '</div>' + link + '</article>';
  }).join("");
}

async function loadChangelog(force = false) {
  const list = $("changelogList");
  $("changelogMeta").textContent = "";
  list.innerHTML = '<p class="update-empty">Загружаю историю…</p>';
  try {
    const response = await fetch("/api/changelog" + (force ? "?force=1" : ""));
    if (!response.ok) throw new Error("changelog unavailable");
    renderChangelog(await response.json());
  } catch (error) {
    $("changelogMeta").textContent = "Ошибка загрузки";
    list.innerHTML = '<p class="update-empty">Не удалось загрузить историю изменений.</p>';
  }
}

function showChangelog(force = false) {
  $("updateModal").classList.add("hidden");
  $("aboutModal").classList.add("hidden");
  $("changelogModal").classList.remove("hidden");
  return loadChangelog(force);
}

function composeFeedback() {
  const type = $("feedbackType").value || "Другое";
  const name = $("feedbackName").value.trim();
  const contact = $("feedbackContact").value.trim();
  const message = $("feedbackText").value.trim();
  const version = document.querySelector('meta[name="version"]')?.content || "";
  const build = document.querySelector('meta[name="build"]')?.content || "";
  const title = "[Обратная связь] " + type + " · Огранка " + version;
  const lines = ["Тип: " + type];
  if (name) lines.push("Имя: " + name);
  if (contact) lines.push("Контакт: " + contact);
  lines.push("", message, "", "Версия: " + version + (build ? " (сборка " + build + ")" : ""));
  if (navigator.platform) lines.push("Платформа: " + navigator.platform);
  return { type, name, contact, message, title, body: lines.join("\n") };
}

function formatFeedbackDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function setFeedbackStatus(text, isError = false) {
  const status = $("feedbackStatus");
  status.textContent = text;
  status.className = "feedback-status" + (isError ? " error" : "");
}

function showFeedback() {
  $("updateModal").classList.add("hidden");
  $("changelogModal").classList.add("hidden");
  $("aboutModal").classList.add("hidden");
  $("feedbackModal").classList.remove("hidden");
  setFeedbackStatus("");
  switchFeedbackTab("send");
  $("feedbackText").focus();
}

async function copyFeedback(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

function githubIssueUrl(data) {
  const url = new URL("https://github.com/" + GITHUB_REPO + "/issues/new");
  url.searchParams.set("title", data.title);
  url.searchParams.set("body", data.body);
  url.searchParams.set("labels", "feedback");
  return url.toString();
}

async function submitFeedback() {
  const data = composeFeedback();
  if (data.message.length < 3) {
    setFeedbackStatus("Напишите сообщение — хотя бы пару слов.", true);
    return;
  }
  const button = $("feedbackOpenBrowser");
  button.disabled = true;
  try {
    await openExternal(githubIssueUrl(data));
    setFeedbackStatus("GitHub открыт в браузере. Проверьте текст и приложите файлы.");
    $("feedbackText").value = "";
  } catch (error) {
    setFeedbackStatus(String(error.message || error), true);
  } finally {
    button.disabled = false;
  }
}

let feedbackTabToken = 0;

function switchFeedbackTab(name) {
  const tab = name === "issues" ? "issues" : "send";
  document.querySelectorAll(".feedback-tab").forEach((button) => {
    const active = button.dataset.feedbackTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  const send = $("feedbackSendPane");
  const issues = $("feedbackIssuesPane");
  const next = tab === "send" ? send : issues;
  const current = send.classList.contains("hidden") ? issues : send;
  if (!next || current === next) {
    if (tab === "issues") loadGithubIssues(false);
    return;
  }
  const wrap = $("feedbackPanes");
  const token = ++feedbackTabToken;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const reveal = () => {
    if (token !== feedbackTabToken) return;
    current.classList.add("hidden");
    current.classList.remove("is-leaving");
    next.classList.remove("hidden");
    next.classList.add("is-entering");
    if (wrap && !reduce) {
      const startHeight = Number.parseFloat(wrap.style.height) || next.getBoundingClientRect().height;
      const endHeight = next.getBoundingClientRect().height;
      wrap.style.height = `${startHeight}px`;
      void wrap.offsetWidth;
      wrap.style.height = `${endHeight}px`;
      window.setTimeout(() => {
        if (token !== feedbackTabToken) return;
        wrap.style.height = "";
      }, 240);
    }
    let entered = false;
    const enter = () => {
      if (entered || token !== feedbackTabToken) return;
      entered = true;
      next.classList.remove("is-entering");
    };
    requestAnimationFrame(enter);
    window.setTimeout(enter, 60);
    if (tab === "issues") loadGithubIssues(false);
  };

  if (reduce) {
    if (wrap) wrap.style.height = "";
    reveal();
    return;
  }
  const startHeight = wrap ? wrap.getBoundingClientRect().height : 0;
  if (wrap) wrap.style.height = `${startHeight}px`;
  current.classList.add("is-leaving");
  window.setTimeout(reveal, 150);
}

function renderGithubIssues(info) {
  const list = $("githubIssuesList");
  const meta = $("githubIssuesMeta");
  if (!list || !meta) return;
  if (!info || !info.checked) {
    meta.textContent = "Не удалось загрузить проблемы";
    list.innerHTML = '<p class="feedback-empty">GitHub сейчас недоступен. Попробуйте обновить.</p>';
    return;
  }
  const rows = Array.isArray(info.issues) ? info.issues : [];
  meta.textContent = rows.length ? rows.length + " проблем" : "Проблем пока нет";
  if (!rows.length) {
    list.innerHTML = '<p class="feedback-empty">Открытых и закрытых проблем пока нет.</p>';
    return;
  }
  list.innerHTML = rows.map((issue) => {
    const labels = (issue.labels || []).map((label) => {
      const color = /^[0-9a-f]{6}$/i.test(label.color || "") ? "#" + label.color : "#586069";
      return `<span class="issue-label" style="background:${color}">${escapeHtml(label.name || "")}</span>`;
    }).join("");
    const state = issue.state === "closed" ? "закрыта" : "открыта";
    const date = formatFeedbackDate(issue.updated_at || issue.created_at);
    return `<article class="github-issue">
      <div class="github-issue-head">
        <a href="${escapeHtml(issue.url || "#")}" data-github-url="${escapeHtml(issue.url || "")}">#${escapeHtml(String(issue.number || ""))} ${escapeHtml(issue.title || "")}</a>
        <span class="github-issue-state ${escapeHtml(issue.state || "")}">${state}</span>
      </div>
      <div class="github-issue-meta">${escapeHtml(issue.user || "")}${date ? " · " + date : ""} · ${Number(issue.comments) || 0} комм.</div>
      ${labels ? `<div class="github-issue-labels">${labels}</div>` : ""}
    </article>`;
  }).join("");
}

async function loadGithubIssues(force = false) {
  const list = $("githubIssuesList");
  const meta = $("githubIssuesMeta");
  if (list) list.innerHTML = '<p class="feedback-empty">Загружаю…</p>';
  if (meta) meta.textContent = "Загружаю проблемы…";
  try {
    const response = await fetch("/api/github/issues" + (force ? "?force=1" : ""), { cache: "no-store" });
    if (!response.ok) throw new Error("github issues unavailable");
    renderGithubIssues(await response.json());
  } catch (error) {
    if (meta) meta.textContent = "Ошибка загрузки";
    if (list) list.innerHTML = '<p class="feedback-empty">Не удалось загрузить проблемы GitHub.</p>';
  }
}

function hideUpdateToast() {
  $("updateToast").classList.add("hidden");
}

function showUpdateToast(info) {
  if (!info || !info.available) {
    hideUpdateToast();
    return;
  }
  const version = info.version || info.current || "";
  const build = info.build ? " · сборка " + info.build : "";
  $("updateToastText").textContent = version + build + ". Откройте, чтобы установить.";
  $("updateToast").classList.remove("hidden");
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
        button.textContent = "Доступно обновление";
        button.title = updateHeadline(info);
        button.classList.remove("hidden");
      } else {
        button.classList.add("hidden");
      }
    }
    if (info.available) showUpdateToast(info);
    else hideUpdateToast();
    if (force && state) {
      if (info.available) {
        state.className = "update-state good";
        state.textContent = updateHeadline(info) + ".";
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

async function pollUpdateInstall() {
  for (let i = 0; i < 600; i++) {
    try {
      const response = await fetch("/api/update/status", { cache: "no-store" });
      if (!response.ok) throw new Error("status unavailable");
      const state = await response.json();
      App.updateInstall = state;
      setUpdateInstall(state);
      if (state.state === "error") {
        App.updateInstallActive = false;
        const button = $("updateDownload");
        button.disabled = false;
        button.textContent = "Установить и перезапустить";
        return;
      }
      if (state.state === "restarting") {
        setTimeout(() => {
          const text = $("updateInstallState");
          if (text && text.textContent.indexOf("перезапуска") === -1) {
            text.textContent = "Приложение перезапускается…";
          }
        }, 1200);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      $("updateProgress").classList.remove("hidden");
      $("updateProgressFill").style.width = "100%";
      const text = $("updateInstallState");
      text.classList.remove("error");
      text.textContent = "Обновление установлено. Приложение перезапускается…";
      return;
    }
  }
}

async function installUpdate() {
  const info = App.update;
  if (!info) return;
  if (!info.installable) {
    const url = info.asset_url || info.url;
    if (url) openExternal(url);
    return;
  }
  const button = $("updateDownload");
  button.disabled = true;
  button.textContent = "Устанавливаю…";
  App.updateInstallActive = true;
  App.updateInstall = { state: "preparing", progress: 0, detail: "Подготовка…" };
  setUpdateInstall(App.updateInstall);
  try {
    const response = await fetch("/api/update/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Не удалось начать установку.");
    App.updateInstall = data;
    setUpdateInstall(data);
    pollUpdateInstall();
  } catch (error) {
    App.updateInstallActive = false;
    button.disabled = false;
    button.textContent = "Установить и перезапустить";
    setUpdateInstall({ state: "error", error: String(error.message || error) });
  }
}

const Shot = {
  base: null, original: null, shapes: [], selected: null, tool: "move",
  stage: "crop", crop: null, zoom: 1, drag: null,
  start: null, preview: null, color: "#ff4d4f", width: 3,
  name: "ogranka-shot", title: "Скриншот", subtitle: "",
  history: [], future: [], textEdit: null,
};

function shotHint(text) {
  const hint = $("shotHint");
  if (hint) hint.textContent = text;
}

function shotTextLines(shape) {
  return String(shape.text || "").split("\n");
}

function shotTextMetrics(shape) {
  const canvas = $("shotCanvas");
  const ctx = canvas ? canvas.getContext("2d") : null;
  const fontSize = Math.max(10, shape.fontSize || 18);
  const lines = shotTextLines(shape);
  const widths = lines.map((line) => {
    if (!ctx) return Math.max(1, line.length) * fontSize * 0.55;
    ctx.font = `${fontSize}px system-ui, sans-serif`;
    return ctx.measureText(line || " ").width;
  });
  return {
    w: Math.max(1, ...widths),
    h: Math.max(1, lines.length * fontSize * 1.25),
    fontSize,
  };
}

function shotShapeBounds(shape) {
  if (!shape) return null;
  if (shape.tool === "text") {
    const metrics = shotTextMetrics(shape);
    return { x: shape.start.x, y: shape.start.y, w: metrics.w, h: metrics.h };
  }
  if (shape.tool === "marker" && shape.points && shape.points.length) {
    const xs = shape.points.map((point) => point.x);
    const ys = shape.points.map((point) => point.y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return { x: left, y: top, w: Math.max(1, Math.max(...xs) - left), h: Math.max(1, Math.max(...ys) - top) };
  }
  const x = Math.min(shape.start.x, shape.end.x);
  const y = Math.min(shape.start.y, shape.end.y);
  return {
    x, y,
    w: Math.max(1, Math.abs(shape.end.x - shape.start.x)),
    h: Math.max(1, Math.abs(shape.end.y - shape.start.y)),
  };
}

function shotShapeCenter(shape) {
  const b = shotShapeBounds(shape);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

function shotRotatePoint(point, center, angle) {
  if (!angle) return { x: point.x, y: point.y };
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

function shotRotateVector(vector, angle) {
  if (!angle) return { x: vector.x, y: vector.y };
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: vector.x * cos - vector.y * sin, y: vector.x * sin + vector.y * cos };
}

const SHOT_ROTATE_CURSOR = (() => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">'
    + '<path d="M9 11a8 8 0 1 1-1.4 7.2" fill="none" stroke="#ffffff" stroke-width="4.5"/>'
    + '<path d="M9 11a8 8 0 1 1-1.4 7.2" fill="none" stroke="#141414" stroke-width="2"/>'
    + '<path d="M9 6.4 9 11 4.4 11" fill="none" stroke="#ffffff" stroke-width="4.5"/>'
    + '<path d="M9 6.4 9 11 4.4 11" fill="none" stroke="#141414" stroke-width="2"/></svg>';
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 15 15, crosshair`;
})();

function shotCursorForHandle(handle, rotation = 0) {
  if (handle === "rot") return SHOT_ROTATE_CURSOR;
  const base = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };
  const angle = ((base[handle] || 0) + rotation * 180 / Math.PI + 360) % 360;
  return ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"][Math.round(angle / 45) % 4];
}

function shotCursorAt(point) {
  if (Shot.tool === "text") return "text";
  if (Shot.tool !== "move") return "crosshair";
  const handle = shotShapeHandleAt(point);
  if (handle) return shotCursorForHandle(handle, Shot.selected?.rotation || 0);
  return shotHitShape(point) ? "move" : "grab";
}

function shotDrawShape(ctx, shape) {
  const { tool, start, end, color, width, text } = shape;
  const b = shotShapeBounds(shape);
  const center = shotShapeCenter(shape);
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(shape.rotation || 0);
  ctx.translate(-center.x, -center.y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, width || 1);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (tool === "circle") {
    ctx.beginPath();
    ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (tool === "line" || tool === "arrow") {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    if (tool === "arrow") {
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const size = Math.max(12, width * 4);
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - size * Math.cos(angle - 0.45), end.y - size * Math.sin(angle - 0.45));
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - size * Math.cos(angle + 0.45), end.y - size * Math.sin(angle + 0.45));
      ctx.stroke();
    }
  } else if (tool === "text" && text) {
    const fontSize = Math.max(10, shape.fontSize || 18);
    ctx.font = `${fontSize}px system-ui, sans-serif`;
    ctx.textBaseline = "top";
    shotTextLines(shape).forEach((line, index) => {
      ctx.fillText(line, start.x, start.y + index * fontSize * 1.25);
    });
  } else if (tool === "marker" && shape.points && shape.points.length) {
    ctx.globalAlpha = 0.58;
    ctx.lineWidth = Math.max(6, width * 2.5);
    ctx.beginPath();
    ctx.moveTo(shape.points[0].x, shape.points[0].y);
    shape.points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.stroke();
  }
  ctx.restore();
}

function shotDrawCropFrame(ctx, width, height) {
  const crop = shotNormalizeCrop(Shot.crop || { x: 0, y: 0, w: width, h: height });
  ctx.save();
  ctx.fillStyle = "rgba(4, 8, 14, 0.64)";
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.rect(crop.x, crop.y, crop.w, crop.h);
  ctx.fill("evenodd");

  ctx.strokeStyle = "#4f8cff";
  ctx.lineWidth = Math.max(2, Math.round(Math.min(width, height) / 500));
  ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);

  ctx.strokeStyle = "rgba(188, 215, 255, 0.38)";
  ctx.lineWidth = 1;
  for (let i = 1; i <= 2; i += 1) {
    const x = crop.x + crop.w * i / 3;
    const y = crop.y + crop.h * i / 3;
    ctx.beginPath();
    ctx.moveTo(x, crop.y);
    ctx.lineTo(x, crop.y + crop.h);
    ctx.moveTo(crop.x, y);
    ctx.lineTo(crop.x + crop.w, y);
    ctx.stroke();
  }

  const size = Math.max(9, Math.min(14, Math.round(Math.min(width, height) / 70)));
  const points = [
    [crop.x, crop.y], [crop.x + crop.w / 2, crop.y], [crop.x + crop.w, crop.y],
    [crop.x, crop.y + crop.h / 2], [crop.x + crop.w, crop.y + crop.h / 2],
    [crop.x, crop.y + crop.h], [crop.x + crop.w / 2, crop.y + crop.h], [crop.x + crop.w, crop.y + crop.h],
  ];
  ctx.fillStyle = "#e4efff";
  ctx.strokeStyle = "#2f6fd0";
  ctx.lineWidth = 1.5;
  points.forEach(([x, y]) => {
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
    ctx.strokeRect(x - size / 2, y - size / 2, size, size);
  });

  const label = `${Math.round(crop.w)} × ${Math.round(crop.h)}`;
  ctx.font = "600 14px system-ui, sans-serif";
  const textWidth = ctx.measureText(label).width;
  let labelY = crop.y - 8;
  if (labelY < 20) labelY = crop.y + 23;
  const labelX = Math.min(width - textWidth - 18, Math.max(8, crop.x + 4));
  ctx.fillStyle = "rgba(8, 14, 24, 0.82)";
  ctx.fillRect(labelX - 6, labelY - 14, textWidth + 12, 20);
  ctx.fillStyle = "#dce9ff";
  ctx.textBaseline = "middle";
  ctx.fillText(label, labelX, labelY);
  ctx.restore();
}

function shotDrawSelection(ctx) {
  const shape = Shot.selected;
  if (!shape) return;
  const b = shotShapeBounds(shape);
  const center = shotShapeCenter(shape);
  const size = Math.max(8, Math.min(12, Math.round(Math.min(b.w, b.h) / 5)));
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(shape.rotation || 0);
  ctx.translate(-center.x, -center.y);
  ctx.strokeStyle = "#65a3ff";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.setLineDash([]);
  const points = [
    [b.x, b.y], [b.x + b.w / 2, b.y], [b.x + b.w, b.y],
    [b.x, b.y + b.h / 2], [b.x + b.w, b.y + b.h / 2],
    [b.x, b.y + b.h], [b.x + b.w / 2, b.y + b.h], [b.x + b.w, b.y + b.h],
  ];
  ctx.fillStyle = "#f4f9ff";
  ctx.strokeStyle = "#2f6fd0";
  ctx.lineWidth = 1.5;
  points.forEach(([x, y]) => {
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
    ctx.strokeRect(x - size / 2, y - size / 2, size, size);
  });
  const rotY = b.y - 28;
  ctx.beginPath();
  ctx.moveTo(center.x, b.y);
  ctx.lineTo(center.x, rotY);
  ctx.strokeStyle = "#65a3ff";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(center.x, rotY, 6, 0, Math.PI * 2);
  ctx.fillStyle = "#4f8cff";
  ctx.fill();
  ctx.strokeStyle = "#dce9ff";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function shotDraw() {
  const canvas = $("shotCanvas");
  if (!canvas || !Shot.base) return;
  const width = Shot.base.width || Shot.base.naturalWidth;
  const height = Shot.base.height || Shot.base.naturalHeight;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(Shot.base, 0, 0);
  if (Shot.stage === "crop") {
    shotDrawCropFrame(ctx, canvas.width, canvas.height);
    return;
  }
  Shot.shapes.forEach((shape) => {
    if (Shot.textEdit && shape === Shot.textEdit.shape) return;
    shotDrawShape(ctx, shape);
  });
  if (Shot.preview) shotDrawShape(ctx, Shot.preview);
  shotDrawSelection(ctx);
}

function shotSetZoom(value) {
  const canvas = $("shotCanvas");
  if (!canvas || !Shot.base) return;
  const stage = $("shotStage");
  const oldWidth = canvas.getBoundingClientRect().width || 1;
  const oldHeight = canvas.getBoundingClientRect().height || 1;
  const ratioX = (stage.scrollLeft + stage.clientWidth / 2) / oldWidth;
  const ratioY = (stage.scrollTop + stage.clientHeight / 2) / oldHeight;
  const availW = Math.max(220, stage.clientWidth - 44);
  const panelHeight = $("shotPanel")?.offsetHeight || 142;
  const availH = Math.max(180, stage.clientHeight - panelHeight - 34);
  const fit = Math.min(canvas.width, availW, availH * canvas.width / Math.max(1, canvas.height));
  Shot.zoom = Math.max(0.25, Math.min(4, value));
  canvas.style.width = `${Math.max(80, Math.round(fit * Shot.zoom))}px`;
  canvas.style.height = "auto";
  canvas.style.maxWidth = "none";
  const label = $("shotZoomValue");
  if (label) label.textContent = `${Math.round(Shot.zoom * 100)}%`;
  requestAnimationFrame(() => {
    stage.scrollLeft = ratioX * canvas.getBoundingClientRect().width - stage.clientWidth / 2;
    stage.scrollTop = ratioY * canvas.getBoundingClientRect().height - stage.clientHeight / 2;
  });
}

function shotZoomBy(factor) {
  shotSetZoom(Shot.zoom * factor);
}

function shotSetTool(tool) {
  Shot.tool = tool;
  document.querySelectorAll(".shot-tool").forEach((button) => {
    button.classList.toggle("active", button.dataset.shotTool === tool);
  });
  if (tool !== "move") {
    Shot.selected = null;
    shotDraw();
  }
  const canvas = $("shotCanvas");
  if (canvas) canvas.style.cursor = tool === "move" ? "grab" : tool === "text" ? "text" : "crosshair";
}

function shotSetStage(stage) {
  Shot.stage = stage;
  $("shotCropTools").classList.toggle("hidden", stage !== "crop");
  $("shotEditTools").classList.toggle("hidden", stage !== "edit");
  const subtitle = $("shotSubtitle");
  if (subtitle) subtitle.textContent = stage === "crop" ? "Выберите область" : "Пометки: перетаскивание, ресайз, поворот";
  shotHint(stage === "crop"
    ? "Потяните за рамку или углы. «Всё окно» — без обрезки."
    : "Кликните по пометке, чтобы выбрать. Enter — сохранить, Esc — закрыть.");
  if (stage === "edit") shotSetTool("move");
  const canvas = $("shotCanvas");
  if (canvas) canvas.style.cursor = stage === "crop" ? "crosshair" : "default";
  requestAnimationFrame(() => shotSetZoom(Shot.zoom));
}

function shotPoint(event) {
  const canvas = $("shotCanvas");
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * canvas.width / rect.width,
    y: (event.clientY - rect.top) * canvas.height / rect.height,
  };
}

function shotNormalizeCrop(rect) {
  const maxW = Shot.base?.width || 1;
  const maxH = Shot.base?.height || 1;
  let left = Math.min(rect.x, rect.x + rect.w);
  let top = Math.min(rect.y, rect.y + rect.h);
  let right = Math.max(rect.x, rect.x + rect.w);
  let bottom = Math.max(rect.y, rect.y + rect.h);
  left = Math.max(0, Math.min(left, maxW));
  top = Math.max(0, Math.min(top, maxH));
  right = Math.max(0, Math.min(right, maxW));
  bottom = Math.max(0, Math.min(bottom, maxH));
  return { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
}

function shotApplyCrop() {
  if (!Shot.base) return;
  const crop = shotNormalizeCrop(Shot.crop || { x: 0, y: 0, w: Shot.base.width, h: Shot.base.height });
  if (crop.w < 8 || crop.h < 8) {
    shotHint("Слишком маленькая область: выделите кроп заново.");
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.w));
  canvas.height = Math.max(1, Math.round(crop.h));
  canvas.getContext("2d").drawImage(
    Shot.base, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height,
  );
  Shot.base = canvas;
  Shot.original = canvas;
  Shot.shapes = [];
  Shot.selected = null;
  Shot.preview = null;
  Shot.start = null;
  Shot.drag = null;
  Shot.crop = null;
  Shot.zoom = 1;
  shotSetStage("edit");
  shotDraw();
}

function shotUseFull() {
  if (!Shot.base) return;
  Shot.crop = { x: 0, y: 0, w: Shot.base.width, h: Shot.base.height };
  shotApplyCrop();
}

function shotCropHandleAt(point) {
  if (!Shot.base) return "";
  const crop = shotNormalizeCrop(Shot.crop || { x: 0, y: 0, w: Shot.base.width, h: Shot.base.height });
  const canvas = $("shotCanvas");
  const tolerance = Math.max(10, 16 * canvas.width / Math.max(1, canvas.getBoundingClientRect().width));
  const midX = crop.x + crop.w / 2;
  const midY = crop.y + crop.h / 2;
  const handles = [
    ["nw", crop.x, crop.y], ["n", midX, crop.y], ["ne", crop.x + crop.w, crop.y],
    ["w", crop.x, midY], ["e", crop.x + crop.w, midY],
    ["sw", crop.x, crop.y + crop.h], ["s", midX, crop.y + crop.h], ["se", crop.x + crop.w, crop.y + crop.h],
  ];
  for (const [name, x, y] of handles) {
    if (Math.abs(point.x - x) <= tolerance && Math.abs(point.y - y) <= tolerance) return name;
  }
  return "";
}

function shotUpdateCrop(point) {
  const drag = Shot.drag;
  if (!drag) return;
  if (drag.mode === "crop-new") {
    const left = Math.min(drag.start.x, point.x);
    const top = Math.min(drag.start.y, point.y);
    Shot.crop = shotNormalizeCrop({
      x: left, y: top, w: Math.abs(point.x - drag.start.x), h: Math.abs(point.y - drag.start.y),
    });
    return;
  }
  const start = drag.crop;
  if (drag.mode === "crop-move") {
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    const x = Math.max(0, Math.min(start.x + dx, Shot.base.width - start.w));
    const y = Math.max(0, Math.min(start.y + dy, Shot.base.height - start.h));
    Shot.crop = { x, y, w: start.w, h: start.h };
    return;
  }
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (drag.handle.includes("w")) left = point.x;
  if (drag.handle.includes("e")) right = point.x;
  if (drag.handle.includes("n")) top = point.y;
  if (drag.handle.includes("s")) bottom = point.y;
  left = Math.max(0, Math.min(left, Shot.base.width));
  right = Math.max(0, Math.min(right, Shot.base.width));
  top = Math.max(0, Math.min(top, Shot.base.height));
  bottom = Math.max(0, Math.min(bottom, Shot.base.height));
  if (right - left < 8) {
    if (drag.handle.includes("w")) left = Math.max(0, right - 8);
    else right = Math.min(Shot.base.width, left + 8);
  }
  if (bottom - top < 8) {
    if (drag.handle.includes("n")) top = Math.max(0, bottom - 8);
    else bottom = Math.min(Shot.base.height, top + 8);
  }
  Shot.crop = { x: left, y: top, w: right - left, h: bottom - top };
}

function shotShapeHandleAt(point) {
  const shape = Shot.selected;
  if (!shape) return "";
  const b = shotShapeBounds(shape);
  const center = shotShapeCenter(shape);
  const local = shotRotatePoint(point, center, -(shape.rotation || 0));
  const canvas = $("shotCanvas");
  const tolerance = Math.max(9, 14 * canvas.width / Math.max(1, canvas.getBoundingClientRect().width));
  const handles = [
    ["nw", b.x, b.y], ["n", b.x + b.w / 2, b.y], ["ne", b.x + b.w, b.y],
    ["w", b.x, b.y + b.h / 2], ["e", b.x + b.w, b.y + b.h / 2],
    ["sw", b.x, b.y + b.h], ["s", b.x + b.w / 2, b.y + b.h], ["se", b.x + b.w, b.y + b.h],
    ["rot", b.x + b.w / 2, b.y - 28],
  ];
  for (const [name, x, y] of handles) {
    if (Math.abs(local.x - x) <= tolerance && Math.abs(local.y - y) <= tolerance) return name;
  }
  return "";
}

function shotHitShape(point) {
  for (let i = Shot.shapes.length - 1; i >= 0; i -= 1) {
    const shape = Shot.shapes[i];
    const b = shotShapeBounds(shape);
    const center = shotShapeCenter(shape);
    const local = shotRotatePoint(point, center, -(shape.rotation || 0));
    if (local.x >= b.x - 5 && local.x <= b.x + b.w + 5
      && local.y >= b.y - 5 && local.y <= b.y + b.h + 5) {
      return shape;
    }
  }
  return null;
}

function shotResizeShape(point) {
  const drag = Shot.drag;
  const shape = drag.shape;
  const old = drag.bounds;
  const rotation = shape.rotation || 0;
  const anchor = drag.anchorWorld;
  const handle = drag.handle;
  const rel = shotRotateVector({ x: point.x - anchor.x, y: point.y - anchor.y }, -rotation);
  let width = old.w;
  let height = old.h;
  if (handle.includes("e")) width = Math.max(8, rel.x);
  if (handle.includes("w")) width = Math.max(8, -rel.x);
  if (handle.includes("s")) height = Math.max(8, rel.y);
  if (handle.includes("n")) height = Math.max(8, -rel.y);
  const localX = handle.includes("w") ? -width : 0;
  const localY = handle.includes("n") ? -height : 0;
  const localCenter = { x: localX + width / 2, y: localY + height / 2 };
  const centerWorld = {
    x: anchor.x + shotRotateVector(localCenter, rotation).x,
    y: anchor.y + shotRotateVector(localCenter, rotation).y,
  };
  if (shape.tool === "text") {
    const ratio = handle.includes("e") || handle.includes("w")
      ? (old.w ? width / old.w : 1)
      : (old.h ? height / old.h : 1);
    const fontSize = Math.max(10, (drag.fontSize || 18) * ratio);
    const metrics = shotTextMetrics({ ...shape, fontSize });
    shape.fontSize = fontSize;
    shape.w = metrics.w;
    shape.h = metrics.h;
    shape.start = { x: centerWorld.x - metrics.w / 2, y: centerWorld.y - metrics.h / 2 };
    shape.end = { x: shape.start.x + metrics.w, y: shape.start.y + metrics.h };
    return;
  }
  const sx = old.w ? width / old.w : 1;
  const sy = old.h ? height / old.h : 1;
  const place = (p) => {
    const lx = localX + (p.x - old.x) * sx;
    const ly = localY + (p.y - old.y) * sy;
    return { x: centerWorld.x + lx - localCenter.x, y: centerWorld.y + ly - localCenter.y };
  };
  if (shape.tool === "marker") {
    shape.points = drag.startShape.points.map(place);
  } else {
    shape.start = place(drag.startShape.start);
    shape.end = place(drag.startShape.end);
  }
}

function shotUpdateShapeDrag(point, event) {
  const drag = Shot.drag;
  if (!drag || !drag.shape) return;
  const shape = drag.shape;
  if (drag.mode === "shape-move") {
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    shape.start = { x: drag.startShape.start.x + dx, y: drag.startShape.start.y + dy };
    if (shape.tool === "text") {
      shape.w = drag.startShape.w;
      shape.h = drag.startShape.h;
    } else if (shape.tool === "marker") {
      shape.points = drag.startShape.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    } else {
      shape.end = { x: drag.startShape.end.x + dx, y: drag.startShape.end.y + dy };
    }
    return;
  }
  if (drag.mode === "shape-rotate") {
    const center = shotShapeCenter(shape);
    const angle = Math.atan2(point.y - center.y, point.x - center.x);
    let rotation = drag.rotation + angle - drag.startAngle;
    if (event.shiftKey) rotation = Math.round(rotation / (Math.PI / 12)) * (Math.PI / 12);
    shape.rotation = rotation;
    return;
  }
  if (drag.mode === "shape-resize") shotResizeShape(point);
}

function shotDeleteSelected() {
  if (!Shot.selected) {
    shotHint("Сначала выберите пометку.");
    return;
  }
  shotRemember();
  Shot.shapes = Shot.shapes.filter((shape) => shape !== Shot.selected);
  Shot.selected = null;
  shotDraw();
}

function shotApplyColor(color) {
  Shot.color = color;
  const picker = $("shotColor");
  if (picker) picker.value = color;
  document.querySelectorAll(".shot-swatch").forEach((swatch) => {
    swatch.classList.toggle("active", swatch.dataset.shotColor.toLowerCase() === color.toLowerCase());
  });
  if (Shot.selected) {
    shotRemember();
    Shot.selected.color = color;
    shotDraw();
  }
}

function shotShapeSnapshot(shape) {
  return {
    start: { ...shape.start },
    end: shape.end ? { ...shape.end } : { ...shape.start },
    points: shape.points ? shape.points.map((p) => ({ ...p })) : null,
    w: shape.w, h: shape.h, fontSize: shape.fontSize,
    text: shape.text, rotation: shape.rotation || 0,
  };
}

function shotSnapshot() {
  return Shot.shapes.map((shape) => JSON.parse(JSON.stringify(shape)));
}

function shotSyncHistory() {
  const undo = $("shotUndo");
  const redo = $("shotRedo");
  if (undo) undo.disabled = Shot.history.length === 0;
  if (redo) redo.disabled = Shot.future.length === 0;
}

function shotPushSnapshot(snapshot) {
  if (!snapshot) return;
  Shot.history.push(snapshot);
  if (Shot.history.length > 60) Shot.history.shift();
  Shot.future = [];
  shotSyncHistory();
}

function shotRemember() {
  shotPushSnapshot(shotSnapshot());
}

function shotRestore(snapshot) {
  Shot.shapes = snapshot.map((shape) => JSON.parse(JSON.stringify(shape)));
  Shot.selected = null;
  Shot.preview = null;
  Shot.drag = null;
  shotDraw();
  shotSyncHistory();
}

function shotUndo() {
  if (Shot.textEdit) shotCommitText();
  if (!Shot.history.length) return;
  Shot.future.push(shotSnapshot());
  shotRestore(Shot.history.pop());
}

function shotRedo() {
  if (Shot.textEdit) shotCommitText();
  if (!Shot.future.length) return;
  Shot.history.push(shotSnapshot());
  shotRestore(Shot.future.pop());
}

function shotTextEditorPosition(shape) {
  const canvas = $("shotCanvas");
  const input = $("shotTextInput");
  if (!canvas || !input) return;
  const rect = canvas.getBoundingClientRect();
  const scale = rect.width / Math.max(1, canvas.width);
  const bounds = shotShapeBounds(shape);
  input.style.left = `${rect.left + bounds.x * scale}px`;
  input.style.top = `${rect.top + bounds.y * scale}px`;
  input.style.fontSize = `${Math.max(10, shape.fontSize || 18) * scale}px`;
  input.style.color = shape.color || "#ffffff";
  input.style.width = "0px";
  input.style.height = "0px";
  input.style.width = `${Math.max(26, input.scrollWidth + 8)}px`;
  input.style.height = `${Math.max(input.scrollHeight + 4, (shape.fontSize || 18) * scale * 1.25)}px`;
}

function shotStartText(point, shape = null) {
  shotCommitText();
  const fontSize = Math.max(20, Math.round((Shot.base?.width || 960) / 40));
  const target = shape || {
    tool: "text", start: { ...point }, end: { ...point }, w: 24, h: fontSize * 1.25,
    fontSize, color: Shot.color, width: Shot.width, text: "", rotation: 0,
  };
  shotRemember();
  if (!shape) Shot.shapes.push(target);
  Shot.selected = target;
  const input = $("shotTextInput");
  if (!input) return;
  Shot.textEdit = { shape: target, isNew: !shape };
  input.value = target.text || "";
  input.classList.remove("hidden");
  shotTextEditorPosition(target);
  shotDraw();
  requestAnimationFrame(() => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

function shotUpdateText(value) {
  const edit = Shot.textEdit;
  if (!edit) return;
  edit.shape.text = value;
  const metrics = shotTextMetrics(edit.shape);
  edit.shape.w = metrics.w;
  edit.shape.h = metrics.h;
  edit.shape.end = { x: edit.shape.start.x + metrics.w, y: edit.shape.start.y + metrics.h };
  shotTextEditorPosition(edit.shape);
  shotDraw();
}

function shotCommitText(cancel = false) {
  const edit = Shot.textEdit;
  if (!edit) return;
  const input = $("shotTextInput");
  const shape = edit.shape;
  Shot.textEdit = null;
  if (input) {
    input.classList.add("hidden");
    input.value = "";
  }
  const blank = !String(shape.text || "").trim();
  if (cancel || blank) {
    Shot.shapes = Shot.shapes.filter((item) => item !== shape);
    Shot.selected = null;
    if (edit.isNew) {
      Shot.history.pop();
      shotSyncHistory();
    } else if (!blank) {
      shotRestore(Shot.history.pop());
    }
  } else {
    const metrics = shotTextMetrics(shape);
    shape.w = metrics.w;
    shape.h = metrics.h;
    shape.end = { x: shape.start.x + metrics.w, y: shape.start.y + metrics.h };
  }
  shotDraw();
}

function loadShotImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function shotScreenData() {
  if (window.pywebview?.api?.capture_screen) {
    const result = await window.pywebview.api.capture_screen();
    if (result?.data) return result.data;
    if (result?.error) throw new Error(result.error);
  }
  if (navigator.mediaDevices?.getDisplayMedia) {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    try {
      const video = document.createElement("video");
      video.srcObject = stream;
      await new Promise((resolve) => {
        video.onloadedmetadata = resolve;
        setTimeout(resolve, 1500);
      });
      await video.play();
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      canvas.getContext("2d").drawImage(video, 0, 0);
      return canvas.toDataURL("image/png");
    } finally {
      stream.getTracks().forEach((track) => track.stop());
    }
  }
  throw new Error("Захват экрана недоступен.");
}

function shotAppRect(image, rect = null) {
  const dpr = window.devicePixelRatio || 1;
  let x;
  let y;
  let w;
  let h;
  if (rect && Number(rect.width) > 0 && Number(rect.height) > 0) {
    x = Math.round(Number(rect.x) * dpr);
    y = Math.round(Number(rect.y) * dpr);
    w = Math.round(Number(rect.width) * dpr);
    h = Math.round(Number(rect.height) * dpr);
  } else {
    const screenX = Number(window.screenX ?? window.screenLeft ?? 0) || 0;
    const screenY = Number(window.screenY ?? window.screenTop ?? 0) || 0;
    const chrome = Math.max(0, (window.outerHeight || window.innerHeight) - window.innerHeight);
    x = Math.round(screenX * dpr);
    y = Math.round((screenY + chrome) * dpr);
    w = Math.round(window.innerWidth * dpr);
    h = Math.round(window.innerHeight * dpr);
  }
  if (w < 100 || h < 100 || x < 0 || y < 0 || x >= image.naturalWidth || y >= image.naturalHeight) {
    return { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight };
  }
  w = Math.min(w, image.naturalWidth - x);
  h = Math.min(h, image.naturalHeight - y);
  return { x, y, w, h };
}

async function startAppShot() {
  if (!$("shotLayer").classList.contains("hidden")) return;
  if (typeof closeViewerShotMenus === "function") closeViewerShotMenus();
  $("statusText").textContent = "Готовлю скриншот приложения…";
  try {
    const api = window.pywebview?.api;
    const isMac = /Mac/i.test(navigator.platform || navigator.userAgent || "");
    let native = null;
    if (api?.capture_app) {
      native = await api.capture_app();
      if (native?.data) {
        const image = await loadShotImage(native.data);
        openShotEditor(image, {
          title: "Скриншот приложения",
          subtitle: "Окно Огранки",
          name: "ogranka-app",
        });
        $("statusText").textContent = "Скриншот готов";
        return;
      }
      if (native?.error) throw new Error(native.error);
    }
    if (isMac) {
      throw new Error("Нативный захват окна недоступен.");
    }
    let windowRect = null;
    if (api?.window_rect) {
      try {
        windowRect = await api.window_rect();
      } catch (error) {
        windowRect = null;
      }
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const image = await loadShotImage(await shotScreenData());
    const rect = shotAppRect(image, windowRect);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(rect.w));
    canvas.height = Math.max(1, Math.round(rect.h));
    canvas.getContext("2d").drawImage(
      image, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height,
    );
    openShotEditor(canvas, {
      title: "Скриншот приложения",
      subtitle: "Окно Огранки",
      name: "ogranka-app",
    });
    $("statusText").textContent = "Скриншот готов";
  } catch (error) {
    $("statusText").textContent = "Не удалось сделать скриншот";
    alert("Не удалось сделать скриншот: " + String(error.message || error));
  }
}

async function startViewportShot(viewer = activeViewer()) {
  if (!$("shotLayer").classList.contains("hidden")) return;
  if (!viewer || !viewer.renderer) return;
  if (typeof closeViewerShotMenus === "function") closeViewerShotMenus();
  setActiveViewer(viewer);
  $("statusText").textContent = "Готовлю скриншот вьюпорта…";
  try {
    if (typeof viewer.render === "function") viewer.render();
    const image = await loadShotImage(viewer.renderer.domElement.toDataURL("image/png"));
    openShotEditor(image, {
      title: "Скриншот вьюпорта",
      subtitle: "3D-область",
      name: exportBase(viewer),
    });
    $("statusText").textContent = "Скриншот готов";
  } catch (error) {
    $("statusText").textContent = "Не удалось сделать скриншот";
    alert("Не удалось сделать скриншот: " + String(error.message || error));
  }
}

function openShotEditor(image, meta = {}) {
  Shot.base = image;
  Shot.original = image;
  Shot.shapes = [];
  Shot.history = [];
  Shot.future = [];
  Shot.textEdit = null;
  $("shotTextInput")?.classList.add("hidden");
  Shot.selected = null;
  Shot.preview = null;
  Shot.start = null;
  Shot.drag = null;
  Shot.zoom = 1;
  Shot.crop = { x: 0, y: 0, w: image.naturalWidth || image.width, h: image.naturalHeight || image.height };
  Shot.name = meta.name || "ogranka-shot";
  Shot.title = meta.title || "Скриншот";
  $("shotTitle").textContent = Shot.title;
  $("shotLayer").classList.remove("hidden");
  document.body.classList.add("shot-open");
  shotSetStage("crop");
  shotDraw();
  requestAnimationFrame(() => shotSetZoom(1));
}

function closeShot() {
  if (Shot.textEdit) shotCommitText();
  $("shotLayer").classList.add("hidden");
  document.body.classList.remove("shot-open");
  Shot.drag = null;
  Shot.start = null;
  Shot.preview = null;
}

async function saveShot() {
  if (Shot.textEdit) shotCommitText();
  const canvas = $("shotCanvas");
  if (!canvas || !Shot.base) return;
  if (Shot.stage === "crop") {
    shotApplyCrop();
    if (Shot.stage === "crop") return;
  }
  const dataUrl = canvas.toDataURL("image/png");
  const name = Shot.name + "-" + Date.now() + ".png";
  shotHint("Сохраняю…");
  try {
    if (window.pywebview?.api?.save_png) {
      const result = await window.pywebview.api.save_png(dataUrl, name);
      if (result?.path) {
        $("statusText").textContent = "PNG сохранён";
        $("statusText").title = result.path;
        closeShot();
        return;
      }
      if (result?.cancelled) {
        shotHint("Сохранение отменено.");
        return;
      }
      if (result?.error) throw new Error(result.error);
    }
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = name;
    link.click();
    $("statusText").textContent = "PNG скачан в загрузки";
    closeShot();
  } catch (error) {
    shotHint("Не удалось сохранить PNG: " + String(error.message || error));
  }
}

function initShotEditor() {
  $("shotClose").onclick = () => closeShot();
  $("shotColor").oninput = () => shotApplyColor($("shotColor").value);
  document.querySelectorAll(".shot-swatch").forEach((swatch) => {
    swatch.onclick = () => shotApplyColor(swatch.dataset.shotColor);
  });
  document.querySelectorAll(".shot-tool").forEach((button) => {
    button.onclick = () => shotSetTool(button.dataset.shotTool);
  });
  $("shotWidth").oninput = () => {
    Shot.width = Number($("shotWidth").value) || 3;
    if (Shot.selected) {
      shotRemember();
      Shot.selected.width = Shot.width;
      shotDraw();
    }
  };
  $("shotUndo").onclick = () => shotUndo();
  $("shotRedo").onclick = () => shotRedo();
  $("shotDelete").onclick = () => shotDeleteSelected();
  const textInput = $("shotTextInput");
  if (textInput) {
    textInput.addEventListener("input", () => shotUpdateText(textInput.value));
    textInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        shotCommitText(true);
      } else if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        shotCommitText();
      } else if (event.key === "Enter") {
        event.stopPropagation();
      }
    });
    textInput.addEventListener("blur", () => shotCommitText());
  }
  $("shotSave").onclick = () => saveShot();
  $("shotCropAll").onclick = () => shotUseFull();
  $("shotCropApply").onclick = () => shotApplyCrop();
  $("shotZoomOut").onclick = () => shotZoomBy(1 / 1.15);
  $("shotZoomIn").onclick = () => shotZoomBy(1.15);
  const canvas = $("shotCanvas");
  canvas.addEventListener("wheel", (event) => {
    if (!Shot.base) return;
    event.preventDefault();
    shotZoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });
  canvas.onpointerdown = (event) => {
    if (!Shot.base) return;
    const point = shotPoint(event);
    if (Shot.stage === "crop") {
      const crop = shotNormalizeCrop(Shot.crop || { x: 0, y: 0, w: Shot.base.width, h: Shot.base.height });
      const handle = shotCropHandleAt(point);
      const isFull = crop.w >= Shot.base.width - 1 && crop.h >= Shot.base.height - 1;
      if (handle) {
        Shot.drag = { mode: "crop-resize", handle, start: point, crop };
      } else if (!isFull && point.x >= crop.x && point.x <= crop.x + crop.w
        && point.y >= crop.y && point.y <= crop.y + crop.h) {
        Shot.drag = { mode: "crop-move", start: point, crop };
      } else {
        Shot.crop = { x: point.x, y: point.y, w: 0, h: 0 };
        Shot.drag = { mode: "crop-new", start: point };
      }
      canvas.setPointerCapture(event.pointerId);
      shotDraw();
      return;
    }
    if (Shot.tool === "move") {
      const handle = shotShapeHandleAt(point);
      if (handle && Shot.selected) {
        const shape = Shot.selected;
        const center = shotShapeCenter(shape);
        if (handle === "rot") {
          Shot.drag = {
            mode: "shape-rotate", shape, start: point,
            rotation: shape.rotation || 0,
            startAngle: Math.atan2(point.y - center.y, point.x - center.x),
            before: shotSnapshot(), moved: false,
          };
          canvas.style.cursor = SHOT_ROTATE_CURSOR;
        } else {
          const bounds = shotShapeBounds(shape);
          const anchorLocal = {
            x: handle.includes("w") ? bounds.x + bounds.w : bounds.x,
            y: handle.includes("n") ? bounds.y + bounds.h : bounds.y,
          };
          Shot.drag = {
            mode: "shape-resize", shape, handle, bounds,
            fontSize: shape.fontSize,
            startShape: shotShapeSnapshot(shape),
            before: shotSnapshot(), moved: false,
            anchorWorld: shotRotatePoint(anchorLocal, center, shape.rotation || 0),
          };
          canvas.style.cursor = shotCursorForHandle(handle, shape.rotation || 0);
        }
        canvas.setPointerCapture(event.pointerId);
        return;
      }
      const shape = shotHitShape(point);
      if (shape) {
        Shot.selected = shape;
        Shot.drag = {
          mode: "shape-move", shape, start: point,
          startShape: shotShapeSnapshot(shape),
          before: shotSnapshot(), moved: false,
        };
        canvas.style.cursor = "grabbing";
        canvas.setPointerCapture(event.pointerId);
        shotDraw();
        return;
      }
      Shot.selected = null;
      const stage = $("shotStage");
      Shot.drag = {
        mode: "pan",
        start: { x: event.clientX, y: event.clientY },
        left: stage.scrollLeft,
        top: stage.scrollTop,
      };
      canvas.style.cursor = "grabbing";
      canvas.setPointerCapture(event.pointerId);
      shotDraw();
      return;
    }
    if (Shot.tool === "text") {
      const existing = shotHitShape(point);
      shotStartText(point, existing && existing.tool === "text" ? existing : null);
      return;
    }
    Shot.start = point;
    Shot.preview = {
      tool: Shot.tool, start: point, end: point,
      points: Shot.tool === "marker" ? [{ ...point }] : null,
      color: Shot.color, width: Shot.width, rotation: 0,
    };
    Shot.drag = { mode: "shape-draw" };
    canvas.setPointerCapture(event.pointerId);
    shotDraw();
  };
  canvas.onpointermove = (event) => {
    if (!Shot.base) return;
    const point = shotPoint(event);
    if (Shot.stage === "crop") {
      if (!Shot.drag || !Shot.drag.mode.startsWith("crop-")) return;
      shotUpdateCrop(point);
      shotDraw();
      return;
    }
    if (Shot.drag?.mode === "shape-draw" && Shot.preview) {
      if (Shot.preview.tool === "marker") {
        const points = Shot.preview.points;
        const last = points[points.length - 1];
        if (!last || Math.hypot(point.x - last.x, point.y - last.y) > 1.2) {
          points.push({ ...point });
        }
      } else {
        Shot.preview.end = point;
      }
      shotDraw();
      return;
    }
    if (Shot.drag?.mode === "pan") {
      const stage = $("shotStage");
      stage.scrollLeft = Shot.drag.left - (event.clientX - Shot.drag.start.x);
      stage.scrollTop = Shot.drag.top - (event.clientY - Shot.drag.start.y);
      return;
    }
    if (Shot.drag?.shape) {
      Shot.drag.moved = true;
      if (Shot.drag.mode === "shape-resize") {
        canvas.style.cursor = shotCursorForHandle(Shot.drag.handle, Shot.drag.shape.rotation || 0);
      } else if (Shot.drag.mode === "shape-rotate") {
        canvas.style.cursor = SHOT_ROTATE_CURSOR;
      } else {
        canvas.style.cursor = "grabbing";
      }
      shotUpdateShapeDrag(point, event);
      shotDraw();
      return;
    }
    canvas.style.cursor = shotCursorAt(point);
  };
  canvas.onpointerup = (event) => {
    if (!Shot.base) return;
    if (Shot.stage === "crop") {
      if (!Shot.drag) return;
      const crop = shotNormalizeCrop(Shot.crop || { x: 0, y: 0, w: Shot.base.width, h: Shot.base.height });
      if (crop.w < 8 || crop.h < 8) {
        Shot.crop = { x: 0, y: 0, w: Shot.base.width, h: Shot.base.height };
      }
      Shot.drag = null;
      shotDraw();
      return;
    }
    if (Shot.drag?.mode === "pan") {
      Shot.drag = null;
      canvas.style.cursor = "grab";
      return;
    }
    if (Shot.drag?.mode === "shape-draw" && Shot.preview) {
      const shape = Shot.preview;
      const b = shotShapeBounds(shape);
      Shot.preview = null;
      Shot.drag = null;
      if (b.w > 3 || b.h > 3) {
        shotRemember();
        Shot.shapes.push(shape);
        Shot.selected = shape;
        shotSetTool("move");
      }
      shotDraw();
      return;
    }
    if (Shot.drag?.before && Shot.drag.moved) shotPushSnapshot(Shot.drag.before);
    if (Shot.drag?.shape && Shot.drag.moved) Shot.selected = Shot.drag.shape;
    Shot.drag = null;
    canvas.style.cursor = shotCursorAt(shotPoint(event));
    shotDraw();
  };
  canvas.onpointercancel = () => {
    Shot.start = null;
    Shot.preview = null;
    Shot.drag = null;
    canvas.style.cursor = shotCursorAt(shotPoint({ clientX: 0, clientY: 0 }));
    shotDraw();
  };
  document.addEventListener("keydown", (event) => {
    if ($("shotLayer").classList.contains("hidden")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeShot();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      saveShot();
      return;
    }
    if ((event.key === "Backspace" || event.key === "Delete") && Shot.selected) {
      event.preventDefault();
      shotDeleteSelected();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) shotRedo();
      else shotUndo();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      shotRedo();
    }
  });
  shotSetTool("move");
  shotSyncHistory();
}

function initRestartToast() {
  const toast = $("restartToast");
  if (!toast) return;
  const current = Number(document.querySelector('meta[name="build"]')?.content || 0);
  const updated = document.querySelector('meta[name="just-updated"]')?.content === "1";
  if (!current || !updated) return;
  const text = $("restartToastText");
  if (text) {
    const version = document.querySelector('meta[name="version"]')?.content || "";
    text.textContent = (version ? "Версия " + version + " · " : "") + "сборка " + current + ". Можно продолжать работу.";
  }
  toast.classList.remove("hidden");
  const close = () => toast.classList.add("hidden");
  $("restartToastClose").onclick = close;
  setTimeout(close, 9000);
}

function init() {
  initSplash();
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
  $("selAll").onclick = () => {
    const v = App.viewers[0];
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
  $("selClear").onclick = () => {
    ensureSelBuckets();
    ["face", "vert", "edge", "section"].forEach((mode) => {
      const bucket = App.sel.buckets[mode];
      bucket.points = [];
      bucket.polys = [];
      bucket.ids = [];
    });
    App.sel.points = [];
    App.sel.polys = [];
    App.sel.ids = [];
    App.sel.anchor = null;
    broadcastSelection();
  };
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
    if (!v || !v.mesh || !App.sel.buckets) return;
    const faces = App.sel.buckets.face.ids
      .filter((id) => id.viewer === v && id.type === "face")
      .map((id) => id.index);
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
    if (!$("shotLayer").classList.contains("hidden")) return;
    if (tag === "input" || tag === "select" || tag === "textarea" || e.target.isContentEditable) return;
    if (!$("tour").classList.contains("hidden")) {
      if (e.key === "Escape") finishTour();
      return;
    }
    if (e.key === "Escape") {
      $("helpModal").classList.add("hidden");
      $("aboutModal").classList.add("hidden");
      if (App.boxSelect) { setBoxSelect(false); return; }
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
