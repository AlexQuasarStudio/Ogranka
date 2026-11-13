const App = {
  sources: [{ kind: "demo", name: "octa" }],
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
  poll: null,
  partialDone: 0,
  uploading: false,
  colPct: 50,
  soloPrevH: null,
  liveTimer: null,
  liveSeq: 0,
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

class Viewer {
  constructor(card, onPick, onCam) {
    this.card = card;
    this.select = card.querySelector(".vsel");
    this.meta = card.querySelector(".vmeta");
    this.canvas = card.querySelector("canvas");
    this.onPick = onPick;
    this.onCam = onCam;

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f141c);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
    this.camera.up.set(0, 0, 1);
    this.controls = new THREE.OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.62));
    const l1 = new THREE.DirectionalLight(0xffffff, 0.85); l1.position.set(5, -8, 10); this.scene.add(l1);
    const l2 = new THREE.DirectionalLight(0x88bbff, 0.4); l2.position.set(-6, 5, -4); this.scene.add(l2);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.controls.addEventListener("change", () => this.onCam(this));

    this.mesh = null;
    this.faces = [];
    this.verts = [];
    this.triFace = [];
    this.faceCentroids = [];
    this.solid = null;
    this.pointsObj = null;
    this.hlFaces = new Set();
    this.hlVerts = new Set();
    this.mode = "solid_edges";
    this.selTarget = "face";

    this.hudCur = card.querySelector(".cur");
    card.querySelectorAll(".ax").forEach((b) => b.onclick = () => this.alignAxis(b.dataset.a));
    this.canvas.addEventListener("pointermove", (e) => this.cursorInfo(e));

    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Points.threshold = 0.05;
    this.down = null;
    this.canvas.addEventListener("pointerdown", (e) => {
      this.down = { x: e.clientX, y: e.clientY, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
    });
    this.canvas.addEventListener("pointerup", (e) => {
      if (!this.down) return;
      if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 5) {
        this.pick(e.clientX, e.clientY, this.down.shift, this.down.ctrl);
      }
      this.down = null;
    });

    new ResizeObserver(() => this.resize()).observe(this.canvas.parentElement);
    this.resize();
    const loop = () => { requestAnimationFrame(loop); this.controls.update(); this.renderer.render(this.scene, this.camera); };
    loop();
  }

  resize() {
    const el = this.canvas.parentElement;
    const w = Math.max(120, el.clientWidth), h = Math.max(120, el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.lineMat) this.lineMat.resolution.set(w, h);
  }

  clear() {
    while (this.group.children.length) {
      const c = this.group.children.pop();
      c.geometry && c.geometry.dispose();
      c.material && c.material.dispose();
    }
    this.solid = null;
    this.pointsObj = null;
  }

  setMesh(mesh, mode, keepView = false) {
    this.mesh = mesh;
    this.mode = mode;
    this.clear();
    if (!mesh || !mesh.v || !mesh.f) return;
    if (!keepView) this.frame(mesh);
    this.rebuild(mode);
  }

  rebuild(mode) {
    if (!this.mesh) return;
    this.mode = mode;
    this.clear();
    this.build(this.mesh, mode);
  }

  build(mesh, mode) {
    const v = mesh.v, faces = mesh.f;
    this.verts = v;
    this.faces = faces;
    const tris = [], triFace = [];
    faces.forEach((f, fi) => {
      const ft = triangulateFace(f, v);
      for (const t of ft) { tris.push(t); triFace.push(fi); }
    });
    this.triFace = triFace;
    this.faceCentroids = faces.map((f) => {
      let x = 0, y = 0, z = 0;
      f.forEach((i) => { x += v[i][0]; y += v[i][1]; z += v[i][2]; });
      return [x / f.length, y / f.length, z / f.length];
    });
    this.facePolys = faces.map((f) => f.map((i) => v[i]));
    this.faceRadii = this.facePolys.map((poly, fi) => {
      const c = this.faceCentroids[fi];
      let r = 0;
      poly.forEach((p) => { r = Math.max(r, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])); });
      return r;
    });

    this.faceAdj = Array.from({ length: faces.length }, () => []);
    const edgeOwner = new Map();
    faces.forEach((f, fi) => {
      for (let i = 0; i < f.length; i++) {
        const a = f[i], b = f[(i + 1) % f.length];
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        if (edgeOwner.has(key)) {
          const fj = edgeOwner.get(key);
          if (fj !== fi) { this.faceAdj[fi].push(fj); this.faceAdj[fj].push(fi); }
        } else {
          edgeOwner.set(key, fi);
        }
      }
    });
    this.vertAdj = Array.from({ length: v.length }, () => []);
    const vEdges = new Set();
    faces.forEach((f) => {
      for (let i = 0; i < f.length; i++) {
        const a = f[i], b = f[(i + 1) % f.length];
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        if (!vEdges.has(key)) {
          vEdges.add(key);
          this.vertAdj[a].push(b);
          this.vertAdj[b].push(a);
        }
      }
    });

    const pos = new Float32Array(tris.length * 9);
    const col = new Float32Array(tris.length * 9);
    const faceColor = faces.map((_, i) => new THREE.Color().setHSL((i * 0.61803398875) % 1, 0.55, 0.58));
    const areas = faces.map((f) => polyArea3(v, f));
    const amax = Math.max(...areas, 1e-9);
    const hl = new THREE.Color(0xffb347);

    tris.forEach((t, ti) => {
      const fi = triFace[ti];
      for (let j = 0; j < 3; j++) {
        const p = v[t[j]];
        pos.set([p[0], p[1], p[2]], ti * 9 + j * 3);
        let c;
        if (this.hlFaces.has(fi)) c = hl;
        else if (mode === "face") c = faceColor[fi];
        else if (mode === "area") c = areaColor(areas[fi] / amax);
        else c = new THREE.Color(0x8fc1ff);
        col.set([c.r, c.g, c.b], ti * 9 + j * 3);
      }
    });

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const useColors = mode === "face" || mode === "area" || this.hlFaces.size > 0;
    if (useColors) geom.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geom.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: 0x8fc1ff, vertexColors: useColors, roughness: 0.55, metalness: 0.05,
      flatShading: true, side: THREE.DoubleSide,
      wireframe: false, transparent: false, opacity: 1,
    });
    this.solid = new THREE.Mesh(geom, material);
    this.solid.visible = mode !== "edges" && mode !== "points" && mode !== "wire";
    this.group.add(this.solid);

    if (mode === "edges" || mode === "solid_edges" || mode === "wire") {
      const segs = [];
      if (mode === "wire") {
        tris.forEach((t) => {
          for (let i = 0; i < 3; i++) {
            const a = v[t[i]], b = v[t[(i + 1) % 3]];
            segs.push(a[0], a[1], a[2], b[0], b[1], b[2]);
          }
        });
      } else {
        faces.forEach((f) => {
          for (let i = 0; i < f.length; i++) {
            const a = v[f[i]], b = v[f[(i + 1) % f.length]];
            segs.push(a[0], a[1], a[2], b[0], b[1], b[2]);
          }
        });
      }
      if (THREE.LineSegments2 && THREE.LineMaterial) {
        const lg = new THREE.LineSegmentsGeometry().setPositions(segs);
        const lw = mode === "wire" ? 0.8 : (mode === "edges" ? 0.9 : 2.4);
        const lc = mode === "wire" ? 0x9fd8ff : (mode === "edges" ? 0x9fd8ff : 0x000000);
        const lm = new THREE.LineMaterial({ color: lc, linewidth: lw });
        const el = this.canvas.parentElement;
        lm.resolution.set(Math.max(1, el.clientWidth), Math.max(1, el.clientHeight));
        this.lineMat = lm;
        this.group.add(new THREE.LineSegments2(lg, lm));
      } else {
        const lg = new THREE.BufferGeometry();
        lg.setAttribute("position", new THREE.Float32BufferAttribute(segs, 3));
        this.group.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: lc })));
      }
    }

    if (mode === "points" || this.selTarget === "vertex") {
      const pg = new THREE.BufferGeometry();
      pg.setAttribute("position", new THREE.Float32BufferAttribute(v.flat(), 3));
      this.pointsObj = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0x9fd8ff, size: mode === "points" ? 0.035 : 0.02 }));
      this.group.add(this.pointsObj);
    }

    const sel = [...this.hlVerts];
    if (sel.length) {
      const sg = new THREE.BufferGeometry();
      sg.setAttribute("position", new THREE.Float32BufferAttribute(sel.flatMap((i) => v[i]), 3));
      this.group.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffb347, size: 0.06 })));
    }
  }

  pick(x, y, shift, ctrl) {
    if (!this.mesh) return;
    this.camera.updateMatrixWorld(true);
    if (this.solid) this.solid.updateMatrixWorld(true);
    const rect = this.canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(mouse, this.camera);
    const action = ctrl ? "toggle" : (shift ? "path" : "replace");

    if (this.selTarget === "vertex" || this.pointsObj) {
      const hits = this.raycaster.intersectObject(this.pointsObj);
      if (!this.pointsObj) return;
      if (!hits.length) { if (action === "replace") this.onPick(this, null, "vert", "clear"); return; }
      this.onPick(this, this.verts[hits[0].index].slice(), "vert", action, null, hits[0].index);
      return;
    }
    const hits = this.raycaster.intersectObject(this.solid);
    if (!hits.length) { if (action === "replace") this.onPick(this, null, "face", "clear"); return; }
    const fi = this.triFace[hits[0].faceIndex];
    const poly = this.facePolys[fi].map((p) => p.slice());
      this.onPick(this, this.faceCentroids[fi].slice(), "face", action, poly, fi);
  }

  applySelection(points, mode, polys = [], ids = []) {
    this.hlFaces = new Set();
    this.hlVerts = new Set();
    if (points.length && this.mesh) {
      const mappedPoints = [];
      const mappedPolys = [];
      const exactFaces = [];
      const exactVerts = [];
      for (let i = 0; i < points.length; i++) {
        const id = ids && ids[i];
        const total = mode === "face" ? this.faceCentroids.length : this.verts.length;
        if (id && id.viewer === this && id.type === mode && id.index >= 0 && id.index < total) {
          if (mode === "face") exactFaces.push(id.index);
          else exactVerts.push(id.index);
        } else {
          mappedPoints.push(points[i]);
          mappedPolys.push(polys[i] || null);
        }
      }
      if (mode === "face") {
        exactFaces.forEach((fi) => this.hlFaces.add(fi));
        if (mappedPoints.length) {
          const regions = mappedPolys.filter(Boolean);
          const infos = regions.map((poly) => {
            let x = 0, y = 0, z = 0;
            poly.forEach((p) => { x += p[0]; y += p[1]; z += p[2]; });
            const cc = [x / poly.length, y / poly.length, z / poly.length];
            let rr = 0;
            poly.forEach((p) => { rr = Math.max(rr, Math.hypot(p[0] - cc[0], p[1] - cc[1], p[2] - cc[2])); });
            return { cc, rr };
          });
          for (let fi = 0; fi < this.faceCentroids.length; fi++) {
            const c = this.faceCentroids[fi];
            let hit = false;
            for (let ri = 0; ri < regions.length; ri++) {
              const poly = regions[ri], info = infos[ri];
              if (Math.hypot(c[0] - info.cc[0], c[1] - info.cc[1], c[2] - info.cc[2]) > info.rr + TOL) continue;
              if (pointInPoly(c, poly, TOL)) { hit = true; break; }
            }
            if (!hit && this.facePolys) {
              const r = this.faceRadii[fi] + TOL;
              for (const p of mappedPoints) {
                if (Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]) > r) continue;
                if (pointInPoly(p, this.facePolys[fi], TOL)) { hit = true; break; }
              }
            }
            if (!hit && !regions.length) {
              for (const p of mappedPoints) if (near(c, p)) { hit = true; break; }
            }
            if (hit) this.hlFaces.add(fi);
          }
        }
      } else {
        exactVerts.forEach((i) => this.hlVerts.add(i));
        if (mappedPoints.length) {
          const dist2 = (a, p) => (a[0] - p[0]) ** 2 + (a[1] - p[1]) ** 2 + (a[2] - p[2]) ** 2;
          const small = mappedPoints.length <= 200;
          mappedPoints.forEach((p) => {
            let found = false;
            this.verts.forEach((c, i) => {
              if (near(c, p)) { this.hlVerts.add(i); found = true; }
            });
            if (!found && small && this.verts.length) {
              let best = -1, bd = Infinity;
              this.verts.forEach((c, i) => { const d = dist2(c, p); if (d < bd) { bd = d; best = i; } });
              if (best >= 0) this.hlVerts.add(best);
            }
          });
        }
      }
    }
    this.rebuild(this.mode);
  }

  bfsPath(adj, start, end) {
    if (start === end) return [start];
    const prev = new Int32Array(adj.length).fill(-1);
    const seen = new Uint8Array(adj.length);
    const queue = [start];
    seen[start] = 1;
    for (let qi = 0; qi < queue.length; qi++) {
      const u = queue[qi];
      if (u === end) break;
      for (const v of adj[u] || []) {
        if (!seen[v]) { seen[v] = 1; prev[v] = u; queue.push(v); }
      }
    }
    if (!seen[end]) return [end];
    const path = [];
    let cur = end;
    while (cur !== -1 && cur !== start) { path.push(cur); cur = prev[cur]; }
    path.push(start);
    return path.reverse();
  }

  pathFaces(start, end) { return this.bfsPath(this.faceAdj, start, end); }
  pathVerts(start, end) { return this.bfsPath(this.vertAdj, start, end); }

  alignAxis(axis) {
    const c = this.controls.target.clone();
    const r = this.camera.position.distanceTo(c) || 3;
    if (axis === "x") { this.camera.up.set(0, 0, 1); this.camera.position.set(c.x + r, c.y, c.z); }
    else if (axis === "y") { this.camera.up.set(0, 0, 1); this.camera.position.set(c.x, c.y - r, c.z); }
    else { this.camera.up.set(0, 1, 0); this.camera.position.set(c.x, c.y, c.z + r); }
    this.camera.lookAt(c);
    this.controls.update();
    this.onCam(this);
  }

  cursorInfo(e) {
    if (!this.mesh || !this.solid) return;
    const now = performance.now();
    if (now - (this._lastMove || 0) < 80) return;
    this._lastMove = now;
    const rect = this.canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1,
                                    -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(mouse, this.camera);
    const hits = this.raycaster.intersectObject(this.solid);
    this.hudCur.textContent = hits.length
      ? hits[0].point.toArray().map((v) => v.toFixed(2)).join(", ")
      : "—";
  }

  copyCamera(src) {
    this.camera.position.copy(src.camera.position);
    this.camera.up.copy(src.camera.up);
    this.controls.target.copy(src.controls.target);
    this.controls.update();
  }

  frame(mesh) {
    const v = mesh.v;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    v.forEach((p) => p.forEach((x, i) => { min[i] = Math.min(min[i], x); max[i] = Math.max(max[i], x); }));
    const c = min.map((m, i) => (m + max[i]) / 2);
    const r = Math.max(0.5, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
    this.camera.position.set(c[0] + r * 2.1, c[1] - r * 2.4, c[2] + r * 1.7);
    this.controls.target.set(c[0], c[1], c[2]);
    this.camera.near = r / 50; this.camera.far = r * 60;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }
}

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

function makeCard() {
  const card = document.createElement("div");
  card.className = "viewer-card";
  card.innerHTML = `<div class="viewer-head"><select class="vsel"></select><span class="vmeta meta"></span><button class="vmax" title="Развернуть этот вьюпорт">⤢</button></div>
                    <div class="canvas-wrap"><canvas></canvas>
                      <div class="hud">
                        <div class="axes"><button class="ax x" data-a="x" title="Вид вдоль X">X</button><button class="ax y" data-a="y" title="Вид вдоль Y">Y</button><button class="ax z" data-a="z" title="Вид вдоль Z">Z</button></div>
                        <div class="cur">—</div>
                      </div>
                    </div>`;
  $("viewers").appendChild(card);
  return card;
}

function ensureSplitV() {
  if (!App.splitV) {
    App.splitV = document.createElement("div");
    App.splitV.className = "split-v";
    App.splitV.title = "Потяните, чтобы изменить ширину окон";
    App.splitV.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      App.splitV.setPointerCapture(e.pointerId);
      const el = $("viewers");
      const r = el.getBoundingClientRect();
      const move = (ev) => {
        App.colPct = Math.min(80, Math.max(20, (ev.clientX - r.left) / r.width * 100));
        el.style.gridTemplateColumns = `${App.colPct}% 10px 1fr`;
      };
      const up = () => {
        App.splitV.removeEventListener("pointermove", move);
        App.splitV.removeEventListener("pointerup", up);
      };
      App.splitV.addEventListener("pointermove", move);
      App.splitV.addEventListener("pointerup", up);
    });
  }
  return App.splitV;
}

function layoutViewers() {
  const el = $("viewers");
  const n = App.viewers.length;
  if (App.solo) {
    el.style.gridTemplateColumns = "1fr";
    if (App.splitV) App.splitV.style.display = "none";
    return;
  }
  if (n === 2) {
    const sp = ensureSplitV();
    el.insertBefore(sp, App.viewers[1].card);
    sp.style.display = "block";
    el.style.gridTemplateColumns = `${App.colPct}% 10px 1fr`;
    return;
  }
  if (App.splitV) App.splitV.style.display = "none";
  const cols = n <= 2 ? n : (n <= 4 ? 2 : 3);
  el.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
}

function toggleSolo(v) {
  const wasSolo = !!App.solo;
  const next = App.solo === v ? null : v;
  if (!wasSolo && next) {
    App.soloPrevH = document.documentElement.style.getPropertyValue("--viewer-h");
    document.documentElement.style.setProperty("--viewer-h", "72%");
  } else if (wasSolo && !next) {
    if (App.soloPrevH) document.documentElement.style.setProperty("--viewer-h", App.soloPrevH);
    else document.documentElement.style.removeProperty("--viewer-h");
    App.soloPrevH = null;
  }
  App.solo = next;
  App.viewers.forEach((x) => x.card.classList.toggle("is-solo", x === App.solo));
  $("viewers").classList.toggle("solo", !!App.solo);
  document.querySelector(".workspace").classList.toggle("solo-mode", !!App.solo);
  layoutViewers();
  if (App.solo) App.solo.resize();
}

function addViewer() {
  if (App.viewers.length >= 6) return;
  const card = makeCard();
  const v = new Viewer(card, handlePick, handleCam);
  card.querySelector(".vmax").onclick = () => toggleSolo(v);
  App.viewers.push(v);
  populateViewer(v, App.viewers.length - 1);
  if (App.models.length) loadViewer(v).then(() => v.applySelection(App.sel.points, App.sel.mode, App.sel.polys, App.sel.ids));
  if (App.viewers.length > 1) v.copyCamera(App.viewers[0]);
  layoutViewers();
  v.select.onchange = () => loadViewer(v);
  return v;
}

function removeViewer() {
  if (App.viewers.length <= 2) return;
  const v = App.viewers.pop();
  v.card.remove();
  layoutViewers();
  selectionText();
}

function populateViewer(v, idx) {
  const model = App.models[App.modelIdx];
  if (!model) return;
  const results = model.results;
  v.select.innerHTML = results.map((r) => `<option value="${r.id}">${r.label}</option>`).join("");
  if (model.levels) {
    const cand = results.filter((r) => r.mesh);
    const pick = cand[Math.min(idx, cand.length - 1)] || cand[0];
    v.select.value = (pick || results[0]).id;
    return;
  }
  let pick = null;
  if (idx === 0) {
    pick = results.find((r) => r.id.endsWith(":ref"));
  } else if (idx === 1) {
    const cand = results.filter((r) => r.mesh && !r.id.includes(":ref") && r.metrics && r.metrics.mse != null);
    cand.sort((a, b) => a.metrics.mse - b.metrics.mse);
    pick = cand[0];
  } else {
    pick = results.filter((r) => r.mesh && !r.id.includes(":ref"))[idx - 1] ||
           results.filter((r) => r.mesh)[0];
  }
  v.select.value = (pick || results[0]).id;
}

async function loadViewer(v) {
  App.sel.anchor = null;
  App.sel.ids = [];
  const id = v.select.value;
  if (!id) return;
  const r = await meshOf(id);
  v.setMesh(r.mesh, App.mode, !!v.mesh);
  const m = r.metrics || {};
  v.meta.innerHTML = `${badge(r.quality)} MSE ${fmt(m.mse)} · RMSE ${fmt(m.rmse)} · dmax ${fmt(m.dmax)} · ${r.time != null ? r.time + " с" : "—"}`;
  updateDiff();
  selectionText();
}

async function loadAllViewers() {
  for (const v of App.viewers) await loadViewer(v);
  App.viewers.forEach((v) => v.applySelection(App.sel.points, App.sel.mode, App.sel.polys, App.sel.ids));
}

function handlePick(src, point, type, action, poly, index) {
  if (!App.sel.polys) App.sel.polys = [];
  if (App.sel.mode !== type) App.sel = { points: [], polys: [], mode: type, anchor: null, ids: [] };
  if (!("anchor" in App.sel)) App.sel.anchor = null;
  if (!App.sel.ids) App.sel.ids = [];
  const keyOf = (p) => p.map((x) => x.toFixed(6)).join(",");
  const anchor = App.sel.anchor;

  if (action === "clear") {
    App.sel.points = [];
    App.sel.polys = [];
    App.sel.ids = [];
    App.sel.anchor = null;
  } else if (action === "path" && src && index != null) {
    if (!anchor || anchor.viewer !== src || anchor.type !== type) {
      App.sel.points = [point];
      App.sel.polys = [poly || null];
      App.sel.ids = [{ viewer: src, type, index }];
    } else {
      const path = type === "face" ? src.pathFaces(anchor.index, index) : src.pathVerts(anchor.index, index);
      const keys = new Set(App.sel.points.map(keyOf));
      path.forEach((fi) => {
        const p = type === "face" ? src.faceCentroids[fi].slice() : src.verts[fi].slice();
        const k = keyOf(p);
        if (keys.has(k)) return;
        keys.add(k);
        App.sel.points.push(p);
        App.sel.polys.push(type === "face" ? src.facePolys[fi].map((q) => q.slice()) : null);
        App.sel.ids.push({ viewer: src, type, index: fi });
      });
    }
    App.sel.anchor = { viewer: src, type, index };
  } else if (action === "replace") {
    App.sel.points = [point];
    App.sel.polys = [poly || null];
    App.sel.ids = [{ viewer: src, type, index }];
    App.sel.anchor = { viewer: src, type, index };
  } else if (action === "add") {
    App.sel.points.push(point);
    App.sel.polys.push(poly || null);
    App.sel.ids.push({ viewer: src, type, index });
    App.sel.anchor = { viewer: src, type, index };
  } else if (action === "toggle") {
    const i = App.sel.points.findIndex((p) => near(p, point));
    if (i >= 0) {
      App.sel.points.splice(i, 1);
      App.sel.polys.splice(i, 1);
      App.sel.ids.splice(i, 1);
      if (App.sel.anchor && App.sel.anchor.index === index) App.sel.anchor = null;
    } else {
      App.sel.points.push(point);
      App.sel.polys.push(poly || null);
      App.sel.ids.push({ viewer: src, type, index });
      App.sel.anchor = { viewer: src, type, index };
    }
  }
  broadcastSelection();
}

function broadcastSelection() {
  App.viewers.forEach((v) => v.applySelection(App.sel.points, App.sel.mode, App.sel.polys, App.sel.ids));
  selectionText();
}

function selectionText() {
  if (!App.sel.points.length) {
    $("selectionInfo").textContent = "Выделение: —";
    return;
  }
  const parts = App.viewers.map((v, i) => {
    const n = App.sel.mode === "face" ? v.hlFaces.size : v.hlVerts.size;
    return `окно ${i + 1}: ${n}`;
  });
  const what = App.sel.mode === "face" ? "граней" : "вершин";
  $("selectionInfo").textContent =
    `Выделено точек: ${App.sel.points.length} (${what}) · ` + parts.join(" · ");
}

function handleCam(src) {
  if (!App.syncCam || App.camLock) return;
  App.camLock = true;
  App.viewers.forEach((v) => { if (v !== src) v.copyCamera(src); });
  App.camLock = false;
}

// ---------------------------------------------------------------- модель и результаты

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

function cycleModel(delta) {
  if (App.models.length < 2) return;
  const n = App.models.length;
  App.modelIdx = (App.modelIdx + delta + n) % n;
  App.liveSeq++;
  clearTimeout(App.liveTimer);
  $("modelSel").value = String(App.modelIdx);
  renderModel();
}

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
  App.viewers.forEach((v, i) => populateViewer(v, i));
  renderTable(model.results);
  App.viewers.forEach((v) => { v.select.onchange = () => loadViewer(v); });
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

function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
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

function liveMethod() {
  if ($("mFft").checked) return "fft";
  if ($("mUni").checked) return "uni";
  return "none";
}

function updateLiveLabels() {
  $("liveNoiseVal").textContent = (+$("liveNoise").value).toFixed(3);
  $("liveSimplifyVal").textContent = Math.round(+$("liveSimplify").value) + "%";
}

function scheduleLive() {
  updateLiveLabels();
  clearTimeout(App.liveTimer);
  App.liveTimer = setTimeout(runLive, 280);
}

async function runLive() {
  const src = App.sources && App.sources[0];
  if (!src) return;
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
    if (JSON.stringify(App.sources[0]) !== srcKey) return;
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

const TOUR_KEY = "ogranka.tour.v1";
const TOUR_STEPS = [
  {
    title: "Добро пожаловать в «Огранку»",
    text: "Версия 1.0.0. Приложение восстанавливает форму по зашумлённым горизонтальным сечениям. Короткий тур покажет основные элементы.",
  },
  {
    title: "Модель",
    text: "Выберите демо-тело, файлы OBJ/TXT или папку с моделями. Куб и призма — в верхнем ряду.",
    target: ".demo-grid",
  },
  {
    title: "Шум и упрощение",
    text: "Двигайте ползунки: второе окно пересчитывается без запуска конвейера. «Упрощение» — сколько процентов убрать.",
    target: "#liveNoise",
  },
  {
    title: "Запуск",
    text: "Кнопка запускает полный расчёт с выбранными шумами и методами. После него появятся метрики и время.",
    target: "#runBtn",
  },
  {
    title: "Вьюпорты",
    text: "Окна сравнения моделей. Кнопка ⤢ разворачивает вьюпорт; F или Esc возвращают сетку. Высоту можно менять разделителем.",
    target: "#viewers",
  },
  {
    title: "Выделение",
    text: "Клик — одна грань, Shift — путь, Ctrl — добавить или убрать. Режим отображения — на нижней панели.",
    target: ".toolbar",
  },
  {
    title: "Результаты и время",
    text: "В таблицах есть столбец «время», под окнами — время варианта, а в шапке после расчёта — общее время.",
    target: "#metricsTable",
  },
  {
    title: "Готово",
    text: "Тур можно пройти снова из окна «О программе». Очистка кеша тоже сбрасывает приветствие.",
  },
];

function tourSeen() {
  try { return localStorage.getItem(TOUR_KEY) === "1"; } catch (e) { return false; }
}

function markTourSeen() {
  try { localStorage.setItem(TOUR_KEY, "1"); } catch (e) { /* ignore */ }
}

function resetTourSeen() {
  try { localStorage.removeItem(TOUR_KEY); } catch (e) { /* ignore */ }
}

function positionTour(target) {
  const tour = $("tour"), hole = $("tourHole"), card = $("tourCard");
  const margin = 12;
  const cw = card.offsetWidth || 390;
  const ch = card.offsetHeight || 240;
  if (!target || !target.getClientRects().length) {
    tour.classList.add("dim");
    hole.hidden = true;
    card.style.left = Math.max(margin, (window.innerWidth - cw) / 2) + "px";
    card.style.top = Math.max(margin, (window.innerHeight - ch) / 2) + "px";
    return;
  }
  tour.classList.remove("dim");
  hole.hidden = false;
  const r = target.getBoundingClientRect();
  const pad = 6;
  hole.style.left = (r.left - pad) + "px";
  hole.style.top = (r.top - pad) + "px";
  hole.style.width = (r.width + pad * 2) + "px";
  hole.style.height = (r.height + pad * 2) + "px";
  let left = r.right + 16;
  if (left + cw > window.innerWidth - margin) left = r.left - cw - 16;
  if (left < margin) left = Math.max(margin, (window.innerWidth - cw) / 2);
  const top = Math.max(margin, Math.min(window.innerHeight - ch - margin, r.top));
  card.style.left = left + "px";
  card.style.top = top + "px";
}

function showTourStep(i) {
  App.tourStep = i;
  const step = TOUR_STEPS[i];
  $("tourStepLabel").textContent = i === 0 ? "Приветствие" : `Шаг ${i} из ${TOUR_STEPS.length - 1}`;
  $("tourTitle").textContent = step.title;
  $("tourText").textContent = step.text;
  $("tourPrev").disabled = i === 0;
  $("tourNext").textContent = i === TOUR_STEPS.length - 1 ? "Готово" : (i === 0 ? "Начать" : "Далее");
  const target = step.target ? document.querySelector(step.target) : null;
  if (target) target.scrollIntoView({ block: "center", inline: "nearest" });
  const stepIndex = i;
  setTimeout(() => { if (App.tourStep === stepIndex) positionTour(target); }, 50);
}

function startTour(force = false) {
  if (!force && tourSeen()) return;
  $("helpModal").classList.add("hidden");
  $("aboutModal").classList.add("hidden");
  $("tour").classList.remove("hidden");
  showTourStep(0);
}

function finishTour() {
  $("tour").classList.add("hidden");
  $("tour").classList.remove("dim");
  $("tourHole").hidden = true;
  markTourSeen();
  App.tourStep = 0;
}

function init() {
  addViewer();
  addViewer();
  layoutViewers();

  document.querySelectorAll(".demo").forEach((b) => b.onclick = () => {
    document.querySelectorAll(".demo").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    App.sources = [{ kind: "demo", name: b.dataset.demo }];
    $("fileName").textContent = "демо: " + b.textContent.toLowerCase();
    $("harm").value = 12;
  });

  $("fileInput").onchange = (e) => setFiles(e.target.files, false);
  $("dirInput").onchange = (e) => setFiles(e.target.files, true);
  $("levelsBtn").onclick = async () => {
    const src = App.sources && App.sources[0];
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
  $("fsBtn").onclick = () => {
    const v = App.solo || App.viewers[0];
    if (v) toggleSolo(v);
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
    App.models = []; App.meshes = {}; App.partialDone = 0;
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
      cycleModel(e.code === "BracketRight" ? 1 : -1);
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
