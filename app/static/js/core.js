/* App state and common geometry helpers. */
const App = {
  sources: [{ kind: "demo", name: "octa" }],
  liveSource: null,
  models: [],
  modelIdx: 0,
  meshes: {},
  mode: "solid_edges",
  solo: null,
  fullscreen: false,
  fullViews: [],
  syncCam: true,
  camLock: false,
  sel: {
    points: [], polys: [], mode: "face", anchor: null, ids: [],
    buckets: {
      face: { points: [], polys: [], ids: [] },
      vert: { points: [], polys: [], ids: [] },
      edge: { points: [], polys: [], ids: [] },
      section: { points: [], polys: [], ids: [] },
    },
  },
  selTarget: "face",
  boxSelect: false,
  isolate: false,
  ortho: false,
  viewers: [],
  activeViewer: null,
  poll: null,
  partialDone: 0,
  uploading: false,
  colPct: 50,
  soloPrevH: null,
  liveTimer: null,
  liveSeq: 0,
  lastElapsed: 0,
  runBaseCount: null,
  update: null,
};

const TOL = 0.03;
const $ = (id) => document.getElementById(id);
const fmt = (v, d = 4) => {
  if (v === null || v === undefined) return "—";
  if (v === 0) return "0";
  const a = Math.abs(v);
  return (a < 1e-3 || a >= 1e4) ? v.toExponential(2) : v.toFixed(d);
};
const badge = (q) => {
  if (!q) return "";
  const t = { good: "хорошо", medium: "средне", bad: "плохо", ref: "эталон" }[q] || q;
  const hint = {
    good: "RMSE ≤ 0.03 и dmax ≤ 0.15",
    medium: "RMSE ≤ 0.12 и dmax ≤ 0.30",
    bad: "превышены пороги MSE/RMSE или dmax",
    ref: "эталонная модель",
  }[q] || "";
  return `<span class="badge ${q}" title="${hint}">${t}</span>`;
};
function pointInPoly(p, poly, tol) {
  if (!poly || poly.length < 3) return false;
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const ln = Math.hypot(nx, ny, nz);
  if (ln < 1e-12) return false;
  nx /= ln; ny /= ln; nz /= ln;
  const a0 = poly[0];
  if (Math.abs(nx * (p[0] - a0[0]) + ny * (p[1] - a0[1]) + nz * (p[2] - a0[2])) > tol) return false;
  let ax = poly[1][0] - a0[0], ay = poly[1][1] - a0[1], az = poly[1][2] - a0[2];
  const ad = ax * nx + ay * ny + az * nz;
  ax -= ad * nx; ay -= ad * ny; az -= ad * nz;
  const al = Math.hypot(ax, ay, az);
  if (al < 1e-12) return false;
  ax /= al; ay /= al; az /= al;
  const bx = ny * az - nz * ay, by = nz * ax - nx * az, bz = nx * ay - ny * ax;
  const uv = poly.map((q) => {
    const dx = q[0] - a0[0], dy = q[1] - a0[1], dz = q[2] - a0[2];
    return [dx * ax + dy * ay + dz * az, dx * bx + dy * by + dz * bz];
  });
  const dx = p[0] - a0[0], dy = p[1] - a0[1], dz = p[2] - a0[2];
  const u = dx * ax + dy * ay + dz * az, v = dx * bx + dy * by + dz * bz;
  let inside = false;
  for (let i = 0, j = uv.length - 1; i < uv.length; j = i++) {
    const [ui, vi] = uv[i], [uj, vj] = uv[j];
    if ((vi > v) !== (vj > v)) {
      const t = (v - vi) / (vj - vi);
      if (u < ui + t * (uj - ui)) inside = !inside;
    }
  }
  return inside;
}

const near = (a, p) => (a[0] - p[0]) ** 2 + (a[1] - p[1]) ** 2 + (a[2] - p[2]) ** 2 < TOL * TOL;

function pointSegDist2(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const den = abx * abx + aby * aby + abz * abz;
  let t = den > 1e-15 ? (apx * abx + apy * aby + apz * abz) / den : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = apx - t * abx, dy = apy - t * aby, dz = apz - t * abz;
  return dx * dx + dy * dy + dz * dz;
}

function triPointInTri(p, a, b, c) {
  const s1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const s2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]);
  const s3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
  return (s1 >= -1e-12 && s2 >= -1e-12 && s3 >= -1e-12) ||
         (s1 <= 1e-12 && s2 <= 1e-12 && s3 <= 1e-12);
}

function triangulateFace(f, v) {
  const n = f.length;
  if (n < 3) return [];
  if (n === 3) return [[f[0], f[1], f[2]]];
  const fan = () => {
    const out = [];
    for (let k = 1; k < n - 1; k++) out.push([f[0], f[k], f[k + 1]]);
    return out;
  };
  const p0 = v[f[0]];
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < n; i++) {
    const a = v[f[i]], b = v[f[(i + 1) % n]];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const ln = Math.hypot(nx, ny, nz);
  if (ln < 1e-12) return fan();
  nx /= ln; ny /= ln; nz /= ln;
  let ax = v[f[1]][0] - p0[0], ay = v[f[1]][1] - p0[1], az = v[f[1]][2] - p0[2];
  const ad = ax * nx + ay * ny + az * nz;
  ax -= ad * nx; ay -= ad * ny; az -= ad * nz;
  const al = Math.hypot(ax, ay, az);
  if (al < 1e-12) return fan();
  ax /= al; ay /= al; az /= al;
  const bx = ny * az - nz * ay, by = nz * ax - nx * az, bz = nx * ay - ny * ax;
  const uv = f.map((i) => {
    const dx = v[i][0] - p0[0], dy = v[i][1] - p0[1], dz = v[i][2] - p0[2];
    return [dx * ax + dy * ay + dz * az, dx * bx + dy * by + dz * bz];
  });
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += uv[i][0] * uv[j][1] - uv[j][0] * uv[i][1];
  }
  const idx = f.map((_, i) => i);
  if (area < 0) idx.reverse();
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let found = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k - 1 + idx.length) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const a = uv[i0], b = uv[i1], c = uv[i2];
      const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (cr <= 1e-12) continue;
      let inside = false;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (triPointInTri(uv[j], a, b, c)) { inside = true; break; }
      }
      if (inside) continue;
      tris.push([f[i0], f[i1], f[i2]]);
      idx.splice(k, 1);
      found = true;
      break;
    }
    if (!found) break;
  }
  for (let k = 1; k < idx.length - 1; k++) tris.push([f[idx[0]], f[idx[k]], f[idx[k + 1]]]);
  return tris;
}


// ---- geometry / common utilities ----
function polyArea3(v, f) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 1; i < f.length - 1; i++) {
    const a = v[f[0]], b = v[f[i]], c = v[f[i + 1]];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    nx += uy * wz - uz * wy; ny += uz * wx - ux * wz; nz += ux * wy - uy * wx;
  }
  return 0.5 * Math.hypot(nx, ny, nz);
}

// ---------------------------------------------------------------- API

/* POST-запросы несут заголовок X-Ogranka: сервер отклоняет запросы без него,
   поэтому сторонняя страница в браузере не может управлять приложением. */
const API_HEADERS = { "X-Ogranka": "1" };

async function readJson(response) {
  try { return await response.json(); } catch (err) { return {}; }
}

async function apiGet(path, options = {}) {
  const response = await fetch(path, options);
  const data = await readJson(response);
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function apiPost(path, body = {}, options = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...API_HEADERS },
    body: JSON.stringify(body),
    ...options,
  });
  const data = await readJson(response);
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

// ---------------------------------------------------------------- окна

async function meshOf(id) {
  if (!App.meshes[id]) {
    App.meshes[id] = apiGet("/api/mesh?id=" + encodeURIComponent(id)).catch((err) => {
      delete App.meshes[id];
      throw new Error("не удалось загрузить меш: " + err.message);
    });
  }
  return App.meshes[id];
}

function setViewMode(mode) {
  App.mode = mode;
  $("colorMode").value = mode;
  App.viewers.forEach((v) => v.rebuild(mode));
}

function currentModel() { return App.models[App.modelIdx]; }

function hasMesh(r) { return !!(r && (r.has_mesh ?? r.mesh)); }

function isSmoothedResult(r) {
  const label = String(r && r.label || "");
  return label.includes("Фурье") || label.includes("соседи");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

function orderedResults(results) {
  const noiseOrder = new Map();
  results.forEach((r) => {
    const key = String(r.label || "").split(" · ")[0];
    if (!noiseOrder.has(key)) noiseOrder.set(key, noiseOrder.size);
  });
  const variantRank = (r) => {
    const label = String(r.label || "");
    let method = 6;
    if (label.includes("без сглаживания")) method = 0;
    else if (label.includes("Фурье")) method = 2;
    else if (label.includes("соседи")) method = 4;
    if (label.includes("контуры")) method += 1;
    if (label.includes("мин. многогранник")) method += 1;
    return method;
  };
  const rank = (r) => {
    if (!r || !r.id) return 1000;
    if (r.id.endsWith(":ref")) return 0;
    if (r.id.endsWith(":refmin")) return 1;
    if (r.kind === "level") return 900 + (100 - Number(r.pct || 0));
    const key = String(r.label || "").split(" · ")[0];
    const group = noiseOrder.has(key) ? noiseOrder.get(key) : 999;
    return 10 + group * 10 + variantRank(r);
  };
  return [...results].sort((a, b) => rank(a) - rank(b));
}

const DEMO_TITLES = {
  "Куб": "cube",
  "Восьмиугольная призма": "prism",
  "Октаэдр": "octa",
  "Икосаэдр": "icosa",
  "Додекаэдр": "dodeca",
  "Бриллиант": "diamond",
};

function sourceForModel(model) {
  if (!model) return null;
  if (model.source && model.source.kind) return model.source;
  const demo = DEMO_TITLES[model.name];
  return demo ? { kind: "demo", name: demo } : null;
}

function currentLiveSource() {
  if (App.liveSource) return App.liveSource;
  const model = currentModel();
  if (model) return sourceForModel(model);
  return App.sources && App.sources[0] ? App.sources[0] : null;
}

function activeViewer() {
  if (App.activeViewer && App.viewers.includes(App.activeViewer)) return App.activeViewer;
  if (App.solo && App.viewers.includes(App.solo)) return App.solo;
  return App.viewers[0] || null;
}

function setActiveViewer(v) {
  App.activeViewer = v;
  App.viewers.forEach((x) => x.card.classList.toggle("active-viewer", x === v));
  if (typeof syncPrimaryFromViewer === "function") syncPrimaryFromViewer(v);
  if (typeof selectionText === "function") selectionText();
}

async function cycleViewerResult(delta) {
  const v = activeViewer();
  if (!v || !v.select || v.select.options.length < 2) return;
  const n = v.select.options.length;
  v.select.selectedIndex = (v.select.selectedIndex + delta + n) % n;
  setActiveViewer(v);
  await loadViewer(v);
}

function fmtDur(sec) {
  const value = Math.max(0, Number(sec) || 0);
  const hundredths = Math.round(value * 100) / 100;
  if (hundredths < 60) return `${hundredths.toFixed(2)} с`;
  const h = Math.floor(hundredths / 3600);
  const m = Math.floor((hundredths % 3600) / 60);
  const s = Math.max(0, hundredths - h * 3600 - m * 60);
  const tail = `${s.toFixed(2)} с`;
  return h ? `${h} ч ${m} мин ${tail}` : `${m} мин ${tail}`;
}

function download(name, text, type = "text/plain") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1500);
}

function downloadDataUrl(name, url) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
}

function exportBase(v) {
  const label = v && v.select && v.select.selectedOptions[0]
    ? v.select.selectedOptions[0].textContent
    : "view";
  const clean = label.replace(/[^\wа-яёА-ЯЁ]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return "ogranka-" + (clean || "view");
}

function toObj(mesh, faceIndexes = null) {
  if (!faceIndexes) {
    let out = `# vertices: ${mesh.v.length}, faces: ${mesh.f.length}\n`;
    mesh.v.forEach((p) => out += `v ${p[0].toFixed(6)} ${p[1].toFixed(6)} ${p[2].toFixed(6)}\n`);
    mesh.f.forEach((f) => out += "f " + f.map((i) => i + 1).join(" ") + "\n");
    return out;
  }
  const faces = faceIndexes.map((i) => mesh.f[i]).filter(Boolean);
  const remap = new Map();
  const verts = [];
  faces.forEach((f) => f.forEach((i) => {
    if (remap.has(i)) return;
    remap.set(i, verts.length);
    verts.push(mesh.v[i]);
  }));
  let out = `# vertices: ${verts.length}, faces: ${faces.length}\n`;
  verts.forEach((p) => out += `v ${p[0].toFixed(6)} ${p[1].toFixed(6)} ${p[2].toFixed(6)}\n`);
  faces.forEach((f) => out += "f " + f.map((i) => remap.get(i) + 1).join(" ") + "\n");
  return out;
}

function pointInRect2D(p, r) {
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

function pointInPoly2D(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y)) {
      const t = (p.y - a.y) / (b.y - a.y || 1e-12);
      if (p.x < a.x + t * (b.x - a.x)) inside = !inside;
    }
  }
  return inside;
}

function orient2D(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsCross(a, b, c, d) {
  const d1 = orient2D(a, b, c), d2 = orient2D(a, b, d);
  const d3 = orient2D(c, d, a), d4 = orient2D(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function segmentIntersection2D(a, b, c, d) {
  const d1 = orient2D(a, b, c), d2 = orient2D(a, b, d);
  const d3 = orient2D(c, d, a), d4 = orient2D(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    const t = d1 / (d1 - d2);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  return null;
}

function polyRectHit(points, rect) {
  if (!points.length) return false;
  if (points.some((p) => pointInRect2D(p, rect))) return true;
  const corners = [
    { x: rect.left, y: rect.top }, { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom }, { x: rect.left, y: rect.bottom },
  ];
  if (corners.some((c) => pointInPoly2D(c, points))) return true;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    for (let j = 0; j < 4; j++) {
      if (segmentsCross(a, b, corners[j], corners[(j + 1) % 4])) return true;
    }
  }
  return false;
}

