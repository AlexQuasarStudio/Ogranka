"""Локальное приложение-конвейер: сервер + веб-интерфейс.

Запуск:  python app.py [--port 8765] [--no-browser]
Зависимости: numpy, scipy.
"""
import argparse
import csv
import io
import json
import os
import platform
import shutil
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import numpy as np
from concurrent.futures import ThreadPoolExecutor

from core import pipeline

pipeline.ENGINE = "fast"

APP_VERSION = "1.0.0"
APP_AUTHOR = "Дьяченко Алексей"
APP_ADVISOR = "Валединский Владимир Дмитриевич"
APP_TITLE = f"Огранка {APP_VERSION} — восстановление формы"


def _console_print(*args, **kwargs):
    try:
        print(*args, **kwargs)
    except Exception:
        pass


class Api:
    def toggle_fullscreen(self):
        import webview
        win = webview.windows[0]
        win.toggle_fullscreen()
        return True

    def save_csv(self):
        text = _csv_text()
        try:
            import webview
            win = webview.windows[0] if webview.windows else None
            if win is None:
                return {"error": "нет окна"}
            path = win.create_file_dialog(webview.SAVE_DIALOG, save_filename="metrics.csv",
                                          file_types=("CSV (*.csv)",))
        except Exception as exc:
            return {"error": str(exc)}
        if not path:
            return {"cancelled": True}
        if isinstance(path, (list, tuple)):
            path = path[0]
        try:
            with open(path, "w", encoding="utf-8-sig", newline="") as f:
                f.write(text)
            return {"path": path}
        except Exception as exc:
            return {"error": str(exc)}

FROZEN = getattr(sys, "_MEIPASS", None)
BASE = FROZEN or os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(BASE, "static")


def _data_dir():
    if FROZEN:
        home = os.path.expanduser("~")
        if platform.system() == "Darwin":
            root = os.path.join(home, "Library", "Application Support", "ShapePipeline")
        elif platform.system() == "Windows":
            root = os.path.join(os.environ.get("APPDATA", home), "ShapePipeline")
        else:
            root = os.path.join(home, ".local", "share", "shape-pipeline")
    else:
        root = os.path.dirname(os.path.abspath(__file__))
    return root


DATA = _data_dir()
UPLOADS = os.path.join(DATA, "uploads")
RUNS = os.path.join(DATA, "runs")
os.makedirs(UPLOADS, exist_ok=True)
os.makedirs(RUNS, exist_ok=True)

LOCK = threading.Lock()
STATE = {"job": None, "models": None}
LIVE = {"key": None, "base": None}
LIVE_LOCK = threading.Lock()


def load_latest():
    if not os.path.isdir(RUNS):
        return None
    cands = []
    for d in os.listdir(RUNS):
        p = os.path.join(RUNS, d, "results.json")
        if os.path.isfile(p):
            cands.append((os.path.getmtime(p), p))
    if not cands:
        return None
    cands.sort()
    try:
        with open(cands[-1][1], encoding="utf-8") as f:
            return json.load(f).get("models")
    except Exception:
        return None


def demo_body(name):
    phi = (1 + 5 ** 0.5) / 2
    if name == "octa":
        v = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
    elif name == "icosa":
        v = [[0, 1, phi], [0, 1, -phi], [0, -1, phi], [0, -1, -phi],
             [1, phi, 0], [1, -phi, 0], [-1, phi, 0], [-1, -phi, 0],
             [phi, 0, 1], [phi, 0, -1], [-phi, 0, 1], [-phi, 0, -1]]
    elif name == "dodeca":
        v = []
        for a in (1, -1):
            for b in (1, -1):
                for c in (1, -1):
                    v.append([a, b, c])
        for a in (1, -1):
            for b in (1, -1):
                v += [[0, a / phi, b * phi], [a / phi, b * phi, 0], [a * phi, 0, b / phi]]
    elif name == "diamond":
        v = []
        for r, z in [(0.8, 3.0), (1.7, 2.05), (1.7, 1.95), (0.1, 0.0)]:
            for k in range(10):
                a = 2 * np.pi * k / 10
                v.append([r * np.cos(a), r * np.sin(a), z])
    elif name == "cube":
        v = [[x, y, z] for z in (0.0, 3.0) for x in (-1.0, 1.0) for y in (-1.0, 1.0)]
    elif name == "prism":
        v = []
        for z in (0.0, 3.0):
            for k in range(8):
                a = 2 * np.pi * k / 8 + np.pi / 8
                v.append([1.2 * np.cos(a), 1.2 * np.sin(a), z])
    else:
        raise ValueError(f"неизвестное тело: {name}")
    return np.asarray(v, float)


GOOD_RMSE = 0.03
MEDIUM_RMSE = 0.12


def quality(m):
    if not m or m.get("rmse") is None:
        return None
    r = float(m["rmse"])
    return "good" if r < GOOD_RMSE else ("medium" if r < MEDIUM_RMSE else "bad")


def _stage(text, progress, detail="", eta=None, **extra):
    with LOCK:
        job = STATE["job"]
        if not job:
            return
        started = job.get("started") or time.time()
        elapsed = time.time() - started
        p = max(0.0, min(1.0, float(progress)))
        if eta is None and p > 0.02:
            eta = max(1, int(elapsed / p * (1 - p)))
        job.update(stage=text, detail=detail, progress=round(p, 4),
                   eta=eta, elapsed=round(elapsed, 1), updated=time.time())
        if extra:
            job.update(extra)


def _prepare(source, report=None):
    def say(text, frac):
        if report:
            report(text, frac)

    if source["kind"] == "demo":
        say("демо-тело", 0.01)
        v = pipeline.normalize_mesh(demo_body(source["name"]), flip=False)
        title = {"octa": "Октаэдр", "icosa": "Икосаэдр", "dodeca": "Додекаэдр",
                 "diamond": "Бриллиант", "cube": "Куб", "prism": "Восьмиугольная призма"}[source["name"]]
        say("нормализация", 0.03)
        v, faces = pipeline.hull(v)
        say("выпуклая оболочка", 0.05)
        return v, faces, title

    path = source["path"]
    say("чтение файла", 0.01)
    with open(path, encoding="utf-8", errors="ignore") as fh:
        text = fh.read()
    say("разбор OBJ" if path.lower().endswith(".obj") else "разбор точек", 0.02)
    if path.lower().endswith(".obj"):
        v, faces = pipeline.parse_obj(text)
    else:
        v = pipeline.parse_points(text)
        faces = []
    if len(v) < 4:
        raise ValueError("меньше четырёх точек")
    say("нормализация", 0.04)
    v = pipeline.normalize_mesh(v, flip=True)
    say("выпуклая оболочка", 0.06)
    v, faces = pipeline.hull(v)
    return v, faces, source.get("name") or os.path.basename(path)


def _run(sources, params):
    t0 = time.time()
    models = []
    n_models = max(1, len(sources))
    try:
        n_angles = int(params.get("angles", 720))
        n_layers = int(params.get("layers", 60))
        mode = params.get("mode", "envelope")
        methods = params.get("methods", ["fft", "none"])
        levels = [float(x) for x in params.get("noise", [0.008, 0.08])]
        harmonics = int(params.get("harmonics", 32))
        window = int(params.get("window", 5))
        do_min = bool(params.get("minimal", True))
        loss = float(params.get("loss", 0.1)) / 100.0
        angle = float(params.get("angle", 1.0))

        for mi, source in enumerate(sources):
            base = mi / n_models
            span = 1.0 / n_models
            name_hint = source.get("name") or "модель"

            def mreport(text, frac, detail=None):
                _stage(f"Модель {mi + 1}/{n_models}: {text}",
                       base + span * max(0.0, min(1.0, frac)),
                       detail=detail or name_hint, model=mi + 1, models=n_models)

            mreport("подготовка", 0.005)
            v, faces, title = _prepare(source, lambda t, f: mreport(t, f))
            mreport("сечения", 0.08)

            def sec_progress(p, _report=mreport):
                q = (float(p) - 0.05) / 0.40
                _report("сечения", 0.08 + 0.12 * max(0.0, min(1.0, q)))

            alphas, layers = pipeline.build_sections(
                v, pipeline.mesh_edges(faces), n_layers, n_angles, progress=sec_progress)
            true_by_z = {round(z, 6): r for z, r in layers}
            ref_metrics = {"mse": 0.0, "rmse": 0.0, "dmax": 0.0}
            results = [{
                "id": f"m{mi}:ref", "label": "Эталон", "kind": "ref",
                "mesh": {"v": v.tolist(), "f": [list(f) for f in faces]},
                "metrics": ref_metrics, "quality": "ref",
                "vertices": int(len(v)), "faces": int(len(faces)), "points": int(len(v)),
            }]

            mreport("эталонный многогранник", 0.21)
            t_ref = time.time()
            try:
                mpref = pipeline.minimal_polyhedron(v)
                pr_v, pr_f = pipeline.polygons_to_mesh(mpref["polygons"])
                results.append({
                    "id": f"m{mi}:refmin", "label": "Эталон · мин. многогранник", "kind": "min",
                    "mesh": {"v": pr_v.tolist(), "f": [list(f) for f in pr_f]},
                    "metrics": ref_metrics, "quality": "ref",
                    "vertices": int(mpref["vertices"]), "faces": int(mpref["faces"]),
                    "points": int(len(v)), "time": round(time.time() - t_ref, 2),
                })
            except Exception:
                pass

            zs = np.array([z for z, _ in layers])
            R_true = np.vstack([r for _, r in layers])
            variants = [(rv, me) for rv in levels for me in methods]
            total_variants = max(1, len(variants))
            A = pinv = None
            if "fft" in methods:
                A, pinv = pipeline.fourier_design(alphas, harmonics)
            vprog = [0.0] * total_variants

            def vstage(vi, frac, text, label):
                with LOCK:
                    vprog[vi] = max(vprog[vi], float(frac))
                    agg = sum(vprog) / total_variants
                    done = sum(1 for x in vprog if x >= 1.0)
                _stage(f"{title}: {label}", base + span * (0.30 + 0.65 * agg),
                       detail=text, model=mi + 1, models=n_models,
                       done=done, total=total_variants)

            with LOCK:
                STATE["models"] = [{"id": mi, "name": title, "results": list(results)}]

            def run_variant(args):
                vi, rv, method = args
                names = {"none": "без сглаживания", "fft": "Фурье+МНК", "uni": "соседи"}
                if rv == 0:
                    label_noise = "точные"
                elif abs(rv - 0.008) < 1e-9:
                    label_noise = "r8"
                elif abs(rv - 0.08) < 1e-9:
                    label_noise = "r80"
                else:
                    label_noise = f"шум {rv:g}"
                label = f"{label_noise} · {names.get(method, method)}"

                vstage(vi, 0.03, "подготовка варианта", label)
                t_var = time.time()
                rng = np.random.default_rng(1000 + mi * 100 + vi)
                R = R_true + rv * rng.uniform(-1.0, 1.0, size=R_true.shape) if rv > 0 else R_true.copy()
                vstage(vi, 0.12, "шум", label)
                if method == "fft":
                    vstage(vi, 0.20, "ряд Фурье и МНК", label)
                    Rs = pipeline.fourier_denoise_matrix(R, A, pinv)
                elif method == "uni":
                    vstage(vi, 0.20, "адаптивные соседи", label)
                    rows = []
                    for ii in range(len(zs)):
                        rows.append(pipeline.uniform_denoise_adaptive(R[ii], R_true[ii], 5, 30))
                        if ii % 2 == 0:
                            vstage(vi, 0.20 + 0.24 * (ii + 1) / len(zs),
                                   f"соседи: слой {ii + 1}/{len(zs)}", label)
                    Rs = np.vstack(rows)
                else:
                    Rs = R
                vstage(vi, 0.45, "сглаживание готово", label)

                pts = []
                for li, z in enumerate(zs):
                    if mode == "maxima":
                        pts += pipeline.maxima_points(alphas, Rs[li], float(z))
                    else:
                        pts += pipeline.envelope_points(alphas, Rs[li], float(z))
                    if li % 5 == 0:
                        vstage(vi, 0.45 + 0.13 * (li + 1) / len(zs),
                               f"точки сечений: слой {li + 1}/{len(zs)}", label)
                vstage(vi, 0.58, "точки сечений", label)

                if len(pts) < 4:
                    out = [{"id": f"m{mi}:v{vi}", "label": label, "kind": "fail", "mesh": None,
                            "metrics": {"mse": None, "rmse": None, "dmax": None},
                            "quality": None, "vertices": 0, "faces": 0, "points": len(pts),
                            "time": round(time.time() - t_var, 2)}]
                else:
                    pts = np.asarray(pts)
                    vstage(vi, 0.68, "выпуклая оболочка", label)
                    hv, hf = pipeline.hull_compact(pts)
                    vstage(vi, 0.78, "метрики", label)
                    m = pipeline.metrics(true_by_z, alphas, pts)
                    out = [{"id": f"m{mi}:v{vi}", "label": label, "kind": "hull",
                            "mesh": {"v": hv.tolist(), "f": [list(f) for f in hf]},
                            "metrics": m, "quality": quality(m),
                            "vertices": int(len(hv)), "faces": int(len(hf)),
                            "points": int(len(pts)), "time": round(time.time() - t_var, 2)}]
                    if do_min:
                        vstage(vi, 0.86, "минимальный многогранник", label)
                        try:
                            mp = pipeline.minimal_polyhedron(pts, angle_tol_deg=angle,
                                                             loss_target=loss, hull=(hv, hf))
                            mv, mf = pipeline.polygons_to_mesh(mp["polygons"])
                            out.append({"id": f"m{mi}:v{vi}m", "label": label + " · мин. многогранник",
                                        "kind": "min", "mesh": {"v": mv.tolist(), "f": [list(f) for f in mf]},
                                        "metrics": m, "quality": quality(m),
                                        "vertices": int(mp["vertices"]), "faces": int(mp["faces"]),
                                        "points": int(len(pts)),
                                        "time": round(time.time() - t_var, 2)})
                        except Exception:
                            pass
                vstage(vi, 1.0, "готово", label)
                with LOCK:
                    results.extend(out)
                    STATE["models"][0]["results"] = list(results)
                return out

            with ThreadPoolExecutor(max_workers=min(4, len(variants)) or 1) as pool:
                list(pool.map(run_variant, [(vi, rv, me) for vi, (rv, me) in enumerate(variants)]))

            mreport("модель готова", 0.96)
            models.append({"id": mi, "name": title, "results": results})

        _stage("Сохранение результатов", 0.985, detail=f"моделей: {len(models)}")
        _save(models)
        with LOCK:
            STATE["models"] = models
            if STATE["job"]:
                STATE["job"].update(state="done", progress=1.0, stage="Готово", detail="",
                                    elapsed=round(time.time() - t0, 1), eta=0)
    except Exception as exc:
        with LOCK:
            if STATE["job"]:
                STATE["job"].update(state="error", error=str(exc), stage="Ошибка",
                                    detail=str(exc), elapsed=round(time.time() - t0, 1))
        raise


def _save(models):
    run_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:4]
    path = os.path.join(RUNS, run_id)
    os.makedirs(path, exist_ok=True)
    with open(os.path.join(path, "results.json"), "w", encoding="utf-8") as f:
        json.dump({"models": models}, f)
    for model in models:
        for r in model["results"]:
            if r.get("mesh"):
                _write_obj(os.path.join(path, r["id"].replace(":", "_") + ".obj"), r["mesh"])


def _write_obj(path, mesh):
    with open(path, "w") as fh:
        fh.write(f"# vertices: {len(mesh['v'])}, faces: {len(mesh['f'])}\n")
        for p in mesh["v"]:
            fh.write(f"v {p[0]:.6f} {p[1]:.6f} {p[2]:.6f}\n")
        for face in mesh["f"]:
            fh.write("f " + " ".join(str(int(i) + 1) for i in face) + "\n")


def _live_variant(source, params):
    t0 = time.time()
    n_angles = int(params.get("angles", 720))
    n_layers = int(params.get("layers", 60))
    mode = params.get("mode", "envelope")
    method = params.get("method", "fft")
    noise = max(0.0, min(0.2, float(params.get("noise", 0.008))))
    pct = max(5.0, min(100.0, float(params.get("pct", 100))))
    harmonics = int(params.get("harmonics", 32))
    window = int(params.get("window", 5))
    angle = float(params.get("angle", 1.0))
    loss = float(params.get("loss", 0.001))
    key = json.dumps({
        "source": source, "angles": n_angles, "layers": n_layers, "mode": mode,
        "method": method, "harmonics": harmonics, "window": window, "angle": angle,
    }, sort_keys=True, ensure_ascii=False)

    with LIVE_LOCK:
        base = LIVE.get("base")
        if LIVE.get("key") != key:
            v, faces, title = _prepare(source)
            alphas, layers = pipeline.build_sections(
                v, pipeline.mesh_edges(faces), n_layers, n_angles)
            zs = np.array([z for z, _ in layers])
            r_true = np.vstack([r for _, r in layers])
            true_by_z = {round(z, 6): r for z, r in layers}
            unit = np.random.default_rng(12345).uniform(-1.0, 1.0, size=r_true.shape)
            base = {
                "title": title, "alphas": alphas, "zs": zs, "r_true": r_true,
                "true_by_z": true_by_z, "noise_unit": unit,
                "noise": None, "pts": None, "hull": None, "metrics": None,
            }
            LIVE["key"] = key
            LIVE["base"] = base

        if base["noise"] != noise:
            r = base["r_true"] + noise * base["noise_unit"] if noise > 0 else base["r_true"].copy()
            if method == "fft":
                a, pinv = pipeline.fourier_design(base["alphas"], harmonics)
                rs = pipeline.fourier_denoise_matrix(r, a, pinv)
            elif method == "uni":
                rows = []
                for i in range(len(base["zs"])):
                    rows.append(pipeline.uniform_denoise_adaptive(
                        r[i], base["r_true"][i], window, 30))
                rs = np.vstack(rows)
            else:
                rs = r
            pts = []
            for li, z in enumerate(base["zs"]):
                if mode == "maxima":
                    pts += pipeline.maxima_points(base["alphas"], rs[li], float(z))
                else:
                    pts += pipeline.envelope_points(base["alphas"], rs[li], float(z))
            pts = np.asarray(pts)
            if len(pts) < 4:
                raise ValueError("слишком мало точек")
            hv, hf = pipeline.hull_compact(pts)
            base["pts"] = pts
            base["hull"] = (hv, hf)
            base["metrics"] = pipeline.metrics(base["true_by_z"], base["alphas"], pts)
            base["noise"] = noise

        pts = base["pts"]
        hv, hf = base["hull"]
        mp = pipeline.minimal_polyhedron(
            pts, angle_tol_deg=angle, loss_target=loss,
            hull=(hv, hf), pct=pct, snap=False)
        mv, mf = pipeline.polygons_to_mesh(mp["polygons"])
        metrics = base["metrics"]
        label = f"живой · шум {noise:g} · упрощение {round(100 - pct):g}%"
        return {
            "id": "live", "label": label, "kind": "live",
            "mesh": {"v": mv.tolist(), "f": [list(f) for f in mf]},
            "metrics": metrics, "quality": quality(metrics),
            "vertices": int(mp["vertices"]), "faces": int(mp["faces"]),
            "points": int(len(pts)), "time": round(time.time() - t0, 2),
            "noise": noise, "pct": pct, "method": method,
        }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=STATIC, **kw)

    def log_message(self, fmt, *args):
        pass

    def _json(self, obj, code=200):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/api/status":
            with LOCK:
                return self._json(STATE["job"] or {"state": "idle"})
        if u.path == "/api/results":
            with LOCK:
                return self._json({"models": STATE["models"] or []})
        if u.path == "/api/mesh":
            rid = parse_qs(u.query).get("id", [""])[0]
            with LOCK:
                for model in STATE["models"] or []:
                    for r in model["results"]:
                        if r["id"] == rid:
                            return self._json(r)
            return self._json({"error": "нет результата"}, 404)
        if u.path == "/api/export.csv":
            return self._csv()
        if u.path == "/api/demo":
            return self._json(["octa", "icosa", "dodeca", "diamond", "cube", "prism"])
        return super().do_GET()

    def do_POST(self):
        u = urlparse(self.path)
        if u.path == "/api/clear-cache":
            with LOCK:
                STATE["models"] = None
                STATE["job"] = {"state": "idle"}
            for d in (UPLOADS, RUNS):
                shutil.rmtree(d, ignore_errors=True)
                os.makedirs(d, exist_ok=True)
            return self._json({"ok": True})
        if u.path == "/api/upload":
            n = int(self.headers.get("Content-Length", 0))
            if n > 120 * 1024 * 1024:
                return self._json({"error": "файл больше 120 МБ"}, 413)
            name = os.path.basename(self.headers.get("X-Filename", "upload.obj"))
            uid = uuid.uuid4().hex[:10]
            path = os.path.join(UPLOADS, uid + "_" + name)
            with open(path, "wb") as f:
                f.write(self.rfile.read(n))
            return self._json({"path": path, "name": name})
        if u.path == "/api/levels":
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n) or b"{}")
            source = body.get("source")
            if not source:
                return self._json({"error": "не выбрана модель"}, 400)
            with LOCK:
                if STATE["job"] and STATE["job"].get("state") == "running":
                    return self._json({"error": "уже выполняется"}, 409)
            try:
                v, faces, title = _prepare(source)
                results = []
                prev = None
                for i, pct in enumerate(pipeline.SIMPLIFY_LEVELS):
                    t0 = time.time()
                    try:
                        mp = pipeline.minimal_polyhedron(v, pct=pct, snap=False)
                    except Exception:
                        mp = None
                    if (mp is not None and mp["vertices"] >= 4 and mp["faces"] >= 4
                            and (prev is None or mp["faces"] <= prev["faces"])):
                        mv, mf = pipeline.polygons_to_mesh(mp["polygons"])
                        prev = {"mesh": {"v": mv.tolist(), "f": [list(f) for f in mf]},
                                "vertices": int(mp["vertices"]), "faces": int(mp["faces"])}
                        sec = time.time() - t0
                    elif prev is not None:
                        mp = prev
                        sec = 0.0
                    else:
                        raise ValueError("не удалось построить уровень упрощения")
                    results.append({
                        "id": f"lv{i}", "label": f"{pct:g}% · {prev['vertices']}/{prev['faces']}",
                        "kind": "level", "mesh": prev["mesh"],
                        "metrics": {}, "quality": None,
                        "vertices": prev["vertices"], "faces": prev["faces"],
                        "pct": pct, "time": round(sec, 2),
                    })
                model = {"id": "levels", "name": f"{title} · 6 уровней",
                         "levels": True, "results": results}
                with LOCK:
                    models = [m for m in (STATE["models"] or []) if m.get("id") != "levels"]
                    models.append(model)
                    STATE["models"] = models
                return self._json({"ok": True, "name": model["name"]})
            except Exception as exc:
                return self._json({"error": str(exc)}, 500)
        if u.path == "/api/live":
            n = int(self.headers.get("Content-Length", 0))
            if n > 1024 * 1024:
                return self._json({"error": "слишком большой запрос"}, 413)
            body = json.loads(self.rfile.read(n) or b"{}")
            source = body.get("source")
            if not source:
                return self._json({"error": "не выбрана модель"}, 400)
            with LOCK:
                if STATE["job"] and STATE["job"].get("state") == "running":
                    return self._json({"error": "конвейер уже выполняется"}, 409)
            try:
                return self._json({"result": _live_variant(source, body.get("params", {}))})
            except Exception as exc:
                return self._json({"error": str(exc)}, 500)
        if u.path == "/api/run":
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n) or b"{}")
            with LOCK:
                if STATE["job"] and STATE["job"].get("state") == "running":
                    return self._json({"error": "уже выполняется"}, 409)
                STATE["job"] = {"state": "running", "stage": "Запуск", "detail": "",
                                "progress": 0.0, "eta": None, "started": time.time(),
                                "elapsed": 0, "model": 1, "models": max(1, len(body.get("sources") or [body.get("source")])),
                                "done": 0, "total": 0}
                STATE["models"] = None
            sources = body.get("sources") or [body.get("source")]
            threading.Thread(target=_run, args=(sources, body.get("params", {})), daemon=True).start()
            return self._json({"ok": True})
        return self._json({"error": "неизвестный запрос"}, 404)

    def _csv(self):
        data = _csv_text().encode("utf-8-sig")
        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", "attachment; filename=metrics.csv")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def _csv_text():
    with LOCK:
        models = STATE["models"] or []
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["модель", "вариант", "качество", "MSE", "RMSE", "d_max", "вершин", "граней", "точек", "время, с"])
    for model in models:
        for r in model["results"]:
            m = r.get("metrics") or {}
            w.writerow([model["name"], r["label"], r.get("quality"), m.get("mse"),
                        m.get("rmse"), m.get("dmax"), r.get("vertices"), r.get("faces"),
                        r.get("points"), r.get("time")])
    return buf.getvalue()


def _browser_executable():
    if platform.system() != "Windows":
        return None
    roots = [
        os.environ.get("ProgramFiles(x86)"),
        os.environ.get("ProgramFiles"),
        os.environ.get("LOCALAPPDATA"),
    ]
    relative = (
        ("Microsoft", "Edge", "Application", "msedge.exe"),
        ("Google", "Chrome", "Application", "chrome.exe"),
    )
    seen = set()
    for root in roots:
        if not root:
            continue
        for rel in relative:
            path = os.path.join(root, *rel)
            if path in seen:
                continue
            seen.add(path)
            if os.path.isfile(path):
                return path
    return None


def _open_windows_window(url):
    exe = _browser_executable()
    if not exe:
        return None
    profile = os.path.join(DATA, "browser-profile")
    try:
        os.makedirs(profile, exist_ok=True)
        return subprocess.Popen([
            exe,
            f"--app={url}",
            "--window-size=1440,940",
            f"--user-data-dir={profile}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-features=Translate",
        ])
    except Exception as exc:
        _console_print("Не удалось открыть окно:", exc)
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true", help="не открывать браузер")
    ap.add_argument("--no-window", action="store_true", help="без отдельного окна")
    args = ap.parse_args()
    with LOCK:
        STATE["models"] = load_latest()
        if STATE["models"]:
            _console_print("загружены сохранённые результаты:", len(STATE["models"]), "модел(ей)")
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{args.port}/"
    _console_print("Огранка запущена:", url)
    _console_print("Данные:", DATA)
    if args.no_window:
        if not args.no_browser:
            threading.Timer(0.7, lambda: webbrowser.open(url)).start()
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            _console_print("\nОстановлено")
        return
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    if platform.system() == "Windows":
        proc = _open_windows_window(url)
        if proc is not None:
            try:
                proc.wait()
            except KeyboardInterrupt:
                _console_print("\nОстановлено")
            finally:
                try:
                    proc.terminate()
                except Exception:
                    pass
                srv.shutdown()
            return
        if not args.no_browser:
            webbrowser.open(url)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            _console_print("\nОстановлено")
        return
    try:
        import webview
        webview.create_window(APP_TITLE, url, width=1440, height=940,
                              min_size=(880, 560), maximized=True, js_api=Api())
        webview.start()
    except Exception as exc:
        _console_print("Окно недоступно, открываю браузер:", exc)
        if not args.no_browser:
            webbrowser.open(url)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            _console_print("\nОстановлено")


if __name__ == "__main__":
    main()
