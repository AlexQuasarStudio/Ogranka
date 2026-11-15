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
    this.setupGizmo(card);
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
    const loop = () => {
      requestAnimationFrame(loop);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.renderGizmo();
    };
    loop();
  }

  resize() {
    const el = this.canvas.parentElement;
    const w = Math.max(120, el.clientWidth), h = Math.max(120, el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.lineMat) this.lineMat.resolution.set(w, h);
    this.resizeGizmo();
  }

  setupGizmo(card) {
    const canvas = card.querySelector(".gizmo");
    if (!canvas) return;
    this.gizmoCanvas = canvas;
    this.gizmoRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.gizmoRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gizmoRenderer.setClearColor(0x000000, 0);
    this.gizmoScene = new THREE.Scene();
    this.gizmoCamera = new THREE.OrthographicCamera(-1.25, 1.25, 1.25, -1.25, 0.1, 20);
    this.gizmoCamera.position.set(0, 0, 4);
    this.gizmoCamera.lookAt(0, 0, 0);
    this.gizmoScene.add(new THREE.AmbientLight(0xffffff, 1.25));
    const gl = new THREE.DirectionalLight(0xffffff, 0.75);
    gl.position.set(-2, -3, 4);
    this.gizmoScene.add(gl);
    this.gizmoGroup = new THREE.Group();
    this.gizmoMeshes = [];
    this.gizmoMats = {};
    const specs = [
      ["x", 0xff6b6b, -Math.PI / 2, 0],
      ["y", 0x6bff9d, 0, 0],
      ["z", 0x6ba8ff, 0, Math.PI / 2],
    ];
    specs.forEach(([axis, color, rz, rx]) => {
      const mat = new THREE.MeshStandardMaterial({
        color, roughness: 0.32, metalness: 0.18, emissive: color, emissiveIntensity: 0.12,
      });
      this.gizmoMats[axis] = mat;
      const g = new THREE.Group();
      g.rotation.z = rz;
      g.rotation.x = rx;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.52, 12), mat);
      shaft.position.y = 0.34;
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.24, 16), mat);
      head.position.y = 0.72;
      shaft.userData.axis = axis;
      head.userData.axis = axis;
      g.add(shaft, head);
      const label = this.makeAxisLabel(axis.toUpperCase(), color);
      label.position.y = 1.03;
      g.add(label);
      this.gizmoMeshes.push(shaft, head);
      this.gizmoGroup.add(g);
    });
    const hub = new THREE.Mesh(
      new THREE.SphereGeometry(0.10, 20, 12),
      new THREE.MeshStandardMaterial({ color: 0x253247, roughness: 0.8, metalness: 0.1 })
    );
    this.gizmoGroup.add(hub);
    this.gizmoScene.add(this.gizmoGroup);
    this.gizmoRaycaster = new THREE.Raycaster();
    this.gizmoDown = null;
    this._gizmoHover = null;
    canvas.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this.gizmoDown = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener("pointerup", (e) => {
      e.stopPropagation();
      const down = this.gizmoDown;
      this.gizmoDown = null;
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      const axis = this.gizmoHit(e);
      if (axis) this.alignAxis(axis);
    });
    canvas.addEventListener("pointermove", (e) => {
      e.stopPropagation();
      this.setGizmoHover(this.gizmoHit(e));
    });
    canvas.addEventListener("pointerleave", () => this.setGizmoHover(null));
    this.resizeGizmo();
  }

  makeAxisLabel(text, color) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d");
    ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    ctx.beginPath();
    ctx.arc(32, 32, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0f141c";
    ctx.font = "800 30px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 32, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.34, 0.34, 1);
    sprite.renderOrder = 10;
    return sprite;
  }

  resizeGizmo() {
    if (!this.gizmoRenderer || !this.gizmoCanvas) return;
    const w = Math.max(56, this.gizmoCanvas.clientWidth || 84);
    const h = Math.max(56, this.gizmoCanvas.clientHeight || 84);
    this.gizmoRenderer.setSize(w, h, false);
  }

  renderGizmo() {
    if (!this.gizmoRenderer) return;
    this.gizmoGroup.quaternion.copy(this.camera.quaternion).invert();
    this.gizmoRenderer.render(this.gizmoScene, this.gizmoCamera);
  }

  gizmoHit(e) {
    if (!this.gizmoCanvas || !this.gizmoRenderer) return null;
    const r = this.gizmoCanvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1
    );
    this.gizmoRaycaster.setFromCamera(mouse, this.gizmoCamera);
    const hits = this.gizmoRaycaster.intersectObjects(this.gizmoMeshes, false);
    return hits.length ? hits[0].object.userData.axis : null;
  }

  setGizmoHover(axis) {
    if (this._gizmoHover === axis) return;
    this._gizmoHover = axis;
    for (const [key, mat] of Object.entries(this.gizmoMats)) {
      mat.emissiveIntensity = key === axis ? 0.55 : 0.12;
    }
    if (this.gizmoCanvas) this.gizmoCanvas.style.cursor = axis ? "pointer" : "default";
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
    const dirs = {
      x: new THREE.Vector3(1, 0, 0),
      y: new THREE.Vector3(0, -1, 0),
      z: new THREE.Vector3(0, 0, 1),
    };
    const ups = {
      x: new THREE.Vector3(0, 0, 1),
      y: new THREE.Vector3(0, 0, 1),
      z: new THREE.Vector3(0, 1, 0),
    };
    if (!dirs[axis]) return;
    const target = this.controls.target.clone();
    const dist = this.camera.position.distanceTo(target) || 3;
    const startDir = this.camera.position.clone().sub(target).normalize();
    const startUp = this.camera.up.clone().normalize();
    const endDir = dirs[axis];
    const endUp = ups[axis];
    const turn = new THREE.Quaternion().setFromUnitVectors(startDir, endDir);
    const from = new THREE.Quaternion();
    const current = new THREE.Quaternion();
    const t0 = performance.now();
    const duration = 380;
    if (this._axisFrame) cancelAnimationFrame(this._axisFrame);
    this.controls.enabled = false;
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / duration);
      const ease = t * t * (3 - 2 * t);
      current.copy(from).slerp(turn, ease);
      const dir = startDir.clone().applyQuaternion(current);
      this.camera.position.copy(target).addScaledVector(dir, dist);
      this.camera.up.copy(startUp).lerp(endUp, ease).normalize();
      this.camera.lookAt(target);
      this.controls.target.copy(target);
      this.controls.update();
      this.onCam(this);
      if (t < 1) this._axisFrame = requestAnimationFrame(step);
      else { this._axisFrame = null; this.controls.enabled = true; }
    };
    step();
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
  card.innerHTML = `<div class="viewer-head"><select class="vsel"></select><span class="vmeta meta"></span><button class="vdel" title="Убрать это окно">− окно</button><button class="vadd" title="Добавить окно в полноэкранную сетку">+ окно</button><button class="vmax" title="Развернуть или свернуть этот вьюпорт">⤢</button></div>
                    <div class="canvas-wrap"><canvas></canvas>
                      <div class="hud">
                        <div class="axis-gizmo"><canvas class="gizmo" title="3D-оси: клик по X, Y или Z плавно выравнивает камеру" aria-label="3D-оси X, Y, Z"></canvas></div>
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
  if (App.fullscreen) {
    const visible = App.fullViews.filter((v) => App.viewers.includes(v));
    if (!visible.length && App.viewers.length) visible.push(App.viewers[0]);
    const shown = Math.max(1, visible.length);
    if (App.splitV) App.splitV.style.display = "none";
    const cols = shown <= 2 ? shown : (shown <= 4 ? 2 : 3);
    el.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    el.style.gridAutoRows = "minmax(0, 1fr)";
    el.classList.add("fullscreen");
    App.viewers.forEach((x) => x.card.classList.toggle("is-full", visible.includes(x)));
    return;
  }
  el.classList.remove("fullscreen");
  App.viewers.forEach((x) => x.card.classList.remove("is-full"));
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
  const entering = !App.fullscreen;
  if (entering) {
    App.soloPrevH = document.documentElement.style.getPropertyValue("--viewer-h");
    document.documentElement.style.setProperty("--viewer-h", "72%");
    App.solo = v;
    App.fullscreen = true;
    App.fullViews = App.viewers.slice();
    setActiveViewer(v);
  } else {
    if (App.soloPrevH) document.documentElement.style.setProperty("--viewer-h", App.soloPrevH);
    else document.documentElement.style.removeProperty("--viewer-h");
    App.soloPrevH = null;
    App.solo = null;
    App.fullscreen = false;
    App.fullViews = [];
  }
  App.viewers.forEach((x) => x.card.classList.remove("is-solo"));
  $("viewers").classList.toggle("fullscreen", App.fullscreen);
  document.querySelector(".workspace").classList.toggle("solo-mode", App.fullscreen);
  document.body.classList.toggle("viewer-full", App.fullscreen);
  layoutViewers();
  App.viewers.forEach((x) => x.resize());
}

function addViewer() {
  if (App.viewers.length >= 6) return;
  const card = makeCard();
  const v = new Viewer(card, handlePick, handleCam);
  card.querySelector(".vmax").onclick = () => toggleSolo(v);
  card.querySelector(".vadd").onclick = () => addViewer();
  card.querySelector(".vdel").onclick = () => removeViewer(v);
  card.addEventListener("pointerdown", () => setActiveViewer(v));
  App.viewers.push(v);
  if (App.fullscreen) {
    App.fullViews.push(v);
    setActiveViewer(v);
  }
  populateViewer(v, App.viewers.length - 1);
  if (App.models.length) loadViewer(v).then(() => v.applySelection(App.sel.points, App.sel.mode, App.sel.polys, App.sel.ids));
  if (App.viewers.length > 1) v.copyCamera(App.viewers[0]);
  layoutViewers();
  updateViewButtons();
  updateDiff();
  v.select.onchange = () => { setActiveViewer(v); loadViewer(v); };
  return v;
}

function removeViewer(target = null) {
  if (App.viewers.length <= 1) return;
  const v = target && App.viewers.includes(target)
    ? target
    : App.viewers[App.viewers.length - 1];
  App.viewers = App.viewers.filter((x) => x !== v);
  v.card.remove();
  if (App.fullscreen) {
    App.fullViews = App.fullViews.filter((x) => x !== v);
    if (!App.fullViews.length && App.viewers.length) App.fullViews = App.viewers.slice();
  }
  if (App.solo === v) App.solo = App.fullViews[0] || App.viewers[0] || null;
  if (App.activeViewer === v) {
    App.activeViewer = null;
    if (App.viewers.length) setActiveViewer(App.viewers[0]);
  }
  layoutViewers();
  updateViewButtons();
  updateDiff();
  selectionText();
}

function updateViewButtons() {
  const add = $("addView");
  const del = $("delView");
  if (add) add.disabled = App.viewers.length >= 6;
  if (del) del.disabled = App.viewers.length <= 1;
  document.querySelectorAll(".vadd").forEach((b) => { b.disabled = App.viewers.length >= 6; });
  document.querySelectorAll(".vdel").forEach((b) => { b.disabled = App.viewers.length <= 1; });
}

function populateViewer(v, idx) {
  const model = App.models[App.modelIdx];
  if (!model) return;
  const results = orderedResults(model.results);
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

