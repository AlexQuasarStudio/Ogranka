"""Задания конвейера: расчёт вариантов, прогресс, сохранение прогонов."""
from __future__ import annotations

import csv
import io
import json
import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import numpy as np

import paths
from core import pipeline
from core.variants import ModelSections
from platform_ui import console_print
from sources import prepare_source, quality

LOCK = threading.Lock()
STATE: dict = {"job": None, "models": None}

METHOD_NAMES = {"none": "без сглаживания", "fft": "Фурье+МНК", "uni": "соседи"}
MAX_WORKERS = 4
EMPTY_METRICS = {"mse": None, "rmse": None, "dmax": None}


# ---------------------------------------------------------------- параметры


def _num(params: dict, key: str, default, cast, low=None, high=None):
    try:
        value = cast(params.get(key, default))
    except (TypeError, ValueError):
        value = cast(default)
    if low is not None:
        value = max(low, value)
    if high is not None:
        value = min(high, value)
    return value


class RunParams:
    """Validated pipeline parameters (values are clamped to sane ranges)."""

    def __init__(self, params: dict | None):
        params = params or {}
        self.angles = _num(params, "angles", 720, int, 16, 4096)
        self.layers = _num(params, "layers", 60, int, 2, 400)
        self.mode = "maxima" if params.get("mode") == "maxima" else "envelope"
        methods = [m for m in (params.get("methods") or ["fft", "none"]) if m in METHOD_NAMES]
        self.methods = methods or ["fft"]
        levels = []
        for value in params.get("noise", [0.008, 0.08]) or []:
            try:
                level = float(value)
            except (TypeError, ValueError):
                continue
            if np.isfinite(level) and level >= 0:
                levels.append(level)
        self.levels = levels
        self.harmonics = _num(params, "harmonics", 32, int, 1, 200)
        self.window = _num(params, "window", 5, int, 1, 30)
        self.minimal = bool(params.get("minimal", True))
        self.loss = _num(params, "loss", 0.1, float, 0.0, 100.0) / 100.0
        self.angle = _num(params, "angle", 1.0, float, 0.0, 90.0)
        model = params.get("noise_model", "angles")
        self.noise_model = model if model in ("angles", "edges", "normal") else "angles"


def noise_label(rv: float) -> str:
    if rv == 0:
        return "точные"
    if abs(rv - 0.008) < 1e-9:
        return "r8"
    if abs(rv - 0.08) < 1e-9:
        return "r80"
    return f"шум {rv:g}"


def variant_label(rv: float, method: str, noise_model: str) -> str:
    label = f"{noise_label(rv)} · {METHOD_NAMES.get(method, method)}"
    if noise_model == "edges":
        label += " · рёбра"
    elif noise_model == "normal":
        label += " · экспериментальный"
    return label


def mesh_payload(verts, faces) -> dict:
    verts = np.asarray(verts, float)
    return {"v": verts.tolist(), "f": [list(map(int, f)) for f in faces]}


# ---------------------------------------------------------------- прогресс


def stage(text: str, progress: float, detail: str = "", eta=None, **extra) -> None:
    """Update the running job; ETA is extrapolated from the elapsed time."""
    with LOCK:
        job = STATE["job"]
        if not job:
            return
        started = job.get("started") or time.time()
        elapsed = time.time() - started
        p = max(0.0, min(1.0, float(progress)))
        if eta is None and p > 0.02:
            eta = max(1, int(elapsed / p * (1 - p)))
        job.update(
            stage=text,
            detail=detail,
            progress=round(p, 4),
            eta=eta,
            elapsed=round(elapsed, 1),
            updated=time.time(),
        )
        if extra:
            job.update(extra)


def is_running() -> bool:
    with LOCK:
        job = STATE["job"]
        return bool(job and job.get("state") == "running")


# ---------------------------------------------------------------- расчёт модели


def _reference_results(mi, v, faces, sections) -> list:
    results = [{
        "id": f"m{mi}:ref",
        "label": "Эталон",
        "kind": "ref",
        "mesh": mesh_payload(v, faces),
        "metrics": {"mse": 0.0, "rmse": 0.0, "dmax": 0.0},
        "quality": "ref",
        "vertices": int(len(v)),
        "faces": int(len(faces)),
        "points": int(len(v)),
    }]
    started = time.time()
    try:
        mp = pipeline.minimal_polyhedron(v)
        mv, mf = pipeline.polygons_to_mesh(mp["polygons"])
        results.append({
            "id": f"m{mi}:refmin",
            "label": "Эталон · мин. многогранник",
            "kind": "min",
            "mesh": mesh_payload(mv, mf),
            "metrics": pipeline.mesh_metrics(sections.true_by_z, sections.alphas, mv, mf),
            "quality": "ref",
            "vertices": int(mp["vertices"]),
            "faces": int(mp["faces"]),
            "points": int(len(v)),
            "time": round(time.time() - started, 2),
        })
    except Exception as exc:
        console_print("Эталонный многогранник не построен:", exc)
    return results


def _run_variant(mi, vi, rv, method, sections: ModelSections, p: RunParams, report) -> list:
    label = variant_label(rv, method, p.noise_model)
    report(vi, 0.03, "подготовка варианта", label)
    started = time.time()
    rows, contours = sections.noisy(rv)
    report(vi, 0.12, "шум по рёбрам" if p.noise_model == "edges" else "шум", label)
    if method == "fft":
        report(vi, 0.20, "ряд Фурье и МНК", label)
    elif method == "uni":
        report(vi, 0.20, "адаптивные соседи", label)
    smoothed = sections.smooth(rows, method, p.harmonics, p.window)
    report(vi, 0.45, "сглаживание готово", label)

    pts = sections.points(
        smoothed, p.mode,
        progress=lambda frac: report(vi, 0.45 + 0.13 * frac, "точки сечений", label),
    )
    report(vi, 0.58, "точки сечений", label)

    out = []
    if len(pts) < 4:
        out.append({
            "id": f"m{mi}:v{vi}",
            "label": label,
            "kind": "fail",
            "mesh": None,
            "metrics": dict(EMPTY_METRICS),
            "quality": None,
            "vertices": 0,
            "faces": 0,
            "points": int(len(pts)),
            "time": round(time.time() - started, 2),
        })
    else:
        report(vi, 0.68, "выпуклая оболочка", label)
        hv, hf = pipeline.hull_compact(pts)
        report(vi, 0.78, "метрики", label)
        m = pipeline.metrics(sections.true_by_z, sections.alphas, pts)
        out.append({
            "id": f"m{mi}:v{vi}",
            "label": label,
            "kind": "hull",
            "mesh": mesh_payload(hv, hf),
            "metrics": m,
            "quality": quality(m),
            "vertices": int(len(hv)),
            "faces": int(len(hf)),
            "points": int(len(pts)),
            "time": round(time.time() - started, 2),
        })
        if p.minimal:
            report(vi, 0.86, "минимальный многогранник", label)
            try:
                mp = pipeline.minimal_polyhedron(
                    pts, angle_tol_deg=p.angle, loss_target=p.loss, hull=(hv, hf)
                )
                mv, mf = pipeline.polygons_to_mesh(mp["polygons"])
                mm = pipeline.mesh_metrics(sections.true_by_z, sections.alphas, mv, mf)
                out.append({
                    "id": f"m{mi}:v{vi}m",
                    "label": label + " · мин. многогранник",
                    "kind": "min",
                    "mesh": mesh_payload(mv, mf),
                    "metrics": mm,
                    "quality": quality(mm),
                    "vertices": int(mp["vertices"]),
                    "faces": int(mp["faces"]),
                    "points": int(len(pts)),
                    "time": round(time.time() - started, 2),
                })
            except Exception as exc:
                console_print("Минимальный многогранник не построен:", exc)
    if p.noise_model == "normal" and method == "none" and rv > 0 and contours:
        report(vi, 0.90, "сглаживание колец", label)
        rings = pipeline.fourier_smooth_contours(contours, p.harmonics)
        loft = pipeline.loft_contours(rings)
        if loft is not None:
            lv, lf = loft
            lm = pipeline.contours_metrics(sections.true_by_z, sections.alphas, rings)
            out.append({
                "id": f"m{mi}:v{vi}c",
                "label": label + " · контуры (лофт, Фурье)",
                "kind": "loft",
                "mesh": mesh_payload(lv, lf),
                "metrics": lm,
                "quality": quality(lm),
                "vertices": int(len(lv)),
                "faces": int(len(lf)),
                "points": int(sum(len(r) for _, r in rings)),
                "time": round(time.time() - started, 2),
            })
    report(vi, 1.0, "готово", label)
    return out


def _run_model(mi, n_models, source, p: RunParams) -> tuple[str, list]:
    base = mi / n_models
    span = 1.0 / n_models
    hint = source.get("name") or "модель"

    def mreport(text, frac, detail=None):
        stage(
            f"Модель {mi + 1}/{n_models}: {text}",
            base + span * max(0.0, min(1.0, frac)),
            detail=detail or hint,
            model=mi + 1,
            models=n_models,
        )

    mreport("подготовка", 0.005)
    v, faces, title = prepare_source(source, lambda t, f: mreport(t, f))
    mreport("сечения", 0.08)

    def sec_progress(frac):
        q = (float(frac) - 0.05) / 0.40
        mreport("сечения", 0.08 + 0.12 * max(0.0, min(1.0, q)))

    sections = ModelSections(
        v, faces, p.layers, p.angles, p.noise_model,
        seeds={"angles": 1000 + mi, "edges": 2000 + mi, "normal": 3000 + mi},
        progress=sec_progress,
    )
    mreport("эталонный многогранник", 0.21)
    results = _reference_results(mi, v, faces, sections)

    variants = [(rv, method) for rv in p.levels for method in p.methods]
    total = max(1, len(variants))
    done_share = [0.0] * total

    def report(vi, frac, text, label):
        with LOCK:
            done_share[vi] = max(done_share[vi], float(frac))
            agg = sum(done_share) / total
            finished = sum(1 for x in done_share if x >= 1.0)
        stage(
            f"{title}: {label}",
            base + span * (0.30 + 0.65 * agg),
            detail=text,
            model=mi + 1,
            models=n_models,
            done=finished,
            total=total,
        )

    if p.methods and "fft" in p.methods:
        sections.design(p.harmonics)  # готовим псевдообратную матрицу до потоков
    workers = max(1, min(MAX_WORKERS, len(variants)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [
            pool.submit(_run_variant, mi, vi, rv, method, sections, p, report)
            for vi, (rv, method) in enumerate(variants)
        ]
        for future in futures:
            results.extend(future.result())
    mreport("модель готова", 0.96)
    return title, results


def new_run_token() -> str:
    return time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:4]


def run_label_for(token: str) -> str:
    return time.strftime("%H:%M:%S") + " · " + token[-4:]


def prefix_result_ids(results: list, run_token: str) -> list:
    for r in results:
        if not r["id"].startswith(run_token + ":"):
            r["id"] = f"{run_token}:{r['id']}"
    return results


def run_pipeline(sources: list, params: dict, run_token: str, run_label: str) -> None:
    """Process every source; finished models are saved immediately."""
    started = time.time()
    models: list = []
    n_models = max(1, len(sources))
    try:
        p = RunParams(params)
        for mi, source in enumerate(sources):
            title, results = _run_model(mi, n_models, source, p)
            models.append({
                "id": mi,
                "uid": f"{run_token}:m{mi}",
                "name": title,
                "source": source,
                "run": run_token,
                "run_label": run_label,
                "results": prefix_result_ids(results, run_token),
            })
            # Пишем после каждой модели: закрытие окна не должно терять готовое.
            save_run(models, run_token, only_new=models[-1:])
        stage("Сохранение результатов", 0.985, detail=f"моделей: {len(models)}")
        save_run(models, run_token, only_new=[])
        elapsed = round(time.time() - started, 1)
        with LOCK:
            STATE["models"] = list(STATE["models"] or []) + models
            if STATE["job"]:
                STATE["job"].update(
                    state="done", progress=1.0, stage="Готово", detail="", elapsed=elapsed, eta=0,
                )
        console_print(f"Готово: {len(models)} модел(ей) за {elapsed:.1f} с")
    except Exception as exc:
        elapsed = round(time.time() - started, 1)
        if models:
            try:
                save_run(models, run_token)
            except Exception:
                pass
        with LOCK:
            if STATE["job"]:
                STATE["job"].update(
                    state="error", error=str(exc), stage="Ошибка", detail=str(exc), elapsed=elapsed,
                )
        console_print(f"Ошибка через {elapsed:.1f} с: {exc}")
        raise


def start_run(sources: list, params: dict) -> bool:
    """Start the pipeline in a worker thread; ``False`` if a run is active."""
    token = new_run_token()
    label = run_label_for(token)
    with LOCK:
        if STATE["job"] and STATE["job"].get("state") == "running":
            return False
        STATE["job"] = {
            "state": "running",
            "stage": "Запуск",
            "detail": "",
            "progress": 0.0,
            "eta": None,
            "started": time.time(),
            "elapsed": 0,
            "model": 1,
            "models": max(1, len(sources)),
            "done": 0,
            "total": 0,
            "run": token,
        }

    def worker():
        try:
            run_pipeline(sources, params, token, label)
        except Exception:
            pass  # состояние ошибки уже записано в STATE

    threading.Thread(target=worker, name="ogranka-run", daemon=False).start()
    return True


# ---------------------------------------------------------------- уровни упрощения


def build_levels(source: dict) -> dict:
    """Six minimal polyhedra at fixed shares of kept triangles."""
    token = new_run_token()
    label = run_label_for(token)
    v, faces, title = prepare_source(source)
    sections = ModelSections(v, faces, 60, 720, "angles")
    results = []
    prev = None
    for i, pct in enumerate(pipeline.SIMPLIFY_LEVELS):
        started = time.time()
        try:
            mp = pipeline.minimal_polyhedron(v, pct=pct, snap=False)
        except Exception:
            mp = None
        if (
            mp is not None
            and mp["vertices"] >= 4
            and mp["faces"] >= 4
            and (prev is None or mp["faces"] <= prev["faces"])
        ):
            mv, mf = pipeline.polygons_to_mesh(mp["polygons"])
            prev = {
                "mesh": mesh_payload(mv, mf),
                "vertices": int(mp["vertices"]),
                "faces": int(mp["faces"]),
                "metrics": pipeline.mesh_metrics(sections.true_by_z, sections.alphas, mv, mf),
            }
            sec = time.time() - started
        elif prev is not None:
            sec = 0.0
        else:
            raise ValueError("не удалось построить уровень упрощения")
        results.append({
            "id": f"{token}:lv{i}",
            "label": f"оставлено {pct:g}% · {prev['vertices']}/{prev['faces']}",
            "kind": "level",
            "mesh": prev["mesh"],
            "metrics": prev["metrics"],
            "quality": quality(prev["metrics"]),
            "vertices": prev["vertices"],
            "faces": prev["faces"],
            "pct": pct,
            "time": round(sec, 2),
        })
    model = {
        "id": f"levels:{token}",
        "uid": f"{token}:levels",
        "run": token,
        "run_label": label,
        "name": f"{title} · 6 уровней",
        "levels": True,
        "source": source,
        "results": results,
    }
    with LOCK:
        models = [
            m for m in (STATE["models"] or [])
            if not (str(m.get("id", "")).startswith("levels") and m.get("source") == source)
        ]
        models.append(model)
        STATE["models"] = models
    return model


# ---------------------------------------------------------------- хранение


def write_obj(path: str, mesh: dict) -> None:
    lines = [f"# vertices: {len(mesh['v'])}, faces: {len(mesh['f'])}"]
    lines.extend(f"v {p[0]:.6f} {p[1]:.6f} {p[2]:.6f}" for p in mesh["v"])
    lines.extend("f " + " ".join(str(int(i) + 1) for i in face) for face in mesh["f"])
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


def save_run(models: list, run_id: str | None = None, only_new: list | None = None) -> str:
    """Write ``results.json`` atomically; OBJ files only for ``only_new`` models."""
    run_id = run_id or new_run_token()
    folder = os.path.join(paths.RUNS, run_id)
    os.makedirs(folder, exist_ok=True)
    target = os.path.join(folder, "results.json")
    temp = target + ".tmp"
    with open(temp, "w", encoding="utf-8") as fh:
        json.dump({"models": models}, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(temp, target)
    for model in models if only_new is None else only_new:
        for r in model["results"]:
            if r.get("mesh"):
                write_obj(os.path.join(folder, r["id"].replace(":", "_") + ".obj"), r["mesh"])
    return folder


def load_all_models(runs_dir: str | None = None):
    """Models of every saved run, oldest run first (``None`` when empty)."""
    runs_dir = runs_dir or paths.RUNS
    if not os.path.isdir(runs_dir):
        return None
    candidates = []
    for name in os.listdir(runs_dir):
        path = os.path.join(runs_dir, name, "results.json")
        if os.path.isfile(path):
            candidates.append((os.path.getmtime(path), path))
    models = []
    for _, path in sorted(candidates):
        try:
            with open(path, encoding="utf-8") as fh:
                batch = json.load(fh).get("models")
        except Exception:
            continue
        if isinstance(batch, list):
            models.extend(batch)
    return models or None


def public_models() -> list:
    """Models without meshes (meshes are fetched one by one)."""
    with LOCK:
        source = list(STATE["models"] or [])
    models = []
    for model in source:
        pub = {k: v for k, v in model.items() if k != "results"}
        pub["results"] = [
            {**{k: v for k, v in r.items() if k != "mesh"}, "has_mesh": bool(r.get("mesh"))}
            for r in model.get("results", [])
        ]
        models.append(pub)
    return models


def find_result(result_id: str):
    with LOCK:
        for model in STATE["models"] or []:
            for r in model["results"]:
                if r["id"] == result_id:
                    return r
    return None


def csv_text() -> str:
    with LOCK:
        models = list(STATE["models"] or [])
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["модель", "вариант", "качество", "MSE", "RMSE", "d_max", "вершин", "граней", "точек", "время, с"])
    for model in models:
        for r in model["results"]:
            m = r.get("metrics") or {}
            w.writerow([
                model["name"], r["label"], r.get("quality"),
                m.get("mse"), m.get("rmse"), m.get("dmax"),
                r.get("vertices"), r.get("faces"), r.get("points"), r.get("time"),
            ])
    return buf.getvalue()


def clear_all() -> bool:
    """Forget every run and upload; ``False`` while the pipeline is running."""
    import shutil

    with LOCK:
        if STATE.get("job") and STATE["job"].get("state") == "running":
            return False
        STATE["models"] = None
        STATE["job"] = {"state": "idle"}
    for folder in (paths.UPLOADS, paths.RUNS):
        shutil.rmtree(folder, ignore_errors=True)
        os.makedirs(folder, exist_ok=True)
    try:
        os.remove(paths.WELCOME_FILE)
    except FileNotFoundError:
        pass
    return True
