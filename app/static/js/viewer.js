/* Three.js viewer, selection and viewport layout.
 *
 * Кадр рисуется только по запросу (requestRender): после изменения сцены,
 * движения камеры или затухания инерции.  Оси-гизмо рисуются тем же
 * WebGL-контекстом в углу кадра, поэтому на вьюпорт приходится один
 * контекст, а топология модели считается один раз при загрузке меша.
 */
const VIEW_COLORS = {
  fill: 0x8fc1ff,
  highlight: 0xffb347,
  wire: 0x9fd8ff,
  areaLow: 0x3f7bff,
  areaHigh: 0xff9f43,
};

function cssColor(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!value) return fallback;
  try { return new THREE.Color(value).getHex(); } catch (err) { return fallback; }
}

function edgeKey(a, b, n) {
  return a < b ? a * n + b : b * n + a;
}

class Viewer {
  constructor(card, onPick, onCam, onBoxPick) {
    this.card = card;
    this.modelSel = card.querySelector(".vmodel");
    this.select = card.querySelector(".vsel");
    this.meta = card.querySelector(".vmeta");
    this.canvas = card.querySelector("canvas.view");
    this.gizmoEl = card.querySelector(".gizmo");
    this.onPick = onPick;
    this.onCam = onCam;
    this.onBoxPick = onBoxPick || null;
    this.disposed = false;
    this._frame = 0;
    this._w = 1;
    this._h = 1;
    this._gizmoRect = null;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.autoClear = false;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(cssColor("--viewport-bg", 0x0f141c));
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
    this.previewGroup = new THREE.Group();
    this.scene.add(this.previewGroup);
    this._previewTimer = null;
    this._previewCount = null;
    this._marqueeW = null;
    this._marqueeH = null;
    this._boxSeq = 0;
    this.boxBusy = false;
    this.controls.addEventListener("change", () => {
      this.requestRender();
      this.onCam(this);
    });

    this.mesh = null;
    this.loadSeq = 0;
    this.faces = [];
    this.verts = [];
    this.triFace = [];
    this.faceCentroids = [];
    this.faceNormals = [];
    this.facePolys = [];
    this.faceRadii = [];
    this.faceAdj = [];
    this.sectionZ = [];
    this.sectionCentroid = [];
    this.sectionVerts = [];
    this.sectionFaces = [];
    this.solid = null;
    this.pointsObj = null;
    this.hlFaces = new Set();
    this.selFaces = new Set();
    this.selIds = { face: new Set(), vert: new Set(), edge: new Set(), section: new Set() };
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
    this.boxSelect = false;
    this.boxDrag = null;
    this.boxVisibleOnly = true;
    this._orbitButtons = { ...this.controls.mouseButtons };
    this.lineMats = [];

    this.hudCur = card.querySelector(".cur");
    this.setupGizmo();
    this.canvas.addEventListener("pointermove", (e) => this.cursorInfo(e));

    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Points.threshold = 0.05;
    this.down = null;
    this.canvas.addEventListener("pointerdown", (e) => {
      const current = activeViewer();
      if (current && current !== this) {
        setActiveViewer(this);
        this.down = null;
        this.boxDrag = null;
        return;
      }
      if (this.boxSelect && e.button === 0) {
        e.preventDefault();
        this.cancelBoxWork();
        this.boxDrag = {
          x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, pointerId: e.pointerId,
          action: e.shiftKey ? "add" : ((e.ctrlKey || e.metaKey || e.altKey) ? "subtract" : "replace"),
        };
        this.clearPreview();
        this.showMarquee(e.clientX, e.clientY, e.clientX, e.clientY);
        try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        return;
      }
      this.down = { x: e.clientX, y: e.clientY, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.boxDrag) return;
      e.preventDefault();
      this.boxDrag.x1 = e.clientX;
      this.boxDrag.y1 = e.clientY;
      this.showMarquee(this.boxDrag.x0, this.boxDrag.y0, this.boxDrag.x1, this.boxDrag.y1);
      this.queuePreview();
    });
    this.canvas.addEventListener("pointerup", (e) => {
      if (this.boxDrag) {
        e.preventDefault();
        const drag = this.boxDrag;
        this.boxDrag = null;
        this.hideMarquee();
        try { this.canvas.releasePointerCapture(drag.pointerId); } catch (err) { /* ignore */ }
        if (Math.abs(e.clientX - drag.x0) < 5 && Math.abs(e.clientY - drag.y0) < 5) {
          this.pick(e.clientX, e.clientY, e.shiftKey, e.ctrlKey || e.metaKey);
        } else {
          this.queueBoxSelection(drag.x0, drag.y0, e.clientX, e.clientY, drag.action);
        }
        return;
      }
      if (!this.down) return;
      if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 5) {
        this.pick(e.clientX, e.clientY, this.down.shift, this.down.ctrl);
      }
      this.down = null;
    });
    this.canvas.addEventListener("pointercancel", () => {
      this.cancelBoxWork();
      this.boxDrag = null;
      this.down = null;
      this.hideMarquee();
    });
    this.canvas.addEventListener("webglcontextrestored", () => this.rebuild(this.mode));

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas.parentElement);
    this.resize();
  }

  // ------------------------------------------------------------ кадр

  requestRender() {
    if (this._frame || this.disposed) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = 0;
      this.render();
    });
  }

  render(withGizmo = true) {
    if (this.disposed) return;
    // Затухание инерции: update() вернёт true и через «change» запросит кадр.
    if (this.controls.enabled) this.controls.update();
    const r = this.renderer;
    r.setScissorTest(false);
    r.setViewport(0, 0, this._w, this._h);
    r.clear();
    r.render(this.scene, this.camera);
    if (withGizmo) this.renderGizmo();
  }

  snapshot() {
    this.render(false);
    const url = this.renderer.domElement.toDataURL("image/png");
    this.requestRender();
    return url;
  }

  applyTheme() {
    this.scene.background = new THREE.Color(cssColor("--viewport-bg", 0x0f141c));
    if (this.mesh) this.rebuild(this.mode);
    else this.requestRender();
  }

  resize() {
    if (this.disposed) return;
    const el = this.canvas.parentElement;
    const w = Math.max(120, el.clientWidth), h = Math.max(120, el.clientHeight);
    this._w = w;
    this._h = h;
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
    this.lineMats.forEach((m) => m.resolution.set(w, h));
    this.measureGizmo();
    this.requestRender();
  }

  dispose() {
    this.disposed = true;
    if (this._frame) cancelAnimationFrame(this._frame);
    this._frame = 0;
    this.stopViewAnimation();
    clearTimeout(this._previewTimer);
    this.resizeObserver.disconnect();
    this.clear();
    if (this.gizmoScene) {
      this.gizmoScene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (obj.material.map) obj.material.map.dispose();
          obj.material.dispose();
        }
      });
    }
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  stopViewAnimation() {
    if (this._resetFrame) {
      cancelAnimationFrame(this._resetFrame);
      this._resetFrame = null;
    }
    if (this._axisFrame) {
      cancelAnimationFrame(this._axisFrame);
      this._axisFrame = null;
    }
    this.controls.enabled = true;
  }

  setOrtho(on) {
    const flag = !!on;
    if (flag === this.isOrtho) return;
    this.stopViewAnimation();
    const target = this.controls.target.clone();
    const pos = this.camera.position.clone();
    const up = this.camera.up.clone();
    const aspect = Math.max(0.01, this._w / Math.max(1, this._h));
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

  // ------------------------------------------------------------ оси

  setupGizmo() {
    const el = this.gizmoEl;
    if (!el) return;
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
    const shaftGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.52, 12);
    const headGeo = new THREE.ConeGeometry(0.12, 0.24, 16);
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
      const shaft = new THREE.Mesh(shaftGeo, mat);
      shaft.position.y = 0.34;
      const head = new THREE.Mesh(headGeo, mat);
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
    el.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this.gizmoDown = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener("pointerup", (e) => {
      e.stopPropagation();
      const down = this.gizmoDown;
      this.gizmoDown = null;
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      const axis = this.gizmoHit(e);
      if (axis) this.alignAxis(axis);
    });
    el.addEventListener("pointermove", (e) => {
      e.stopPropagation();
      this.setGizmoHover(this.gizmoHit(e));
    });
    el.addEventListener("pointerleave", () => this.setGizmoHover(null));
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

  measureGizmo() {
    if (!this.gizmoEl) return;
    const cr = this.canvas.getBoundingClientRect();
    const gr = this.gizmoEl.getBoundingClientRect();
    if (!gr.width || !gr.height || !cr.height) {
      this._gizmoRect = null;
      return;
    }
    const x = gr.left - cr.left;
    const top = gr.top - cr.top;
    this._gizmoRect = { x, y: cr.height - top - gr.height, w: gr.width, h: gr.height };
  }

  renderGizmo() {
    const rect = this._gizmoRect;
    if (!rect || !this.gizmoScene) return;
    const r = this.renderer;
    this.gizmoGroup.quaternion.copy(this.camera.quaternion).invert();
    r.setScissorTest(true);
    r.setScissor(rect.x, rect.y, rect.w, rect.h);
    r.setViewport(rect.x, rect.y, rect.w, rect.h);
    r.clearDepth();
    r.render(this.gizmoScene, this.gizmoCamera);
    r.setScissorTest(false);
    r.setViewport(0, 0, this._w, this._h);
  }

  gizmoHit(e) {
    if (!this.gizmoEl || !this.gizmoScene) return null;
    const r = this.gizmoEl.getBoundingClientRect();
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
    if (this.gizmoEl) this.gizmoEl.style.cursor = axis ? "pointer" : "default";
    this.requestRender();
  }

  // ------------------------------------------------------------ сцена

  clear() {
    if (this.previewGroup) this.clearPreview();
    while (this.group.children.length) {
      const c = this.group.children.pop();
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    }
    this.lineMats = [];
    this.solid = null;
    this.pointsObj = null;
    this.requestRender();
  }

  setEmptyState(title, text) {
    const empty = this.card.querySelector(".empty-state");
    if (!empty) return;
    const strong = empty.querySelector("strong");
    const span = empty.querySelector("span");
    if (strong) strong.textContent = title;
    if (span) span.textContent = text;
  }

  setMesh(mesh, mode, keepView = false) {
    this.cancelBoxWork();
    this.mesh = mesh;
    this.mode = mode;
    this.card.classList.toggle("is-empty", !(mesh && mesh.v && mesh.v.length));
    if (!mesh || !mesh.v || !mesh.f) {
      this.setEmptyState(
        "Модели пока нет",
        "Выберите тело или файлы слева и запустите конвейер — R",
      );
    }
    this.clear();
    if (!mesh || !mesh.v || !mesh.f) {
      this.analyze(null);
      return;
    }
    this.analyze(mesh);
    if (!keepView) this.frame(mesh);
    this.rebuild(mode);
  }

  rebuild(mode) {
    if (!this.mesh) return;
    this.mode = mode;
    this.clear();
    this.build(mode);
    this.requestRender();
  }

  /** Topology of the mesh: computed once per mesh, reused by every rebuild. */
  analyze(mesh) {
    const v = mesh ? mesh.v : [];
    const faces = mesh ? mesh.f : [];
    const nv = v.length;
    this.verts = v;
    this.faces = faces;

    const tris = [];
    const triFace = [];
    faces.forEach((f, fi) => {
      for (const t of triangulateFace(f, v)) { tris.push(t); triFace.push(fi); }
    });
    this.allTris = tris;
    this.allTriFace = triFace;
    this.triFace = triFace;

    this.faceCentroids = faces.map((f) => {
      let x = 0, y = 0, z = 0;
      f.forEach((i) => { x += v[i][0]; y += v[i][1]; z += v[i][2]; });
      return [x / f.length, y / f.length, z / f.length];
    });
    const center = [0, 0, 0];
    if (nv) {
      v.forEach((p) => { center[0] += p[0]; center[1] += p[1]; center[2] += p[2]; });
      center[0] /= nv; center[1] /= nv; center[2] /= nv;
    }
    this.faceNormals = faces.map((f, fi) => {
      const n = faceNormal3(v, f);
      if (!n[0] && !n[1] && !n[2]) return n;
      const c = this.faceCentroids[fi];
      const outward = n[0] * (c[0] - center[0]) + n[1] * (c[1] - center[1]) + n[2] * (c[2] - center[2]);
      return outward < 0 ? [-n[0], -n[1], -n[2]] : n;
    });
    this.facePolys = faces.map((f) => f.map((i) => v[i]));
    this.faceRadii = this.facePolys.map((poly, fi) => {
      const c = this.faceCentroids[fi];
      let r = 0;
      poly.forEach((p) => { r = Math.max(r, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])); });
      return r;
    });

    // Сечения: вершины с одинаковой высотой образуют кольцо.
    this.sectionZ = [];
    this.sectionCentroid = [];
    this.sectionVerts = [];
    this.vertSection = new Int32Array(nv).fill(-1);
    const byZ = new Map();
    v.forEach((p, i) => {
      const key = Math.round(p[2] * 1e6) / 1e6;
      let list = byZ.get(key);
      if (!list) { list = []; byZ.set(key, list); }
      list.push(i);
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

    // Рёбра, смежность граней и вершин — числовые ключи вместо строк.
    this.faceAdj = Array.from({ length: faces.length }, () => []);
    this.vertAdj = Array.from({ length: nv }, () => []);
    this.vertEdges = Array.from({ length: nv }, () => []);
    this.vertFaces = Array.from({ length: nv }, () => []);
    this.edges = [];
    this.edgeIndex = new Map();
    const edgeOwner = new Map();
    faces.forEach((f, fi) => {
      f.forEach((i) => this.vertFaces[i].push(fi));
      for (let i = 0; i < f.length; i++) {
        const a = f[i], b = f[(i + 1) % f.length];
        const key = edgeKey(a, b, nv);
        const owner = edgeOwner.get(key);
        if (owner === undefined) {
          edgeOwner.set(key, fi);
          const ei = this.edges.length;
          this.edgeIndex.set(key, ei);
          this.edges.push([a, b]);
          this.vertEdges[a].push(ei);
          this.vertEdges[b].push(ei);
          this.vertAdj[a].push(b);
          this.vertAdj[b].push(a);
        } else if (owner !== fi) {
          this.faceAdj[fi].push(owner);
          this.faceAdj[owner].push(fi);
        }
      }
    });
    this.edgeAdj = this.edges.map((e, ei) => {
      const out = new Set();
      e.forEach((i) => this.vertEdges[i].forEach((ej) => { if (ej !== ei) out.add(ej); }));
      return [...out];
    });
    const bbMin = [Infinity, Infinity, Infinity], bbMax = [-Infinity, -Infinity, -Infinity];
    v.forEach((p) => {
      for (let i = 0; i < 3; i++) {
        if (p[i] < bbMin[i]) bbMin[i] = p[i];
        if (p[i] > bbMax[i]) bbMax[i] = p[i];
      }
    });
    this.edgeTol = nv ? Math.max(0.02, 0.02 * Math.hypot(bbMax[0] - bbMin[0], bbMax[1] - bbMin[1], bbMax[2] - bbMin[2])) : 0.1;

    // Цвета граней для режимов «разными цветами» и «по площади».
    const areas = faces.map((f) => polyArea3(v, f));
    const amax = areas.length ? Math.max(...areas, 1e-9) : 1;
    this.faceHue = new Float32Array(faces.length * 3);
    this.faceArea = new Float32Array(faces.length * 3);
    const c = new THREE.Color();
    const lo = new THREE.Color(VIEW_COLORS.areaLow), hi = new THREE.Color(VIEW_COLORS.areaHigh);
    faces.forEach((_, i) => {
      c.setHSL((i * 0.61803398875) % 1, 0.55, 0.58);
      this.faceHue.set([c.r, c.g, c.b], i * 3);
      c.copy(lo).lerp(hi, Math.min(1, Math.max(0, areas[i] / amax)));
      this.faceArea.set([c.r, c.g, c.b], i * 3);
    });
  }

  addLines(segments, color, width) {
    if (!segments.length) return null;
    if (THREE.LineSegments2 && THREE.LineMaterial) {
      const geometry = new THREE.LineSegmentsGeometry().setPositions(segments);
      const material = new THREE.LineMaterial({ color, linewidth: width });
      material.resolution.set(Math.max(1, this._w), Math.max(1, this._h));
      this.lineMats.push(material);
      const line = new THREE.LineSegments2(geometry, material);
      this.group.add(line);
      return line;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(segments, 3));
    const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color }));
    this.group.add(line);
    return line;
  }

  build(mode) {
    const v = this.verts, faces = this.faces;
    const hasSel = this.hlFaces.size > 0 || this.hlVerts.size > 0
      || this.hlEdges.size > 0 || this.hlSections.size > 0;
    const iso = this.isolate && hasSel;
    const selMode = this.hlMode || "face";
    const keepFace = (fi) => {
      if (!iso) return true;
      if (selMode === "edge") return false;
      return this.hlFaces.has(fi);
    };

    let tris = this.allTris;
    let triFace = this.allTriFace;
    if (iso) {
      tris = [];
      triFace = [];
      this.allTris.forEach((t, ti) => {
        const fi = this.allTriFace[ti];
        if (keepFace(fi)) { tris.push(t); triFace.push(fi); }
      });
    }
    this.triFace = triFace;

    const nt = tris.length;
    const pos = new Float32Array(nt * 9);
    for (let ti = 0; ti < nt; ti++) {
      const t = tris[ti];
      for (let j = 0; j < 3; j++) {
        const p = v[t[j]];
        const o = ti * 9 + j * 3;
        pos[o] = p[0]; pos[o + 1] = p[1]; pos[o + 2] = p[2];
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const useColors = mode === "face" || mode === "area" || this.hlFaces.size > 0;
    if (useColors) {
      const col = new Float32Array(nt * 9);
      const base = new THREE.Color(VIEW_COLORS.fill);
      const hl = new THREE.Color(VIEW_COLORS.highlight);
      const palette = mode === "face" ? this.faceHue : (mode === "area" ? this.faceArea : null);
      for (let ti = 0; ti < nt; ti++) {
        const fi = triFace[ti];
        let r, g, b;
        if (this.hlFaces.has(fi)) { r = hl.r; g = hl.g; b = hl.b; }
        else if (palette) { r = palette[fi * 3]; g = palette[fi * 3 + 1]; b = palette[fi * 3 + 2]; }
        else { r = base.r; g = base.g; b = base.b; }
        for (let j = 0; j < 3; j++) {
          const o = ti * 9 + j * 3;
          col[o] = r; col[o + 1] = g; col[o + 2] = b;
        }
      }
      geom.setAttribute("color", new THREE.BufferAttribute(col, 3));
    }
    geom.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: VIEW_COLORS.fill, vertexColors: useColors, roughness: 0.55, metalness: 0.05,
      flatShading: true, side: THREE.DoubleSide,
    });
    this.solid = new THREE.Mesh(geom, material);
    this.solid.visible = mode !== "edges" && mode !== "points" && mode !== "wire";
    this.group.add(this.solid);

    if ((mode === "wire" || mode === "edges") && this.hlFaces.size) {
      const selPos = [];
      tris.forEach((t, ti) => {
        if (!this.hlFaces.has(triFace[ti])) return;
        for (let j = 0; j < 3; j++) {
          const p = v[t[j]];
          selPos.push(p[0], p[1], p[2]);
        }
      });
      if (selPos.length) {
        const sg = new THREE.BufferGeometry();
        sg.setAttribute("position", new THREE.Float32BufferAttribute(selPos, 3));
        const sm = new THREE.MeshBasicMaterial({
          color: VIEW_COLORS.highlight, transparent: true, opacity: 0.32,
          side: THREE.DoubleSide, depthWrite: false,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        });
        const selected = new THREE.Mesh(sg, sm);
        selected.renderOrder = 2;
        this.group.add(selected);
      }
    }

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
        // Каждое ребро рисуется один раз, а не по разу от каждой из двух граней.
        this.edges.forEach((e) => {
          if (iso) {
            const owners = this.vertFaces[e[0]].filter((fi) => keepFace(fi) && faces[fi].includes(e[1]));
            if (!owners.length) return;
          }
          const a = v[e[0]], b = v[e[1]];
          segs.push(a[0], a[1], a[2], b[0], b[1], b[2]);
        });
      }
      // Плотные оболочки с тысячами рёбер не должны превращаться в сплошную сетку.
      const count = segs.length / 6;
      const dense = mode === "solid_edges" && count > 600;
      const width = mode === "wire" ? 0.8 : (mode === "edges" ? 0.9 : (dense ? 1.1 : 2.4));
      const color = mode === "solid_edges" ? cssColor("--viewport-edge", 0x000000) : VIEW_COLORS.wire;
      const line = this.addLines(segs, color, width);
      if (line && dense) {
        line.material.transparent = true;
        line.material.opacity = Math.max(0.18, Math.min(0.6, 600 / count));
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
      this.pointsObj = new THREE.Points(pg, new THREE.PointsMaterial({ color: VIEW_COLORS.wire, size: mode === "points" ? 0.035 : 0.02 }));
      this.group.add(this.pointsObj);
    } else {
      this.pointsObj = null;
    }

    if (this.hlVerts.size) {
      const sg = new THREE.BufferGeometry();
      sg.setAttribute("position", new THREE.Float32BufferAttribute([...this.hlVerts].flatMap((i) => v[i]), 3));
      this.group.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: VIEW_COLORS.highlight, size: 0.06 })));
    }

    if (this.hlEdges.size) {
      const esegs = [];
      this.hlEdges.forEach((ei) => {
        const e = this.edges[ei];
        if (!e) return;
        const a = v[e[0]], b = v[e[1]];
        esegs.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      });
      this.addLines(esegs, VIEW_COLORS.highlight, 4.0);
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

  setBoxSelect(on) {
    this.boxSelect = !!on;
    this.controls.mouseButtons = this.boxSelect
      ? { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
      : { ...this._orbitButtons };
    this.card.classList.toggle("box-mode", this.boxSelect);
    if (!this.boxSelect) {
      this.cancelBoxWork();
      this.boxDrag = null;
      this.hideMarquee();
    }
  }

  showMarquee(x0, y0, x1, y1) {
    const rect = this.canvas.getBoundingClientRect();
    if (!this.marqueeEl) {
      const el = document.createElement("div");
      el.className = "box-marquee hidden";
      el.innerHTML = '<span class="box-marquee__label"></span>';
      this.canvas.parentElement.appendChild(el);
      this.marqueeEl = el;
    }
    const left = Math.max(0, Math.min(x0, x1) - rect.left);
    const top = Math.max(0, Math.min(y0, y1) - rect.top);
    const right = Math.min(rect.width, Math.max(x0, x1) - rect.left);
    const bottom = Math.min(rect.height, Math.max(y0, y1) - rect.top);
    const w = Math.max(0, right - left), h = Math.max(0, bottom - top);
    this.marqueeEl.style.left = left + "px";
    this.marqueeEl.style.top = top + "px";
    this.marqueeEl.style.width = w + "px";
    this.marqueeEl.style.height = h + "px";
    this._marqueeW = w;
    this._marqueeH = h;
    this.updateMarqueeLabel();
    this.marqueeEl.classList.remove("hidden");
  }

  updateMarqueeLabel() {
    const label = this.marqueeEl && this.marqueeEl.querySelector(".box-marquee__label");
    if (!label || this._marqueeW == null) return;
    const size = `${Math.round(this._marqueeW)} × ${Math.round(this._marqueeH)}`;
    label.textContent = this._previewCount == null ? size : `${size} · ${this._previewCount}`;
  }

  hideMarquee() {
    if (this.marqueeEl) this.marqueeEl.classList.add("hidden");
    this.clearPreview();
  }

  pointVisible(p) {
    if (!this.boxVisibleOnly || !this.solid) return true;
    const q = new THREE.Vector3(p[0], p[1], p[2]).project(this.camera);
    if (q.z > 1) return false;
    this.raycaster.setFromCamera(new THREE.Vector2(q.x, q.y), this.camera);
    const hit = this.raycaster.intersectObject(this.solid, false)[0];
    if (!hit) return true;
    const dist = this.camera.position.distanceTo(new THREE.Vector3(p[0], p[1], p[2]));
    return hit.distance >= dist - Math.max(TOL, dist * 0.01);
  }

  boxHits(x0, y0, x1, y1) {
    if (!this.mesh) return null;
    if (!this.facePolys) this.facePolys = [];
    const rect = this.canvas.getBoundingClientRect();
    const box = {
      left: Math.max(rect.left, Math.min(x0, x1)),
      right: Math.min(rect.right, Math.max(x0, x1)),
      top: Math.max(rect.top, Math.min(y0, y1)),
      bottom: Math.min(rect.bottom, Math.max(y0, y1)),
    };
    if (box.right - box.left < 3 || box.bottom - box.top < 3) return null;
    this.camera.updateMatrixWorld(true);
    if (this.solid) this.solid.updateMatrixWorld(true);
    const project = (p) => {
      const q = new THREE.Vector3(p[0], p[1], p[2]).project(this.camera);
      return {
        x: rect.left + (q.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-q.y * 0.5 + 0.5) * rect.height,
        z: q.z,
      };
    };
    const target = this.selTarget || "face";
    const hits = [];
    const visibleOnly = this.boxVisibleOnly;
    const ortho = this.camera.isOrthographicCamera;
    let vx = 0, vy = 0, vz = 0;
    if (visibleOnly) {
      if (ortho) {
        const dir = new THREE.Vector3();
        this.camera.getWorldDirection(dir);
        vx = -dir.x; vy = -dir.y; vz = -dir.z;
      } else {
        vx = this.camera.position.x; vy = this.camera.position.y; vz = this.camera.position.z;
      }
    }
    const faceVisible = (fi) => {
      if (!visibleOnly) return true;
      const n = this.faceNormals && this.faceNormals[fi];
      if (!n) return false;
      if (ortho) return n[0] * vx + n[1] * vy + n[2] * vz > 0;
      const c = this.faceCentroids[fi];
      return n[0] * (vx - c[0]) + n[1] * (vy - c[1]) + n[2] * (vz - c[2]) > 0;
    };
    if (target === "face") {
      this.facePolys.forEach((poly, fi) => {
        const pts = poly.map(project);
        if (pts.some((p) => p.z > 1)) return;
        if (!polyRectHit(pts, box)) return;
        if (!faceVisible(fi)) return;
        hits.push(fi);
      });
    } else if (target === "vertex") {
      this.verts.forEach((p, i) => {
        const q = project(p);
        if (q.z > 1 || !pointInRect2D(q, box)) return;
        if (visibleOnly && !(this.vertFaces[i] || []).some(faceVisible)) return;
        hits.push(i);
      });
    } else if (target === "edge") {
      this.edges.forEach((e, i) => {
        const a = this.verts[e[0]], b = this.verts[e[1]];
        if (!a || !b) return;
        const pa = project(a), pb = project(b);
        if (pa.z > 1 || pb.z > 1) return;
        const corners = [
          { x: box.left, y: box.top }, { x: box.right, y: box.top },
          { x: box.right, y: box.bottom }, { x: box.left, y: box.bottom },
        ];
        const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
        const inside = pointInRect2D(pa, box) || pointInRect2D(pb, box) || pointInRect2D(mid, box) ||
          corners.some((c, k) => segmentsCross(pa, pb, c, corners[(k + 1) % 4]));
        if (!inside) return;
        if (visibleOnly) {
          const visible = (this.vertFaces[e[0]] || []).some(faceVisible) ||
            (this.vertFaces[e[1]] || []).some(faceVisible);
          if (!visible) return;
        }
        hits.push(i);
      });
    } else if (target === "section") {
      this.sectionZ.forEach((z, si) => {
        const vids = this.sectionVerts[si] || [];
        const pts = vids.map((vi) => ({ vi, q: project(this.verts[vi]) }))
          .filter((x) => x.q.z <= 1 && pointInRect2D(x.q, box));
        const center = project(this.sectionCentroid[si]);
        const inside = pts.length > 0 || (center.z <= 1 && pointInRect2D(center, box));
        if (!inside) return;
        if (visibleOnly && !(this.sectionFaces[si] || []).some(faceVisible)) return;
        hits.push(si);
      });
    }
    return { target, hits };
  }

  selectInRect(x0, y0, x1, y1, action = "replace") {
    const found = this.boxHits(x0, y0, x1, y1);
    if (found && this.onBoxPick) this.onBoxPick(this, found.hits, action, found.target);
  }

  queueBoxSelection(x0, y0, x1, y1, action = "replace") {
    const seq = (this._boxSeq = (this._boxSeq || 0) + 1);
    this.boxBusy = true;
    const status = $("statusText");
    if (status) {
      status.textContent = "Выделение рамкой…";
      status.classList.add("running");
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (seq !== this._boxSeq) return;
      const found = this.boxHits(x0, y0, x1, y1);
      if (seq !== this._boxSeq) return;
      this.boxBusy = false;
      if (status) status.classList.remove("running");
      if (found && this.onBoxPick) this.onBoxPick(this, found.hits, action, found.target);
      else if (status) status.textContent = "Рамка: ничего не выбрано";
    }));
  }

  cancelBoxWork() {
    this._boxSeq = (this._boxSeq || 0) + 1;
    this.boxBusy = false;
    const status = $("statusText");
    if (status) {
      status.classList.remove("running");
      if (status.textContent === "Выделение рамкой…") status.textContent = "Готово";
    }
  }

  previewInRect(x0, y0, x1, y1, action = "replace") {
    const found = this.boxHits(x0, y0, x1, y1);
    if (!found) { this.clearPreview(); return null; }
    this.showPreview(found.target, found.hits, action);
    return found;
  }

  queuePreview() {
    if (!this.boxDrag || this._previewTimer) return;
    this._previewTimer = setTimeout(() => {
      this._previewTimer = null;
      const drag = this.boxDrag;
      if (!drag) return;
      if (Math.abs(drag.x1 - drag.x0) < 5 && Math.abs(drag.y1 - drag.y0) < 5) {
        this.clearPreview();
        return;
      }
      this.previewInRect(drag.x0, drag.y0, drag.x1, drag.y1, drag.action);
    }, 40);
  }

  clearPreview() {
    if (this._previewTimer) {
      clearTimeout(this._previewTimer);
      this._previewTimer = null;
    }
    this._previewCount = null;
    if (this.previewGroup && this.previewGroup.children.length) {
      while (this.previewGroup.children.length) {
        const child = this.previewGroup.children.pop();
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      }
      this.requestRender();
    }
    this.updateMarqueeLabel();
  }

  showPreview(target, hits, action = "replace") {
    this.clearPreview();
    this._previewCount = hits.length;
    this.updateMarqueeLabel();
    if (!hits.length || !this.previewGroup) return;
    const color = action === "add" ? 0x55d68b : action === "subtract" ? 0xff6b7a : VIEW_COLORS.highlight;
    const add = (obj) => { obj.renderOrder = 40; this.previewGroup.add(obj); this.requestRender(); };
    if (target === "face") {
      const pos = [];
      hits.forEach((fi) => {
        const f = this.faces[fi];
        if (!f) return;
        triangulateFace(f, this.verts).forEach((t) => {
          t.forEach((vi) => {
            const p = this.verts[vi];
            if (p) pos.push(p[0], p[1], p[2]);
          });
        });
      });
      if (!pos.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.42, side: THREE.DoubleSide,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      add(new THREE.Mesh(geo, mat));
    } else if (target === "vertex") {
      const pos = [];
      hits.forEach((i) => {
        const p = this.verts[i];
        if (p) pos.push(p[0], p[1], p[2]);
      });
      if (!pos.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        color, size: 0.075, sizeAttenuation: true, depthTest: false, transparent: true, opacity: 0.95,
      });
      add(new THREE.Points(geo, mat));
    } else if (target === "edge") {
      const pos = [];
      hits.forEach((i) => {
        const e = this.edges[i];
        if (!e) return;
        const a = this.verts[e[0]], b = this.verts[e[1]];
        if (a && b) pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      });
      if (!pos.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      const mat = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
      add(new THREE.LineSegments(geo, mat));
    } else if (target === "section") {
      const points = [];
      hits.forEach((si) => {
        const vids = this.sectionVerts[si] || [];
        const c = this.sectionCentroid[si];
        if (!c) return;
        const order = vids.slice().sort((a, b) =>
          Math.atan2(this.verts[a][1] - c[1], this.verts[a][0] - c[0]) -
          Math.atan2(this.verts[b][1] - c[1], this.verts[b][0] - c[0]));
        const ring = [];
        order.forEach((vi) => {
          const p = this.verts[vi];
          if (p) ring.push(p[0], p[1], p[2]);
        });
        if (ring.length >= 6) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.Float32BufferAttribute(ring, 3));
          const mat = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
          add(new THREE.LineLoop(geo, mat));
        }
        vids.forEach((vi) => {
          const p = this.verts[vi];
          if (p) points.push(p[0], p[1], p[2]);
        });
      });
      if (points.length) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
        const mat = new THREE.PointsMaterial({
          color, size: 0.06, sizeAttenuation: true, depthTest: false, transparent: true, opacity: 0.95,
        });
        add(new THREE.Points(geo, mat));
      }
    }
  }

  applyTypeSelection(points, mode, polys = [], ids = []) {
    if (!points.length || !this.mesh) return new Set();
    const out = new Set();
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
        exactFaces.forEach((fi) => { this.hlFaces.add(fi); out.add(fi); });
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
            if (hit) { this.hlFaces.add(fi); out.add(fi); }
          }
        }
        this.selFaces = new Set(this.hlFaces);
      } else if (mode === "section") {
        exactSections.forEach((si) => {
          if (si >= 0 && si < this.sectionZ.length) { this.hlSections.add(si); out.add(si); }
        });
        mappedPoints.forEach((p) => {
          let si = -1, best = Infinity;
          this.sectionZ.forEach((z, k) => { const d = Math.abs(z - p[2]); if (d < best) { best = d; si = k; } });
          if (si >= 0) { this.hlSections.add(si); out.add(si); }
        });
        this.hlSections.forEach((si) => {
          (this.sectionFaces[si] || []).forEach((fi) => this.hlFaces.add(fi));
          (this.sectionVerts[si] || []).forEach((i) => this.hlVerts.add(i));
        });
      } else if (mode === "edge") {
        exactEdges.forEach((ei) => {
          if (ei >= 0 && ei < this.edges.length) { this.hlEdges.add(ei); out.add(ei); }
        });
        mappedPoints.forEach((p) => {
          let best = -1, bd = Infinity;
          this.edges.forEach((e, ei) => {
            const d = pointSegDist2(p, this.verts[e[0]], this.verts[e[1]]);
            if (d < bd) { bd = d; best = ei; }
          });
          if (best >= 0) { this.hlEdges.add(best); out.add(best); }
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
          out.add(i);
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
            (this.faces[fi] || []).forEach((i) => { this.hlVerts.add(i); out.add(i); });
          });
          loose.forEach((p) => {
            let found = false;
            this.verts.forEach((c, i) => {
              if (near(c, p)) { this.hlVerts.add(i); out.add(i); found = true; }
            });
            if (!found && this.verts.length) {
              let best = -1, bd = Infinity;
              this.verts.forEach((c, i) => { const d = dist2(c, p); if (d < bd) { bd = d; best = i; } });
              if (best >= 0) { this.hlVerts.add(best); out.add(best); }
            }
          });
        }
      }
    }
    return out;
  }

  applySelection(state) {
    this.hlFaces = new Set();
    this.selFaces = new Set();
    this.selIds = { face: new Set(), vert: new Set(), edge: new Set(), section: new Set() };
    this.hlVerts = new Set();
    this.hlSections = new Set();
    this.hlEdges = new Set();
    this.hlMode = state.mode || "face";
    const buckets = state.buckets || {};
    const list = {};
    ["face", "vert", "edge", "section"].forEach((mode) => {
      const b = buckets[mode];
      list[mode] = b && b.points ? b : { points: [], polys: [], ids: [] };
    });
    if (state.points && state.points.length) {
      list[state.mode] = { points: state.points, polys: state.polys || [], ids: state.ids || [] };
    }
    ["face", "vert", "edge", "section"].forEach((mode) => {
      const b = list[mode];
      if (b.points.length) this.selIds[mode] = this.applyTypeSelection(b.points, mode, b.polys || [], b.ids || []);
    });
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
    this.stopViewAnimation();
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
      : "";
  }

  copyCamera(src) {
    this.stopViewAnimation();
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
    this.requestRender();
  }

  frameTarget(mesh) {
    const v = mesh.v;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    v.forEach((p) => p.forEach((x, i) => { min[i] = Math.min(min[i], x); max[i] = Math.max(max[i], x); }));
    const c = min.map((m, i) => (m + max[i]) / 2);
    const r = Math.max(0.5, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
    return {
      position: new THREE.Vector3(c[0] + r * 2.1, c[1] - r * 2.4, c[2] + r * 1.7),
      target: new THREE.Vector3(c[0], c[1], c[2]),
      near: r / 50,
      far: r * 60,
      half: r * 1.25,
    };
  }

  frame(mesh) {
    this.stopViewAnimation();
    const view = this.frameTarget(mesh);
    this.camera.position.copy(view.position);
    this.controls.target.copy(view.target);
    this.camera.near = view.near;
    this.camera.far = view.far;
    if (this.isOrtho) {
      this.orthoHalfH = view.half;
      this.orthoCamera.zoom = 1;
      this.resize();
    } else {
      this.camera.updateProjectionMatrix();
    }
    this.controls.update();
    this.requestRender();
  }

  resetView(mesh) {
    const view = this.frameTarget(mesh);
    const startPosition = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const startUp = this.camera.up.clone().normalize();
    const endUp = new THREE.Vector3(0, 0, 1);
    const startHalf = this.orthoHalfH;
    const startZoom = this.orthoCamera.zoom;
    const duration = 560;
    const started = performance.now();
    this.stopViewAnimation();
    this.controls.enabled = false;
    this.camera.near = view.near;
    this.camera.far = view.far;
    const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const step = () => {
      const t = Math.min(1, (performance.now() - started) / duration);
      const k = ease(t);
      this.camera.position.lerpVectors(startPosition, view.position, k);
      this.controls.target.lerpVectors(startTarget, view.target, k);
      this.camera.up.copy(startUp).lerp(endUp, k).normalize();
      if (this.isOrtho) {
        this.orthoHalfH = startHalf + (view.half - startHalf) * k;
        this.orthoCamera.zoom = startZoom + (1 - startZoom) * k;
        this.resize();
      } else {
        this.camera.updateProjectionMatrix();
      }
      this.camera.lookAt(this.controls.target);
      this.controls.update();
      this.onCam(this);
      if (t < 1) {
        this._resetFrame = requestAnimationFrame(step);
      } else {
        this._resetFrame = null;
        this.controls.enabled = true;
      }
    };
    step();
  }
}
function makeCard() {
  const card = document.createElement("div");
  card.className = "viewer-card is-empty";
  card.innerHTML = `<div class="viewer-head">
      <select class="vmodel" title="Модель в этом вьюпорте" aria-label="Модель в этом вьюпорте"></select>
      <select class="vsel" title="Вариант обработки" aria-label="Вариант обработки"></select>
      <div class="vactions">
        <button class="vdel icon-btn" type="button" title="Убрать это окно" aria-label="Убрать это окно"><svg class="icon"><use href="#i-minus"/></svg></button>
        <button class="vadd icon-btn" type="button" title="Добавить окно в полноэкранную сетку" aria-label="Добавить окно"><svg class="icon"><use href="#i-plus"/></svg></button>
        <button class="vmax icon-btn" type="button" title="Развернуть или свернуть этот вьюпорт (F)" aria-label="Развернуть вьюпорт"><svg class="icon"><use href="#i-expand"/></svg></button>
      </div>
      <span class="vmeta meta"></span>
    </div>
    <div class="canvas-wrap">
      <canvas class="view"></canvas>
      <div class="empty-state" aria-hidden="true">
        <svg class="icon"><use href="#i-gem"/></svg>
        <strong>Модели пока нет</strong>
        <span>Выберите тело или файлы слева и запустите конвейер — <kbd>R</kbd></span>
      </div>
      <div class="hud">
        <div class="gizmo" role="img" title="3D-оси: клик по X, Y или Z плавно выравнивает камеру" aria-label="3D-оси X, Y, Z"></div>
        <div class="cur"></div>
      </div>
    </div>`;
  $("viewers").appendChild(card);
  return card;
}

function closeViewerShotMenus(except = null) {
  document.querySelectorAll(".vshot-menu.open").forEach((menu) => {
    if (menu !== except) menu.classList.remove("open");
  });
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
  $("viewers").classList.toggle("fullscreen", App.fullscreen);
  document.querySelector(".workspace").classList.toggle("solo-mode", App.fullscreen);
  document.body.classList.toggle("viewer-full", App.fullscreen);
  App.viewers.forEach((x) => {
    const btn = x.card.querySelector(".vmax");
    if (btn) btn.setAttribute("aria-pressed", String(App.fullscreen));
  });
  layoutViewers();
  App.viewers.forEach((x) => x.resize());
}

function addViewer() {
  if (App.viewers.length >= 6) return;
  const card = makeCard();
  const v = new Viewer(card, handlePick, handleCam, handleBoxPick);
  v.isolate = App.isolate;
  v.selTarget = App.selTarget;
  v.setOrtho(App.ortho);
  v.setBoxSelect(App.boxSelect);
  card.querySelector(".vmax").onclick = () => toggleSolo(v);
  card.querySelector(".vmax").setAttribute("aria-pressed", String(App.fullscreen));
  card.querySelector(".vadd").onclick = () => addViewer();
  card.querySelector(".vdel").onclick = () => removeViewer(v);
  card.addEventListener("pointerdown", () => setActiveViewer(v));
  App.viewers.push(v);
  if (App.fullscreen) {
    App.fullViews.push(v);
    setActiveViewer(v);
  }
  populateViewer(v, App.viewers.length - 1);
  if (App.models.length) loadViewer(v).then(() => v.applySelection(App.sel));
  if (App.viewers.length > 1) v.copyCamera(App.viewers[0]);
  layoutViewers();
  updateViewButtons();
  updateDiff();
  v.select.onchange = () => {
    v.select.title = v.select.selectedOptions[0]?.textContent || "Вариант обработки";
    setActiveViewer(v);
    loadViewer(v);
  };
  if (v.modelSel) {
    v.modelSel.onchange = async () => {
      v.modelIdx = +v.modelSel.value;
      populateViewer(v, App.viewers.indexOf(v));
      setActiveViewer(v);
      if (typeof syncPrimaryFromViewer === "function") syncPrimaryFromViewer(v);
      await loadViewer(v);
    };
  }
  return v;
}

function removeViewer(target = null) {
  if (App.viewers.length <= 1) return;
  const v = target && App.viewers.includes(target)
    ? target
    : App.viewers[App.viewers.length - 1];
  App.viewers = App.viewers.filter((x) => x !== v);
  v.dispose();
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
  if (!App.models.length) return;
  let modelIdx = Number.isInteger(v.modelIdx) ? v.modelIdx : App.modelIdx;
  if (modelIdx < 0 || modelIdx >= App.models.length) modelIdx = 0;
  v.modelIdx = modelIdx;
  const model = App.models[modelIdx];
  if (!model) return;
  const labels = typeof modelLabels === "function" ? modelLabels() : App.models.map((m) => m.name);
  if (v.modelSel) {
    v.modelSel.innerHTML = App.models.map((m, i) => `<option value="${i}">${escapeHtml(labels[i])}</option>`).join("");
    v.modelSel.value = String(modelIdx);
    v.modelSel.title = labels[modelIdx] || "Модель в этом вьюпорте";
  }
  const results = orderedResults(model.results);
  if (!results.length) {
    v.select.innerHTML = "";
    return;
  }
  v.select.innerHTML = results.map((r) => `<option value="${r.id}">${escapeHtml(r.label)}</option>`).join("");
  const setResult = (id) => {
    v.select.value = id;
    v.select.title = v.select.selectedOptions[0]?.textContent || "Вариант обработки";
  };
  if (model.levels) {
    const cand = results.filter((r) => hasMesh(r));
    const pick = cand[Math.min(idx, cand.length - 1)] || cand[0];
    setResult((pick || results[0]).id);
    return;
  }
  let pick = null;
  if (idx === 0) {
    pick = results.find((r) => r.id.endsWith(":ref"));
  } else if (idx === 1) {
    const cand = results.filter((r) => hasMesh(r) && !r.id.includes(":ref") && r.metrics && r.metrics.mse != null);
    cand.sort((a, b) => a.metrics.mse - b.metrics.mse);
    pick = cand[0];
  } else {
    pick = results.filter((r) => hasMesh(r) && !r.id.includes(":ref"))[idx - 1] ||
           results.filter((r) => hasMesh(r))[0];
  }
  setResult((pick || results[0]).id);
}

async function loadViewer(v) {
  ensureSelBuckets();
  App.sel.anchor = null;
  ["face", "vert", "edge", "section"].forEach((mode) => {
    const bucket = App.sel.buckets[mode];
    bucket.ids = bucket.ids.filter((id) => id.viewer !== v);
  });
  App.sel.ids = selBucket(App.sel.mode).ids;
  const id = v.select.value;
  if (!id) return;
  const seq = (v.loadSeq || 0) + 1;
  v.loadSeq = seq;
  const model = App.models[v.modelIdx] || currentModel();
  const result = model && model.results ? model.results.find((x) => x.id === id) : null;
  if (result && result.kind === "fail") {
    const error = result.error || "Модель вырождена";
    v.setMesh(null, App.mode, false);
    v.setEmptyState("Модель вырождена", error.replace(/^Модель вырождена:\s*/i, ""));
    v.meta.textContent = error;
    v.meta.title = error;
    updateDiff();
    selectionText();
    return;
  }
  try {
    const r = await meshOf(id);
    if (v.loadSeq !== seq) return;
    v.setMesh(r.mesh, App.mode, !!v.mesh);
    v.applySelection(App.sel);
    syncViewerIds(v);
    const m = r.metrics || {};
    v.meta.innerHTML = `${badge(r.quality)} MSE ${fmt(m.mse)} · RMSE ${fmt(m.rmse)} · dmax ${fmt(m.dmax)} · ${r.time != null ? r.time + " с" : "—"}`;
    updateDiff();
    selectionText();
  } catch (err) {
    if (v.loadSeq !== seq) return;
    v.setMesh(null, App.mode, false);
    v.meta.textContent = "Не удалось загрузить вариант";
    v.meta.title = err.message || "";
    updateDiff();
    selectionText();
  }
}

function syncViewerIds(v) {
  ensureSelBuckets();
  ["face", "vert", "edge", "section"].forEach((mode) => {
    const bucket = App.sel.buckets[mode];
    bucket.ids = bucket.ids.filter((id) => id.viewer !== v);
    const set = v.selIds && v.selIds[mode];
    if (set) set.forEach((index) => bucket.ids.push({ viewer: v, type: mode, index }));
  });
  App.sel.ids = selBucket(App.sel.mode).ids;
}

async function loadAllViewers() {
  await Promise.all(App.viewers.map((v) => loadViewer(v)));
  App.viewers.forEach((v) => v.applySelection(App.sel));
}

const SEL_MODES = ["face", "vert", "edge", "section"];
const SEL_WORDS = {
  face: ["грань", "грани", "граней"],
  vert: ["вершина", "вершины", "вершин"],
  edge: ["ребро", "ребра", "рёбер"],
  section: ["сечение", "сечения", "сечений"],
};

function ensureSelBuckets() {
  if (!App.sel) App.sel = { mode: "face", points: [], polys: [], ids: [], anchor: null };
  if (!App.sel.buckets) {
    App.sel.buckets = {};
    SEL_MODES.forEach((mode) => { App.sel.buckets[mode] = { points: [], polys: [], ids: [] }; });
    const current = App.sel.buckets[App.sel.mode] || App.sel.buckets.face;
    current.points = App.sel.points || [];
    current.polys = App.sel.polys || [];
    current.ids = App.sel.ids || [];
  } else {
    SEL_MODES.forEach((mode) => {
      if (!App.sel.buckets[mode]) App.sel.buckets[mode] = { points: [], polys: [], ids: [] };
    });
  }
}

function selBucket(mode = App.sel.mode) {
  ensureSelBuckets();
  return App.sel.buckets[mode] || App.sel.buckets.face;
}

function syncSelBucket() {
  ensureSelBuckets();
  const bucket = selBucket();
  bucket.points = App.sel.points;
  bucket.polys = App.sel.polys;
  bucket.ids = App.sel.ids;
}

function loadSelBucket(mode) {
  ensureSelBuckets();
  syncSelBucket();
  App.sel.mode = mode;
  const bucket = selBucket(mode);
  App.sel.points = bucket.points;
  App.sel.polys = bucket.polys;
  App.sel.ids = bucket.ids;
  App.sel.anchor = null;
}

function modeOfTarget(target) {
  return target === "vertex" ? "vert" : target;
}

function selectionCount(mode) {
  return selBucket(mode).points.length;
}

function selectionTotal() {
  return SEL_MODES.reduce((sum, mode) => sum + selectionCount(mode), 0);
}

function elementPayload(src, mode, indexes) {
  const points = [], polys = [], ids = [];
  indexes.forEach((i) => {
    if (mode === "edge") {
      if (!src.edges[i]) return;
      points.push(src.edgePoint(i));
      polys.push(null);
    } else if (mode === "section") {
      if (!src.sectionCentroid[i]) return;
      points.push(src.sectionCentroid[i].slice());
      polys.push(null);
    } else if (mode === "vert") {
      if (!src.verts[i]) return;
      points.push(src.verts[i].slice());
      polys.push(null);
    } else {
      if (!src.faceCentroids[i]) return;
      points.push(src.faceCentroids[i].slice());
      polys.push(src.facePolys[i].map((p) => p.slice()));
    }
    ids.push({ viewer: src, type: mode, index: i });
  });
  return { points, polys, ids };
}

function handlePick(src, point, type, action, poly, index) {
  ensureSelBuckets();
  if (App.sel.mode !== type) loadSelBucket(type);
  if (!App.sel.polys) App.sel.polys = [];
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

function applyElementSelection(src, mode, indexes, action = "replace") {
  if (!src || !src.mesh) return;
  loadSelBucket(mode);
  const payload = elementPayload(src, mode, indexes);
  if (action === "replace") {
    App.sel.points = payload.points;
    App.sel.polys = payload.polys;
    App.sel.ids = payload.ids;
  } else if (action === "add") {
    const hasId = (id) => App.sel.ids.some((x) => x.viewer === id.viewer && x.type === id.type && x.index === id.index);
    payload.ids.forEach((id, k) => {
      if (hasId(id)) return;
      App.sel.points.push(payload.points[k]);
      App.sel.polys.push(payload.polys[k]);
      App.sel.ids.push(id);
    });
  } else if (action === "subtract") {
    const drop = new Set(indexes);
    const points = [], polys = [], ids = [];
    App.sel.ids.forEach((id, i) => {
      if (id.viewer === src && id.type === mode && drop.has(id.index)) return;
      points.push(App.sel.points[i]);
      polys.push(App.sel.polys[i]);
      ids.push(id);
    });
    App.sel.points = points;
    App.sel.polys = polys;
    App.sel.ids = ids;
  }
  App.sel.anchor = null;
  broadcastSelection();
}

function handleBoxPick(src, indexes, action, target) {
  const mode = modeOfTarget(target || src.selTarget);
  applyElementSelection(src, mode, indexes, action);
  const total = selectionCount(mode);
  const verb = action === "subtract" ? "убрано" : (action === "add" ? "добавлено" : "выбрано");
  const what = plural(indexes.length, ...SEL_WORDS[mode]);
  const status = $("statusText");
  if (status) {
    status.textContent = `Рамка: ${verb} ${indexes.length} ${what}, всего ${total}`;
    status.title = "ЛКМ — рамка, Shift — добавить, Ctrl — убрать, ПКМ — вращать";
  }
}

function clearSelection() {
  ensureSelBuckets();
  const had = selectionTotal();
  SEL_MODES.forEach((mode) => {
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
  if (had) {
    const status = $("statusText");
    if (status) status.textContent = "Выделение снято";
  }
}

function invertSelection() {
  const v = activeViewer();
  if (!v || !v.mesh) return;
  const mode = modeOfTarget(App.selTarget);
  const total = mode === "face" ? v.faceCentroids.length
    : mode === "section" ? v.sectionZ.length
    : mode === "edge" ? v.edges.length : v.verts.length;
  loadSelBucket(mode);
  const selected = mode === "face" ? v.selFaces
    : mode === "section" ? v.hlSections
    : mode === "edge" ? v.hlEdges : v.hlVerts;
  const picked = new Set(selected || []);
  const indexes = [];
  for (let i = 0; i < total; i++) if (!picked.has(i)) indexes.push(i);
  applyElementSelection(v, mode, indexes, "replace");
  const status = $("statusText");
  if (status) status.textContent = `Инверсия: ${indexes.length} из ${total} · ${plural(indexes.length, ...SEL_WORDS[mode])}`;
}

function growSelection(step) {
  const v = activeViewer();
  if (!v || !v.mesh) return;
  if (App.selTarget !== "face") {
    const status = $("statusText");
    if (status) status.textContent = "Рост и сужение работают для граней";
    return;
  }
  const current = new Set(v.selFaces || []);
  if (!current.size) return;
  let next = current;
  if (step > 0) {
    next = new Set(current);
    current.forEach((fi) => (v.faceAdj[fi] || []).forEach((fj) => next.add(fj)));
  } else {
    next = new Set();
    current.forEach((fi) => {
      const adj = v.faceAdj[fi] || [];
      if (adj.length && adj.every((fj) => current.has(fj))) next.add(fi);
    });
  }
  applyElementSelection(v, "face", [...next], "replace");
  const status = $("statusText");
  if (status) {
    status.textContent = step > 0
      ? `Добавлены соседние грани: ${next.size}`
      : `Оставлены внутренние грани: ${next.size}`;
  }
}

function plural(n, one, few, many) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function broadcastSelection() {
  syncSelBucket();
  App.viewers.forEach((v) => v.applySelection(App.sel));
  selectionText();
  updateSelectionActions();
}

function selectionText() {
  ensureSelBuckets();
  const info = $("selectionInfo");
  const v = activeViewer() || App.viewers[0];
  const counts = {};
  SEL_MODES.forEach((mode) => { counts[mode] = selectionCount(mode); });
  const total = selectionTotal();
  if (!info || !total || !v || !v.mesh) {
    if (info) info.textContent = "Выделение: —";
    updateSelectionActions();
    return;
  }
  const parts = SEL_MODES.filter((mode) => counts[mode]).map((mode) => {
    const n = counts[mode];
    return `${plural(n, ...SEL_WORDS[mode])}: ${n}`;
  });
  let text = `Выделение: ${total} ${plural(total, "элемент", "элемента", "элементов")} · ${parts.join(" · ")}`;
  const faceIds = v.selFaces || new Set();
  let title = "";
  if (faceIds.size) {
    let area = 0, totalArea = 0, count = 0;
    const verts = new Set();
    v.faces.forEach((f, fi) => {
      const a = polyArea3(v.verts, f);
      totalArea += a;
      if (!faceIds.has(fi)) return;
      area += a;
      count++;
      f.forEach((i) => verts.add(i));
    });
    const share = totalArea > 0 ? (area / totalArea * 100) : 0;
    text += ` · площадь ${fmt(area)} (${share.toFixed(1)}%) · ${verts.size} ${plural(verts.size, "вершина", "вершины", "вершин")}`;
    title = `Граней: ${count}; площадь выделения: ${fmt(area)}; площадь модели: ${fmt(totalArea)}; доля: ${share.toFixed(2)}%`;
  }
  const active = App.sel.mode;
  const per = App.viewers.map((x, i) => {
    const n = active === "face" ? (x.selFaces ? x.selFaces.size : 0)
      : active === "section" ? (x.hlSections ? x.hlSections.size : 0)
      : active === "edge" ? (x.hlEdges ? x.hlEdges.size : 0)
      : (x.hlVerts ? x.hlVerts.size : 0);
    const isActive = x === v;
    if (!n && !isActive) return null;
    return `окно ${i + 1}${isActive ? " (активно)" : ""}: ${n}`;
  }).filter(Boolean);
  if (per.length) text += " · " + per.join(" · ");
  info.textContent = text;
  info.title = title;
  updateSelectionActions();
}

function updateSelectionActions() {
  ensureSelBuckets();
  const total = selectionTotal();
  const active = activeViewer();
  const faceSel = !!(active && active.selFaces && active.selFaces.size);
  const copy = $("selCopy");
  if (copy) copy.disabled = total === 0;
  const grow = $("selGrow");
  if (grow) grow.disabled = !(faceSel && App.selTarget === "face");
  const shrink = $("selShrink");
  if (shrink) shrink.disabled = !(faceSel && App.selTarget === "face");
  const obj = $("objSelBtn");
  if (obj) obj.disabled = !faceSel;
}

function setBoxSelect(on) {
  const next = !!on;
  App.boxSelect = next;
  const btn = $("boxSel");
  if (btn) {
    btn.classList.toggle("active", next);
    btn.setAttribute("aria-pressed", String(next));
  }
  const hint = $("boxHint");
  if (hint) hint.classList.toggle("hidden", !next);
  updateBoxHint();
  App.viewers.forEach((v) => v.setBoxSelect(next));
  document.body.classList.toggle("box-select-mode", next);
}

function updateBoxHint() {
  const hint = $("boxHint");
  if (!hint) return;
  const target = App.selTarget;
  const what = target === "vertex" ? "вершины" : target === "edge" ? "рёбра"
    : target === "section" ? "сечения" : "грани";
  hint.textContent = `Рамка: ЛКМ — выделить ${what}, Shift — добавить, Ctrl — убрать, ПКМ — вращать. Выход — B или Esc.`;
}

function handleCam(src) {
  if (!App.syncCam || App.camLock) return;
  App.camLock = true;
  App.viewers.forEach((v) => { if (v !== src) v.copyCamera(src); });
  App.camLock = false;
}

// ---------------------------------------------------------------- модель и результаты

