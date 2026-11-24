/* Live preview. */
function liveMethod() {
  if ($("mFft").checked) return "fft";
  if ($("mUni").checked) return "uni";
  return "none";
}

function setLiveHint(text) {
  const a = $("liveHint");
  const b = $("fullLiveHint");
  if (a) a.textContent = text;
  if (b) b.textContent = text;
}

function updateLiveLabels() {
  const noise = +$("liveNoise").value;
  const retained = +$("liveSimplify").value;
  $("liveNoiseVal").textContent = noise.toFixed(3);
  $("liveSimplifyVal").textContent = Math.round(retained) + "%";
  const fn = $("fullLiveNoise");
  const fs = $("fullLiveSimplify");
  if (fn) fn.value = String(noise);
  if (fs) fs.value = String(retained);
  const fnv = $("fullLiveNoiseVal");
  const fsv = $("fullLiveSimplifyVal");
  if (fnv) fnv.textContent = noise.toFixed(3);
  if (fsv) fsv.textContent = Math.round(retained) + "%";
}

function scheduleLive() {
  updateLiveLabels();
  clearTimeout(App.liveTimer);
  App.liveTimer = setTimeout(runLive, 280);
}

async function runLive() {
  const src = currentLiveSource();
  if (!src) { setLiveHint("Для этой модели источник не сохранён"); return; }
  if (App.poll) {
    setLiveHint("Дождитесь завершения конвейера");
    return;
  }
  const seq = ++App.liveSeq;
  const target = App.activeViewer && App.viewers.includes(App.activeViewer)
    ? App.activeViewer
    : (App.fullscreen ? (App.solo || App.viewers[0]) : (App.viewers[1] || App.viewers[0]));
  const noise = +$("liveNoise").value;
  const retained = +$("liveSimplify").value;
  const params = {
    noise,
    pct: Math.max(5, Math.min(100, retained)),
    method: liveMethod(),
    harmonics: +$("harm").value,
    window: +$("win").value,
    layers: +$("layers").value,
    angles: +$("angles").value,
    mode: $("mode").value,
    noise_model: $("noiseModel").value,
    angle: +$("angleDeg").value,
    loss: +$("lossPct").value / 100,
  };
  const srcKey = JSON.stringify(src);
  setLiveHint("обновляю…");
  try {
    const j = await apiPost("/api/live", { source: src, params });
    if (seq !== App.liveSeq) return;
    if (JSON.stringify(currentLiveSource()) !== srcKey) return;
    applyLive(j.result, target);
  } catch (e) {
    if (seq === App.liveSeq) setLiveHint("Ошибка: " + e.message);
  }
}

function applyLive(result, target) {
  const v = (target && App.viewers.includes(target)) ? target :
    (App.activeViewer && App.viewers.includes(App.activeViewer) ? App.activeViewer :
      (App.fullscreen ? (App.solo || App.viewers[0]) : (App.viewers[1] || App.viewers[0])));
  if (!v || !result || !result.mesh) return;
  if (App.sel.buckets) {
    ["face", "vert", "edge", "section"].forEach((mode) => {
      const bucket = App.sel.buckets[mode];
      if (!bucket) return;
      bucket.points = [];
      bucket.polys = [];
      bucket.ids = [];
    });
  }
  App.sel.points = [];
  App.sel.polys = [];
  App.sel.ids = [];
  App.sel.anchor = null;
  v.setMesh(result.mesh, App.mode, true);
  const m = result.metrics || {};
  v.meta.innerHTML = `живой · MSE ${fmt(m.mse)} · RMSE ${fmt(m.rmse)} · dmax ${fmt(m.dmax)} · ${result.time != null ? result.time + " с" : "—"}`;
  broadcastSelection();
  setLiveHint(`шум ${result.noise} · оставлено ${Math.round(result.pct)}% · ${result.faces} граней`);
}

