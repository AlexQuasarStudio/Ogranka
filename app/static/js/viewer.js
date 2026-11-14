/* Three.js viewer, selection and viewport layout. */
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
function makeCard() {
  const card = document.createElement("div");
  card.className = "viewer-card";
  card.innerHTML = `<div class="viewer-head"><select class="vsel"></select><span class="vmeta meta"></span><button class="vmax" title="Развернуть этот вьюпорт на всё окно">⤢</button></div>
                    <div class="canvas-wrap"><canvas></canvas>
                      <div class="hud">
                        <div class="axes"><button class="ax x" data-a="x" title="Вид вдоль X" aria-label="Вид вдоль X">→</button><button class="ax y" data-a="y" title="Вид вдоль Y" aria-label="Вид вдоль Y">↗</button><button class="ax z" data-a="z" title="Вид вдоль Z" aria-label="Вид вдоль Z">↑</button></div>
                        <div class="cur">—</div>
                      </div>
                      <div class="vsliders" aria-label="Живой предпросмотр">
                        <label>шум <input class="dock-noise" type="range" min="0" max="0.1" step="0.002"><output class="dock-noise-val">0.008</output></label>
                        <label>упрощение <input class="dock-simplify" type="range" min="0" max="85" step="1"><output class="dock-simplify-val">0%</output></label>
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
  document.body.classList.toggle("viewer-full", !!App.solo);
  layoutViewers();
  if (App.solo) App.solo.resize();
}

function addViewer() {
  if (App.viewers.length >= 6) return;
  const card = makeCard();
  const v = new Viewer(card, handlePick, handleCam);
  card.querySelector(".vmax").onclick = () => toggleSolo(v);
  card.querySelector(".dock-noise").oninput = (e) => {
    $("liveNoise").value = e.target.value;
    scheduleLive();
  };
  card.querySelector(".dock-simplify").oninput = (e) => {
    $("liveSimplify").value = e.target.value;
    scheduleLive();
  };
  card.addEventListener("pointerdown", () => setActiveViewer(v));
  App.viewers.push(v);
  populateViewer(v, App.viewers.length - 1);
  if (App.models.length) loadViewer(v).then(() => v.applySelection(App.sel.points, App.sel.mode, App.sel.polys, App.sel.ids));
  if (App.viewers.length > 1) v.copyCamera(App.viewers[0]);
  layoutViewers();
  syncLiveDocks();
  v.select.onchange = () => { setActiveViewer(v); loadViewer(v); };
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

