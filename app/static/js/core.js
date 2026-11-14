/* App state and common geometry helpers. */
const App = {
  sources: [{ kind: "demo", name: "octa" }],
  liveSource: null,
  models: [],
  modelIdx: 0,
  meshes: {},
  mode: "solid_edges",
  solo: null,
  syncCam: true,
  camLock: false,
  sel: { points: [], polys: [], mode: "face", anchor: null, ids: [] },
  selTarget: "face",
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
  return `<span class="badge ${q}">${t}</span>`;
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

function areaColor(t) {
  const a = new THREE.Color(0x3f7bff), b = new THREE.Color(0xff9f43);
  return a.clone().lerp(b, Math.min(1, Math.max(0, t)));
}

// ---------------------------------------------------------------- окна

async function meshOf(id) {
  if (!App.meshes[id]) {
    const r = await fetch("/api/mesh?id=" + encodeURIComponent(id));
    if (!r.ok) throw new Error("не удалось загрузить меш");
    App.meshes[id] = await r.json();
  }
  return App.meshes[id];
}

function setViewMode(mode) {
  App.mode = mode;
  $("colorMode").value = mode;
  App.viewers.forEach((v) => v.rebuild(mode));
}

function currentModel() { return App.models[App.modelIdx]; }

function orderedResults(results) {
  const rank = (r) => {
    if (!r || !r.id) return 1000;
    if (r.id.endsWith(":ref")) return 0;
    if (r.id.endsWith(":refmin")) return 1;
    const m = r.id.match(/:v(\d+)(m)?$/);
    return m ? 2 + Number(m[1]) * 2 + (m[2] ? 1 : 0) : 1000;
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
  if (App.solo && App.viewers.includes(App.solo)) return App.solo;
  if (App.activeViewer && App.viewers.includes(App.activeViewer)) return App.activeViewer;
  return App.viewers[0] || null;
}

function setActiveViewer(v) {
  App.activeViewer = v;
  App.viewers.forEach((x) => x.card.classList.toggle("active-viewer", x === v));
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
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function download(name, text, type = "text/plain") {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function toObj(mesh) {
  let out = `# vertices: ${mesh.v.length}, faces: ${mesh.f.length}\n`;
  mesh.v.forEach((p) => out += `v ${p[0].toFixed(6)} ${p[1].toFixed(6)} ${p[2].toFixed(6)}\n`);
  mesh.f.forEach((f) => out += "f " + f.map((i) => i + 1).join(" ") + "\n");
  return out;
}

