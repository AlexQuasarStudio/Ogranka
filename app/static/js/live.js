/* Live preview. */
function liveMethod() {
  if ($("mFft").checked) return "fft";
  if ($("mUni").checked) return "uni";
  return "none";
}

function updateLiveLabels() {
  $("liveNoiseVal").textContent = (+$("liveNoise").value).toFixed(3);
  $("liveSimplifyVal").textContent = Math.round(+$("liveSimplify").value) + "%";
  syncLiveDocks();
}

function syncLiveDocks() {
  const noise = $("liveNoise").value;
  const simplify = $("liveSimplify").value;
  document.querySelectorAll(".dock-noise").forEach((el) => { el.value = noise; });
  document.querySelectorAll(".dock-simplify").forEach((el) => { el.value = simplify; });
  document.querySelectorAll(".dock-noise-val").forEach((el) => { el.textContent = (+noise).toFixed(3); });
  document.querySelectorAll(".dock-simplify-val").forEach((el) => { el.textContent = Math.round(+simplify) + "%"; });
}

function scheduleLive() {
  updateLiveLabels();
  clearTimeout(App.liveTimer);
  App.liveTimer = setTimeout(runLive, 280);
}

async function runLive() {
  const src = currentLiveSource();
  if (!src) { $("liveHint").textContent = "Для этой модели источник не сохранён"; return; }
  if (App.poll) {
    $("liveHint").textContent = "Дождитесь завершения конвейера";
    return;
  }
  const seq = ++App.liveSeq;
  const noise = +$("liveNoise").value;
  const simplify = +$("liveSimplify").value;
  const params = {
    noise,
    pct: Math.max(5, 100 - simplify),
    method: liveMethod(),
    harmonics: +$("harm").value,
    window: +$("win").value,
    layers: +$("layers").value,
    angles: +$("angles").value,
    mode: $("mode").value,
    angle: +$("angleDeg").value,
    loss: +$("lossPct").value / 100,
  };
  const srcKey = JSON.stringify(src);
  $("liveHint").textContent = "обновляю…";
  try {
    const r = await fetch("/api/live", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: src, params }),
    });
    const j = await r.json();
    if (seq !== App.liveSeq) return;
    if (!r.ok) throw new Error(j.error || "не удалось обновить");
    if (JSON.stringify(currentLiveSource()) !== srcKey) return;
    applyLive(j.result);
  } catch (e) {
    if (seq === App.liveSeq) $("liveHint").textContent = "Ошибка: " + e.message;
  }
}

function applyLive(result) {
  const v = App.solo || App.viewers[1] || App.viewers[0];
  if (!v || !result || !result.mesh) return;
  App.sel.points = [];
  App.sel.polys = [];
  App.sel.ids = [];
  App.sel.anchor = null;
  v.setMesh(result.mesh, App.mode, true);
  const m = result.metrics || {};
  v.meta.innerHTML = `живой · MSE ${fmt(m.mse)} · RMSE ${fmt(m.rmse)} · dmax ${fmt(m.dmax)} · ${result.time != null ? result.time + " с" : "—"}`;
  broadcastSelection();
  $("liveHint").textContent = `шум ${result.noise} · упрощение ${Math.round(100 - result.pct)}% · ${result.faces} граней`;
}

