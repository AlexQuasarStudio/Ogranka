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
    this.perspCamera = this.camera;
    this.orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 500);
    this.orthoCamera.up.set(0, 0, 1);
    this.isOrtho = false;
    this.orthoHalfH = 2;
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
    this.hlSections = new Set();
    this.hlEdges = new Set();
    this.hlMode = "face";
    this.isolate = false;
    this.pointIdx = null;
    this.edges = [];
    this.edgeAdj = [];
    this.vertEdges = [];
    this.vertFaces = [];
    this.edgeTol = 0.1;
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
    const aspect = w / h;
    if (this.camera.isOrthographicCamera) {
      const half = this.orthoHalfH || 2;
      this.camera.left = -half * aspect;
      this.camera.right = half * aspect;
      this.camera.top = half;
      this.camera.bottom = -half;
      this.camera.updateProjectionMatrix();
    } else {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
    if (this.lineMat) this.lineMat.resolution.set(w, h);
    this.resizeGizmo();
  }

  setOrtho(on) {
    const flag = !!on;
    if (flag === this.isOrtho) return;
    const target = this.controls.target.clone();
    const pos = this.camera.position.clone();
    const up = this.camera.up.clone();
    const el = this.canvas.parentElement;
    const aspect = Math.max(0.01, el.clientWidth / Math.max(1, el.clientHeight));
    if (flag) {
      const dist = pos.distanceTo(target) || 3;
      const half = dist * Math.tan((this.perspCamera.fov * Math.PI / 180) / 2);
      this.orthoHalfH = Math.max(1e-4, half);
      const cam = this.orthoCamera;
      cam.left = -this.orthoHalfH * aspect;
      cam.right = this.orthoHalfH * aspect;
      cam.top = this.orthoHalfH;
      cam.bottom = -this.orthoHalfH;
      cam.near = this.perspCamera.near;
      cam.far = this.perspCamera.far;
      cam.position.copy(pos);
      cam.up.copy(up);
      cam.zoom = 1;
      cam.lookAt(target);
      cam.updateProjectionMatrix();
      this.camera = cam;
    } else {
      const cam = this.perspCamera;
      const half = this.orthoHalfH / Math.max(0.01, this.orthoCamera.zoom);
      const dist = half / Math.tan((cam.fov * Math.PI / 180) / 2);
      const dir = pos.clone().sub(target);
      if (dir.lengthSq() < 1e-12) dir.set(0, 0, 1);
      dir.normalize();
      cam.position.copy(target).addScaledVector(dir, dist);
      cam.up.copy(up);
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
      cam.lookAt(target);
      this.camera = cam;
    }
    this.isOrtho = flag;
    this.controls.object = this.camera;
    this.controls.target.copy(target);
    this.controls.update();
    this.resize();
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
    const hasSel = this.hlFaces.size > 0 || this.hlVerts.size > 0
      || this.hlEdges.size > 0 || this.hlSections.size > 0;
    const iso = this.isolate && hasSel;
    const selMode = this.hlMode || "face";
    const keepFace = (fi) => {
      if (!iso) return true;
      if (selMode === "edge") return false;
      return this.hlFaces.has(fi);
    };
    const tris = [], triFace = [];
    faces.forEach((f, fi) => {
      if (!keepFace(fi)) return;
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

    this.sectionZ = [];
    this.sectionCentroid = [];
    this.sectionVerts = [];
    this.vertSection = new Int32Array(v.length).fill(-1);
    const byZ = new Map();
    v.forEach((p, i) => {
      const key = Math.round(p[2] * 1e6) / 1e6;
      if (!byZ.has(key)) byZ.set(key, []);
      byZ.get(key).push(i);
    });
    const rings = [...byZ.entries()].filter(([, idx]) => idx.length >= 3).sort((a, b) => a[0] - b[0]);
    rings.forEach(([z, idx], si) => {
      this.sectionZ.push(z);
      this.sectionVerts.push(idx);
      let x = 0, y = 0;
      idx.forEach((i) => { x += v[i][0]; y += v[i][1]; this.vertSection[i] = si; });
      this.sectionCentroid.push([x / idx.length, y / idx.length, z]);
    });
    this.faceSections = faces.map((f) => {
      const ss = new Set();
      f.forEach((i) => { if (this.vertSection[i] >= 0) ss.add(this.vertSection[i]); });
      return [...ss];
    });
    this.sectionFaces = this.sectionZ.map(() => []);
    this.faceSections.forEach((ss, fi) => ss.forEach((si) => this.sectionFaces[si].push(fi)));
    this.sectionAdj = this.sectionZ.map((_, si) => [si - 1, si + 1].filter((k) => k >= 0 && k < this.sectionZ.length));
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

    this.edges = [];
    this.edgeIndex = new Map();
    this.vertEdges = Array.from({ length: v.length }, () => []);
    this.vertFaces = Array.from({ length: v.length }, () => []);
    faces.forEach((f, fi) => {
      f.forEach((i) => this.vertFaces[i].push(fi));
      for (let i = 0; i < f.length; i++) {
        const a = f[i], b = f[(i + 1) % f.length];
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        if (this.edgeIndex.has(key)) continue;
        const ei = this.edges.length;
        this.edgeIndex.set(key, ei);
        this.edges.push([a, b]);
        this.vertEdges[a].push(ei);
        this.vertEdges[b].push(ei);
      }
    });
    this.edgeAdj = this.edges.map((e, ei) => {
      const out = new Set();
      e.forEach((i) => this.vertEdges[i].forEach((ej) => { if (ej !== ei) out.add(ej); }));
      return [...out];
    });
    const bbMin = [Infinity, Infinity, Infinity], bbMax = [-Infinity, -Infinity, -Infinity];
    v.forEach((p) => p.forEach((x, i) => { bbMin[i] = Math.min(bbMin[i], x); bbMax[i] = Math.max(bbMax[i], x); }));
    this.edgeTol = Math.max(0.02, 0.02 * Math.hypot(bbMax[0] - bbMin[0], bbMax[1] - bbMin[1], bbMax[2] - bbMin[2]));

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
        faces.forEach((f, fi) => {
          if (!keepFace(fi)) return;
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

    this.pointIdx = null;
    const showPoints = (mode === "points" || this.selTarget === "vertex") && (!iso || selMode === "vertex");
    if (showPoints) {
      const pointIdx = (iso && selMode === "vertex") ? [...this.hlVerts] : null;
      this.pointIdx = pointIdx;
      const arr = pointIdx ? pointIdx.flatMap((i) => v[i]) : v.flat();
      const pg = new THREE.BufferGeometry();
      pg.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      this.pointsObj = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0x9fd8ff, size: mode === "points" ? 0.035 : 0.02 }));
      this.group.add(this.pointsObj);
    } else {
      this.pointsObj = null;
    }

    const sel = [...this.hlVerts];
    if (sel.length) {
      const sg = new THREE.BufferGeometry();
      sg.setAttribute("position", new THREE.Float32BufferAttribute(sel.flatMap((i) => v[i]), 3));
      this.group.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffb347, size: 0.06 })));
    }

    if (this.hlEdges.size) {
      const esegs = [];
      this.hlEdges.forEach((ei) => {
        const e = this.edges[ei];
        if (!e) return;
        const a = v[e[0]], b = v[e[1]];
        esegs.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      });
      if (esegs.length) {
        if (THREE.LineSegments2 && THREE.LineMaterial) {
          const eg = new THREE.LineSegmentsGeometry().setPositions(esegs);
          const em = new THREE.LineMaterial({ color: 0xffb347, linewidth: 4.0 });
          const el = this.canvas.parentElement;
          em.resolution.set(Math.max(1, el.clientWidth), Math.max(1, el.clientHeight));
          this.group.add(new THREE.LineSegments2(eg, em));
        } else {
          const eg = new THREE.BufferGeometry();
          eg.setAttribute("position", new THREE.Float32BufferAttribute(esegs, 3));
          this.group.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0xffb347 })));
        }
      }
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

    if (this.selTarget === "section") {
      if (!this.solid || !this.sectionZ.length) {
        if (action === "replace") this.onPick(this, null, "section", "clear");
        return;
      }
      const hits = this.raycaster.intersectObject(this.solid);
      if (!hits.length) {
        if (action === "replace") this.onPick(this, null, "section", "clear");
        return;
      }
      const hz = hits[0].point.z;
      let si = 0, best = Infinity;
      this.sectionZ.forEach((z, i) => { const d = Math.abs(z - hz); if (d < best) { best = d; si = i; } });
      this.onPick(this, this.sectionCentroid[si].slice(), "section", action, null, si);
      return;
    }

    if (this.selTarget === "edge") {
      if (!this.edges.length) {
        if (action === "replace") this.onPick(this, null, "edge", "clear");
        return;
      }
      const ei = this.pickEdge();
      if (ei < 0) {
        if (action === "replace") this.onPick(this, null, "edge", "clear");
        return;
      }
      this.onPick(this, this.edgePoint(ei), "edge", action, null, ei);
      return;
    }

    if (this.selTarget === "vertex" || this.pointsObj) {
      if (!this.pointsObj) return;
      const hits = this.raycaster.intersectObject(this.pointsObj);
      if (!hits.length) { if (action === "replace") this.onPick(this, null, "vert", "clear"); return; }
      const pi = this.pointIdx ? this.pointIdx[hits[0].index] : hits[0].index;
      if (pi == null || !this.verts[pi]) return;
      this.onPick(this, this.verts[pi].slice(), "vert", action, null, pi);
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
    this.hlSections = new Set();
    this.hlEdges = new Set();
    this.hlMode = mode;
    if (points.length && this.mesh) {
      const mappedPoints = [];
      const mappedPolys = [];
      const exactFaces = [];
      const exactVerts = [];
      const exactSections = [];
      const exactEdges = [];
      for (let i = 0; i < points.length; i++) {
        const id = ids && ids[i];
        const total = mode === "face" ? this.faceCentroids.length
          : mode === "section" ? this.sectionZ.length
          : mode === "edge" ? this.edges.length : this.verts.length;
        if (id && id.viewer === this && id.type === mode && id.index >= 0 && id.index < total) {
          if (mode === "face") exactFaces.push(id.index);
          else if (mode === "section") exactSections.push(id.index);
          else if (mode === "edge") exactEdges.push(id.index);
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
      } else if (mode === "section") {
        exactSections.forEach((si) => {
          if (si >= 0 && si < this.sectionZ.length) this.hlSections.add(si);
        });
        mappedPoints.forEach((p) => {
          let si = -1, best = Infinity;
          this.sectionZ.forEach((z, k) => { const d = Math.abs(z - p[2]); if (d < best) { best = d; si = k; } });
          if (si >= 0) this.hlSections.add(si);
        });
        this.hlSections.forEach((si) => {
          (this.sectionFaces[si] || []).forEach((fi) => this.hlFaces.add(fi));
          (this.sectionVerts[si] || []).forEach((i) => this.hlVerts.add(i));
        });
      } else if (mode === "edge") {
        exactEdges.forEach((ei) => {
          if (ei >= 0 && ei < this.edges.length) this.hlEdges.add(ei);
        });
        mappedPoints.forEach((p) => {
          let best = -1, bd = Infinity;
          this.edges.forEach((e, ei) => {
            const d = pointSegDist2(p, this.verts[e[0]], this.verts[e[1]]);
            if (d < bd) { bd = d; best = ei; }
          });
          if (best >= 0) this.hlEdges.add(best);
        });
        this.hlEdges.forEach((ei) => {
          const e = this.edges[ei];
          if (!e) return;
          this.hlVerts.add(e[0]);
          this.hlVerts.add(e[1]);
        });
      } else {
        exactVerts.forEach((i) => {
          this.hlVerts.add(i);
          (this.vertFaces[i] || []).forEach((fi) => this.hlFaces.add(fi));
        });
        if (mappedPoints.length) {
          const dist2 = (a, p) => (a[0] - p[0]) ** 2 + (a[1] - p[1]) ** 2 + (a[2] - p[2]) ** 2;
          const facesHit = new Set();
          const loose = [];
          mappedPoints.forEach((p) => {
            let found = false;
            this.facePolys.forEach((poly, fi) => {
              if (pointInPoly(p, poly, TOL)) { facesHit.add(fi); found = true; }
            });
            if (!found) loose.push(p);
          });
          facesHit.forEach((fi) => {
            this.hlFaces.add(fi);
            (this.faces[fi] || []).forEach((i) => this.hlVerts.add(i));
          });
          loose.forEach((p) => {
            let found = false;
            this.verts.forEach((c, i) => {
              if (near(c, p)) { this.hlVerts.add(i); found = true; }
            });
            if (!found && this.verts.length) {
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
  pathSections(start, end) {
    if (start == null || end == null) return [end];
    const lo = Math.min(start, end), hi = Math.max(start, end);
    return Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
  }
  pathEdges(start, end) { return this.bfsPath(this.edgeAdj, start, end); }
  edgePoint(ei) {
    const e = this.edges[ei];
    if (!e) return [0, 0, 0];
    const a = this.verts[e[0]], b = this.verts[e[1]];
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  }
  pickEdge() {
    if (!this.solid) return -1;
    const ray = this.raycaster.ray;
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    let best = -1, bestD = Infinity;
    this.edges.forEach((e, ei) => {
      a.fromArray(this.verts[e[0]]);
      b.fromArray(this.verts[e[1]]);
      const d = Math.sqrt(ray.distanceSqToSegment(a, b));
      if (d < bestD) { bestD = d; best = ei; }
    });
    return bestD <= this.edgeTol ? best : -1;
  }

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
    this.setOrtho(src.isOrtho);
    if (src.isOrtho) {
      this.orthoHalfH = src.orthoHalfH;
      this.orthoCamera.zoom = src.orthoCamera.zoom;
      this.resize();
    }
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
    if (this.isOrtho) {
      this.orthoHalfH = r * 1.25;
      this.orthoCamera.zoom = 1;
      this.resize();
    } else {
      this.camera.updateProjectionMatrix();
    }
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
  v.isolate = App.isolate;
  v.setOrtho(App.ortho);
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
      const path = type === "face" ? src.pathFaces(anchor.index, index)
        : type === "section" ? src.pathSections(anchor.index, index)
        : type === "edge" ? src.pathEdges(anchor.index, index)
        : src.pathVerts(anchor.index, index);
      const keys = new Set(App.sel.points.map(keyOf));
      path.forEach((fi) => {
        const p = type === "face" ? src.faceCentroids[fi].slice()
          : type === "section" ? src.sectionCentroid[fi].slice()
          : type === "edge" ? src.edgePoint(fi)
          : src.verts[fi].slice();
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
  const count = (v) => App.sel.mode === "face" ? v.hlFaces.size
    : App.sel.mode === "section" ? v.hlSections.size
    : App.sel.mode === "edge" ? v.hlEdges.size : v.hlVerts.size;
  const parts = App.viewers.map((v, i) => `окно ${i + 1}: ${count(v)}`);
  const what = App.sel.mode === "face" ? "граней"
    : App.sel.mode === "section" ? "сечений"
    : App.sel.mode === "edge" ? "рёбер" : "вершин";
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

