/* Results: models, tables, comparison line. */
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
  const data = await apiGet("/api/results", { cache: "no-store" });
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
