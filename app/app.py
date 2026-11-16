"""Локальное приложение-конвейер: сервер + веб-интерфейс.

Запуск:  python app.py [--port 8765] [--no-browser]
Зависимости: numpy, Qhull (встроенный _qhull).
"""
import argparse
import base64
import csv
import io
import json
import os
import platform
import re
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

import numpy as np

from core import pipeline
from config import APP_BUILD, APP_REPO, APP_TITLE, APP_VERSION
from live import clear_live, live_variant
from platform_ui import console_print as _console_print
from platform_ui import open_windows_window, setup_macos_about
from sources import prepare_source, quality, scan_folder
import updater

try:
    import certifi
except Exception:
    certifi = None

try:
    SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where() if certifi else None)
except Exception:
    SSL_CONTEXT = ssl.create_default_context()


class Api:
    def open_url(self, url):
        if not isinstance(url, str) or not url.startswith(("https://", "http://")):
            return False
        webbrowser.open(url)
        return True

    def window_rect(self):
        try:
            import webview

            win = webview.windows[0] if webview.windows else None
            if win is None:
                return {}
            return {
                "x": int(getattr(win, "x", 0) or 0),
                "y": int(getattr(win, "y", 0) or 0),
                "width": int(getattr(win, "width", 0) or 0),
                "height": int(getattr(win, "height", 0) or 0),
            }
        except Exception:
            return {}


    def capture_screen(self):
        temp = ""
        try:
            fd, temp = tempfile.mkstemp(prefix="ogranka-shot-", suffix=".png")
            os.close(fd)
            system = platform.system()
            if system == "Darwin":
                subprocess.run(
                    ["screencapture", "-x", "-t", "png", temp],
                    check=True,
                    timeout=30,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            elif system == "Windows":
                script = (
                    "Add-Type -AssemblyName System.Windows.Forms;"
                    "Add-Type -AssemblyName System.Drawing;"
                    "$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds;"
                    "$img=New-Object System.Drawing.Bitmap $b.Width,$b.Height;"
                    "$g=[System.Drawing.Graphics]::FromImage($img);"
                    "$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size);"
                    f"$img.Save('{temp}',[System.Drawing.Imaging.ImageFormat]::Png);"
                    "$g.Dispose();$img.Dispose()"
                )
                subprocess.run(
                    ["powershell.exe", "-NoProfile", "-Command", script],
                    check=True,
                    timeout=30,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            else:
                commands = (
                    ("gnome-screenshot", ["gnome-screenshot", "-f", temp]),
                    ("spectacle", ["spectacle", "-b", "-n", "-o", temp]),
                    ("grim", ["grim", temp]),
                    ("import", ["import", "-window", "root", temp]),
                )
                for command, args in commands:
                    if not shutil.which(command):
                        continue
                    subprocess.run(
                        args,
                        check=True,
                        timeout=30,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                    break
                else:
                    raise RuntimeError("Не найден инструмент для скриншота.")
            with open(temp, "rb") as fh:
                data = fh.read()
            if not data:
                raise RuntimeError("Скриншот получился пустым.")
            return {"data": "data:image/png;base64," + base64.b64encode(data).decode("ascii")}
        except Exception as exc:
            return {"error": str(exc)}
        finally:
            if temp:
                try:
                    os.remove(temp)
                except Exception:
                    pass

    def toggle_fullscreen(self):
        import webview

        win = webview.windows[0]
        win.toggle_fullscreen()
        return True

    def _save_dialog(self, filename, file_types):
        try:
            import webview

            win = webview.windows[0] if webview.windows else None
            if win is None:
                return None, {"error": "нет окна"}
            path = win.create_file_dialog(
                webview.SAVE_DIALOG, save_filename=filename, file_types=file_types
            )
        except Exception as exc:
            return None, {"error": str(exc)}
        if not path:
            return None, {"cancelled": True}
        if isinstance(path, (list, tuple)):
            path = path[0]
        return path, None

    def pick_folder(self):
        try:
            import webview

            win = webview.windows[0] if webview.windows else None
            if win is None:
                return {"error": "нет окна"}
            dialog = getattr(webview, "FileDialog", None)
            kind = getattr(dialog, "FOLDER", None) if dialog else None
            if kind is None:
                kind = webview.FOLDER_DIALOG
            result = win.create_file_dialog(kind)
        except Exception as exc:
            return {"error": str(exc)}
        if not result:
            return {"cancelled": True}
        if isinstance(result, (list, tuple)):
            result = result[0]
        return {"path": result}

    def save_csv(self):
        text = _csv_text()
        path, error = self._save_dialog("metrics.csv", ("CSV (*.csv)",))
        if error:
            return error
        try:
            with open(path, "w", encoding="utf-8-sig", newline="") as f:
                f.write(text)
            return {"path": path}
        except Exception as exc:
            return {"error": str(exc)}

    def save_png(self, data_url, filename="ogranka-view.png"):
        try:
            encoded = data_url.split(",", 1)[-1]
            data = base64.b64decode(encoded)
        except Exception as exc:
            return {"error": "не удалось прочитать PNG: " + str(exc)}
        path, error = self._save_dialog(filename or "ogranka-view.png", ("PNG (*.png)",))
        if error:
            return error
        try:
            with open(path, "wb") as f:
                f.write(data)
            return {"path": path}
        except Exception as exc:
            return {"error": str(exc)}

    def save_obj(self, text, filename="ogranka-model.obj"):
        path, error = self._save_dialog(filename or "ogranka-model.obj", ("OBJ (*.obj)",))
        if error:
            return error
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
            return {"path": path}
        except Exception as exc:
            return {"error": str(exc)}


FROZEN = getattr(sys, "_MEIPASS", None)
BASE = FROZEN or os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(BASE, "static")


def _data_dir():
    override = os.environ.get("OGRANKA_DATA")
    if override:
        return override
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
WELCOME_FILE = os.path.join(DATA, "welcome_seen")
os.makedirs(UPLOADS, exist_ok=True)
os.makedirs(RUNS, exist_ok=True)

LOCK = threading.Lock()
STATE = {"job": None, "models": None}
UPDATE_LOCK = threading.Lock()
UPDATE_CACHE = {"at": 0.0, "data": None}
UPDATE_TTL = 900
UPDATE_NOTES_LIMIT = 12000
CHANGELOG_LOCK = threading.Lock()
CHANGELOG_CACHE = {"at": 0.0, "data": None}
CHANGELOG_TTL = 900
CHANGELOG_LIMIT = 20
ISSUES_LOCK = threading.Lock()
ISSUES_CACHE = {"at": 0.0, "data": None}
ISSUES_TTL = 300
ISSUES_LIMIT = 50


def load_all_models():
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
    models = []
    for _, path in cands:
        try:
            with open(path, encoding="utf-8") as f:
                batch = json.load(f).get("models")
        except Exception:
            continue
        if isinstance(batch, list):
            models.extend(batch)
    return models or None


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


def _run(sources, params, run_token, run_label):
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
        noise_model = params.get("noise_model", "angles")

        for mi, source in enumerate(sources):
            base = mi / n_models
            span = 1.0 / n_models
            name_hint = source.get("name") or "модель"

            def mreport(text, frac, detail=None):
                _stage(
                    f"Модель {mi + 1}/{n_models}: {text}",
                    base + span * max(0.0, min(1.0, frac)),
                    detail=detail or name_hint,
                    model=mi + 1,
                    models=n_models,
                )

            mreport("подготовка", 0.005)
            v, faces, title = prepare_source(source, lambda t, f: mreport(t, f))
            mreport("сечения", 0.08)

            def sec_progress(p, _report=mreport):
                q = (float(p) - 0.05) / 0.40
                _report("сечения", 0.08 + 0.12 * max(0.0, min(1.0, q)))

            if noise_model in ("edges", "normal"):
                alphas, layers, section_polys = pipeline.build_sections_ex(
                    v, pipeline.mesh_edges(faces), n_layers, n_angles, progress=sec_progress
                )
            else:
                alphas, layers = pipeline.build_sections(
                    v, pipeline.mesh_edges(faces), n_layers, n_angles, progress=sec_progress
                )
                section_polys = None
            true_by_z = {round(z, 6): r for z, r in layers}
            ref_metrics = {"mse": 0.0, "rmse": 0.0, "dmax": 0.0}
            results = [
                {
                    "id": f"m{mi}:ref",
                    "label": "Эталон",
                    "kind": "ref",
                    "mesh": {"v": v.tolist(), "f": [list(f) for f in faces]},
                    "metrics": ref_metrics,
                    "quality": "ref",
                    "vertices": int(len(v)),
                    "faces": int(len(faces)),
                    "points": int(len(v)),
                }
            ]

            mreport("эталонный многогранник", 0.21)
            t_ref = time.time()
            try:
                mpref = pipeline.minimal_polyhedron(v)
                pr_v, pr_f = pipeline.polygons_to_mesh(mpref["polygons"])
                mpref_metrics = pipeline.mesh_metrics(true_by_z, alphas, pr_v, pr_f)
                results.append(
                    {
                        "id": f"m{mi}:refmin",
                        "label": "Эталон · мин. многогранник",
                        "kind": "min",
                        "mesh": {"v": pr_v.tolist(), "f": [list(f) for f in pr_f]},
                        "metrics": mpref_metrics,
                        "quality": "ref",
                        "vertices": int(mpref["vertices"]),
                        "faces": int(mpref["faces"]),
                        "points": int(len(v)),
                        "time": round(time.time() - t_ref, 2),
                    }
                )
            except Exception:
                pass

            zs = np.array([z for z, _ in layers])
            R_true = np.vstack([r for _, r in layers])
            noise_unit = np.random.default_rng(1000 + mi).uniform(-1.0, 1.0, size=R_true.shape)
            edge_units = []
            if noise_model == "edges":
                edge_rng = np.random.default_rng(2000 + mi)
                edge_units = [edge_rng.uniform(-1.0, 1.0, size=len(poly)) for _, poly in section_polys]
            normal_units = []
            contour_step = 3.0 / max(1, n_layers)
            if noise_model == "normal":
                normal_rng = np.random.default_rng(3000 + mi)
                for _, poly in section_polys:
                    cnt = len(pipeline.resample_contour(poly, contour_step)[0])
                    normal_units.append(normal_rng.uniform(-1.0, 1.0, size=cnt))
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
                _stage(
                    f"{title}: {label}",
                    base + span * (0.30 + 0.65 * agg),
                    detail=text,
                    model=mi + 1,
                    models=n_models,
                    done=done,
                    total=total_variants,
                )

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
                if noise_model == "edges":
                    label += " · рёбра"
                elif noise_model == "normal":
                    label += " · экспериментальный"

                vstage(vi, 0.03, "подготовка варианта", label)
                t_var = time.time()
                contours = None
                if noise_model == "normal":
                    contours = pipeline.normal_noise_layers(
                        section_polys, contour_step, rv, normal_units
                    )
                    support_rows = pipeline.contours_support_layers(contours, alphas)
                    R = np.vstack([row for _, row in support_rows])
                elif noise_model == "edges":
                    if rv > 0:
                        noisy_layers = pipeline.edge_noise_layers(section_polys, alphas, rv, edge_units)
                        R = np.vstack([r for _, r in noisy_layers])
                    else:
                        R = R_true.copy()
                else:
                    R = R_true + rv * noise_unit if rv > 0 else R_true.copy()
                vstage(vi, 0.12, "шум по рёбрам" if noise_model == "edges" else "шум", label)
                if method == "fft":
                    vstage(vi, 0.20, "ряд Фурье и МНК", label)
                    Rs = pipeline.fourier_denoise_matrix(R, A, pinv)
                elif method == "uni":
                    vstage(vi, 0.20, "адаптивные соседи", label)
                    rows = []
                    for ii in range(len(zs)):
                        rows.append(pipeline.uniform_denoise_adaptive(R[ii], R_true[ii], window, 30))
                        if ii % 2 == 0:
                            vstage(
                                vi,
                                0.20 + 0.24 * (ii + 1) / len(zs),
                                f"соседи: слой {ii + 1}/{len(zs)}",
                                label,
                            )
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
                        vstage(
                            vi,
                            0.45 + 0.13 * (li + 1) / len(zs),
                            f"точки сечений: слой {li + 1}/{len(zs)}",
                            label,
                        )
                vstage(vi, 0.58, "точки сечений", label)

                if len(pts) < 4:
                    out = [
                        {
                            "id": f"m{mi}:v{vi}",
                            "label": label,
                            "kind": "fail",
                            "mesh": None,
                            "metrics": {"mse": None, "rmse": None, "dmax": None},
                            "quality": None,
                            "vertices": 0,
                            "faces": 0,
                            "points": len(pts),
                            "time": round(time.time() - t_var, 2),
                        }
                    ]
                else:
                    pts = np.asarray(pts)
                    vstage(vi, 0.68, "выпуклая оболочка", label)
                    hv, hf = pipeline.hull_compact(pts)
                    vstage(vi, 0.78, "метрики", label)
                    m = pipeline.metrics(true_by_z, alphas, pts)
                    out = [
                        {
                            "id": f"m{mi}:v{vi}",
                            "label": label,
                            "kind": "hull",
                            "mesh": {"v": hv.tolist(), "f": [list(f) for f in hf]},
                            "metrics": m,
                            "quality": quality(m),
                            "vertices": int(len(hv)),
                            "faces": int(len(hf)),
                            "points": int(len(pts)),
                            "time": round(time.time() - t_var, 2),
                        }
                    ]
                    if do_min:
                        vstage(vi, 0.86, "минимальный многогранник", label)
                        try:
                            mp = pipeline.minimal_polyhedron(
                                pts, angle_tol_deg=angle, loss_target=loss, hull=(hv, hf)
                            )
                            mv, mf = pipeline.polygons_to_mesh(mp["polygons"])
                            mm = pipeline.mesh_metrics(true_by_z, alphas, mv, mf)
                            out.append(
                                {
                                    "id": f"m{mi}:v{vi}m",
                                    "label": label + " · мин. многогранник",
                                    "kind": "min",
                                    "mesh": {"v": mv.tolist(), "f": [list(f) for f in mf]},
                                    "metrics": mm,
                                    "quality": quality(mm),
                                    "vertices": int(mp["vertices"]),
                                    "faces": int(mp["faces"]),
                                    "points": int(len(pts)),
                                    "time": round(time.time() - t_var, 2),
                                }
                            )
                        except Exception:
                            pass
                if noise_model == "normal" and method == "none" and rv > 0 and contours:
                    vstage(vi, 0.90, "сглаживание колец", label)
                    smoothed = pipeline.fourier_smooth_contours(contours, harmonics)
                    loft = pipeline.loft_contours(smoothed)
                    if loft is not None:
                        lv, lf = loft
                        lm = pipeline.contours_metrics(true_by_z, alphas, smoothed)
                        out.append(
                            {
                                "id": f"m{mi}:v{vi}c",
                                "label": label + " · контуры (лофт, Фурье)",
                                "kind": "loft",
                                "mesh": {"v": lv.tolist(), "f": [list(f) for f in lf]},
                                "metrics": lm,
                                "quality": quality(lm),
                                "vertices": int(len(lv)),
                                "faces": int(len(lf)),
                                "points": int(sum(len(p) for _, p in smoothed)),
                                "time": round(time.time() - t_var, 2),
                            }
                        )
                vstage(vi, 1.0, "готово", label)
                return out

            with ThreadPoolExecutor(max_workers=min(4, len(variants)) or 1) as pool:
                for out in pool.map(
                    run_variant, [(vi, rv, me) for vi, (rv, me) in enumerate(variants)]
                ):
                    results.extend(out)

            mreport("модель готова", 0.96)
            models.append({
                "id": mi,
                "uid": f"{run_token}:m{mi}",
                "name": title,
                "source": source,
                "run": run_token,
                "run_label": run_label,
                "results": _prefix_result_ids(results, run_token),
            })

        _stage("Сохранение результатов", 0.985, detail=f"моделей: {len(models)}")
        _save(models, run_token)
        elapsed = round(time.time() - t0, 1)
        with LOCK:
            STATE["models"] = list(STATE["models"] or []) + models
            if STATE["job"]:
                STATE["job"].update(
                    state="done",
                    progress=1.0,
                    stage="Готово",
                    detail="",
                    elapsed=elapsed,
                    eta=0,
                )
        _console_print(f"Готово: {len(models)} модел(ей) за {elapsed:.1f} с")
    except Exception as exc:
        elapsed = round(time.time() - t0, 1)
        with LOCK:
            if STATE["job"]:
                STATE["job"].update(
                    state="error",
                    error=str(exc),
                    stage="Ошибка",
                    detail=str(exc),
                    elapsed=elapsed,
                )
        _console_print(f"Ошибка через {elapsed:.1f} с: {exc}")
        raise


def _new_run_token():
    return time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:4]


def _prefix_result_ids(results, run_token):
    for r in results:
        if not r["id"].startswith(run_token + ":"):
            r["id"] = f"{run_token}:{r['id']}"
    return results


def _public_models():
    models = []
    for model in STATE["models"] or []:
        pub = {k: v for k, v in model.items() if k != "results"}
        pub["results"] = []
        for r in model.get("results", []):
            item = {k: v for k, v in r.items() if k != "mesh"}
            item["has_mesh"] = bool(r.get("mesh"))
            pub["results"].append(item)
        models.append(pub)
    return models


def _version_key(value):
    text = str(value or "").strip().lstrip("vV")
    match = re.match(r"(\d+(?:\.\d+)*)", text)
    if not match:
        return ()
    return tuple(int(part) for part in match.group(1).split("."))


def _is_newer_version(latest, current):
    latest_key = _version_key(latest)
    current_key = _version_key(current)
    return bool(latest_key) and latest_key > current_key


def _build_number(value):
    match = re.search(r"(\d+)", str(value or ""))
    return int(match.group(1)) if match else 0


def _release_build(release):
    text = "\n".join(
        str(release.get(key) or "") for key in ("name", "body")
    )
    match = re.search(r"\b(?:build|сборка)\s*[:#]?\s*(\d+)\b", text, re.IGNORECASE)
    return match.group(1) if match else ""


def _is_newer_release(version, build, current_version, current_build):
    if _is_newer_version(version, current_version):
        return True
    if _version_key(version) == _version_key(current_version):
        return _build_number(build) > _build_number(current_build)
    return False


def _release_asset(release):
    assets = release.get("assets") or []
    system = platform.system().lower()
    if system == "darwin":
        extensions = (".zip", ".dmg", ".pkg")
    elif system == "windows":
        extensions = (".exe", ".msi", ".zip")
    elif updater.is_appimage():
        extensions = (".appimage",)
    else:
        extensions = (".appimage",)
    for extension in extensions:
        for asset in assets:
            name = str(asset.get("name") or "")
            if name.lower().endswith(extension):
                return asset
    return None


def _asset_sha256(asset):
    digest = str((asset or {}).get("digest") or "").strip().lower()
    if digest.startswith("sha256:"):
        digest = digest[7:]
    return digest if re.fullmatch(r"[0-9a-f]{64}", digest) else ""


def _checksums_url(release):
    for asset in release.get("assets") or []:
        if str(asset.get("name") or "").lower() == "sha256sums.txt":
            return asset.get("browser_download_url")
    return ""


def _release_download(release):
    asset = _release_asset(release)
    if asset:
        return asset.get("browser_download_url"), asset.get("name")
    return release.get("html_url"), None


def _delta_asset(release, asset_name):
    if not asset_name:
        return None
    target = asset_name + ".delta.json"
    for asset in release.get("assets") or []:
        if str(asset.get("name") or "") == target:
            return asset
    return None


def _update_info(force=False):
    now = time.time()
    if not force:
        with UPDATE_LOCK:
            cached = UPDATE_CACHE["data"]
            if cached is not None and now - UPDATE_CACHE["at"] < UPDATE_TTL:
                return cached

    url = f"https://api.github.com/repos/{APP_REPO}/releases/latest"
    request = Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": f"Ogranka/{APP_VERSION}",
        },
    )
    try:
        with urlopen(request, timeout=6, context=SSL_CONTEXT) as response:
            release = json.load(response)
    except HTTPError as exc:
        if exc.code == 404:
            result = {"available": False, "current": APP_VERSION, "checked": True}
        else:
            result = {
                "available": False,
                "current": APP_VERSION,
                "checked": False,
                "error": f"github_http_{exc.code}",
            }
    except Exception:
        result = {
            "available": False,
            "current": APP_VERSION,
            "checked": False,
            "error": "network",
        }
    else:
        tag = str(release.get("tag_name") or release.get("name") or "").strip()
        version = tag.lstrip("vV")
        build = _release_build(release)
        asset_info = _release_asset(release)
        asset_url = str((asset_info or {}).get("browser_download_url") or "")
        asset_name = str((asset_info or {}).get("name") or "")
        asset_sha256 = _asset_sha256(asset_info)
        checksums_url = _checksums_url(release)
        delta_info = _delta_asset(release, asset_name)
        delta_url = str((delta_info or {}).get("browser_download_url") or "")
        delta_name = str((delta_info or {}).get("name") or "")
        installable, install_reason = updater.can_install(
            asset_name, bool(asset_sha256 or checksums_url)
        )
        download = asset_url or release.get("html_url")
        notes = str(release.get("body") or "").strip()
        notes_truncated = len(notes) > UPDATE_NOTES_LIMIT
        available = _is_newer_release(version, build, APP_VERSION, APP_BUILD)
        if available and _is_newer_version(version, APP_VERSION):
            update_kind = "version"
        elif available:
            update_kind = "build"
        else:
            update_kind = "none"
        result = {
            "available": available,
            "update_kind": update_kind,
            "current": APP_VERSION,
            "current_build": APP_BUILD,
            "version": version,
            "build": build,
            "tag": tag,
            "title": release.get("name") or tag,
            "url": download,
            "release_url": release.get("html_url"),
            "asset": asset_name or None,
            "asset_url": asset_url,
            "asset_name": asset_name,
            "asset_size": int((asset_info or {}).get("size") or 0),
            "asset_sha256": asset_sha256,
            "delta_url": delta_url,
            "delta_name": delta_name,
            "checksums_url": checksums_url,
            "installable": installable,
            "install_reason": install_reason,
            "install_hint": updater.reason_text(install_reason) if install_reason else "",
            "published_at": release.get("published_at"),
            "notes": notes[:UPDATE_NOTES_LIMIT],
            "notes_truncated": notes_truncated,
            "checked": True,
        }

    with UPDATE_LOCK:
        UPDATE_CACHE["at"] = now
        UPDATE_CACHE["data"] = result
    return result


def _changelog_info(force=False):
    now = time.time()
    if not force:
        with CHANGELOG_LOCK:
            cached = CHANGELOG_CACHE["data"]
            if cached is not None and now - CHANGELOG_CACHE["at"] < CHANGELOG_TTL:
                return cached

    url = f"https://api.github.com/repos/{APP_REPO}/releases?per_page={CHANGELOG_LIMIT}"
    request = Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": f"Ogranka/{APP_VERSION}",
        },
    )
    try:
        with urlopen(request, timeout=6, context=SSL_CONTEXT) as response:
            releases = json.load(response)
    except HTTPError as exc:
        result = {
            "current": APP_VERSION,
            "releases": [],
            "checked": False,
            "error": f"github_http_{exc.code}",
        }
    except Exception:
        result = {
            "current": APP_VERSION,
            "releases": [],
            "checked": False,
            "error": "network",
        }
    else:
        if not isinstance(releases, list):
            result = {
                "current": APP_VERSION,
                "releases": [],
                "checked": False,
                "error": "invalid_response",
            }
        else:
            items = []
            for release in releases:
                if not isinstance(release, dict) or release.get("draft"):
                    continue
                tag = str(release.get("tag_name") or release.get("name") or "").strip()
                notes = str(release.get("body") or "").strip()
                items.append(
                    {
                        "version": tag.lstrip("vV"),
                        "tag": tag,
                        "build": _release_build(release),
                        "title": release.get("name") or tag,
                        "url": release.get("html_url"),
                        "published_at": release.get("published_at"),
                        "prerelease": bool(release.get("prerelease")),
                        "notes": notes[:UPDATE_NOTES_LIMIT],
                        "notes_truncated": len(notes) > UPDATE_NOTES_LIMIT,
                    }
                )
            result = {
                "current": APP_VERSION,
                "releases": items,
                "checked": True,
            }

    with CHANGELOG_LOCK:
        CHANGELOG_CACHE["at"] = now
        CHANGELOG_CACHE["data"] = result
    return result


def _github_issues(force=False):
    now = time.time()
    if not force:
        with ISSUES_LOCK:
            cached = ISSUES_CACHE["data"]
            if cached is not None and now - ISSUES_CACHE["at"] < ISSUES_TTL:
                return cached

    url = f"https://api.github.com/repos/{APP_REPO}/issues?state=all&per_page={ISSUES_LIMIT}&sort=updated&direction=desc"
    request = Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": f"Ogranka/{APP_VERSION}",
        },
    )
    try:
        with urlopen(request, timeout=8, context=SSL_CONTEXT) as response:
            issues = json.load(response)
    except HTTPError as exc:
        result = {"checked": False, "issues": [], "error": f"github_http_{exc.code}"}
    except Exception:
        result = {"checked": False, "issues": [], "error": "network"}
    else:
        if not isinstance(issues, list):
            result = {"checked": False, "issues": [], "error": "invalid_response"}
        else:
            items = []
            for issue in issues:
                if not isinstance(issue, dict) or issue.get("pull_request"):
                    continue
                labels = []
                for label in issue.get("labels") or []:
                    if not isinstance(label, dict):
                        continue
                    labels.append(
                        {
                            "name": str(label.get("name") or ""),
                            "color": str(label.get("color") or "586069"),
                        }
                    )
                items.append(
                    {
                        "number": issue.get("number"),
                        "title": str(issue.get("title") or ""),
                        "state": str(issue.get("state") or ""),
                        "url": str(issue.get("html_url") or ""),
                        "comments": int(issue.get("comments") or 0),
                        "created_at": issue.get("created_at"),
                        "updated_at": issue.get("updated_at"),
                        "user": str((issue.get("user") or {}).get("login") or ""),
                        "labels": labels,
                    }
                )
            result = {"checked": True, "issues": items}

    with ISSUES_LOCK:
        ISSUES_CACHE["at"] = now
        ISSUES_CACHE["data"] = result
    return result


def _save(models, run_id=None):
    run_id = run_id or _new_run_token()
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


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=STATIC, **kw)

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def _json(self, obj, code=200):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _serve_index(self):
        try:
            with open(os.path.join(STATIC, "index.html"), encoding="utf-8") as f:
                html = f.read()
        except OSError:
            return super().do_GET()
        html = html.replace("{{APP_VERSION}}", APP_VERSION)
        html = html.replace("{{APP_BUILD}}", APP_BUILD)
        data = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path in ("/", "/index.html"):
            return self._serve_index()
        if u.path == "/api/version":
            return self._json({"version": APP_VERSION, "build": APP_BUILD})
        if u.path == "/api/welcome":
            return self._json({"seen": os.path.exists(WELCOME_FILE)})
        if u.path == "/api/status":
            with LOCK:
                return self._json(STATE["job"] or {"state": "idle"})
        if u.path == "/api/results":
            with LOCK:
                return self._json({"models": _public_models()})
        if u.path == "/api/changelog":
            force = parse_qs(u.query).get("force", ["0"])[0].lower() in ("1", "true", "yes")
            return self._json(_changelog_info(force))
        if u.path == "/api/update":
            force = parse_qs(u.query).get("force", ["0"])[0].lower() in ("1", "true", "yes")
            return self._json(_update_info(force))
        if u.path == "/api/update/status":
            return self._json(updater.status())
        if u.path == "/api/github/issues":
            force = parse_qs(u.query).get("force", ["0"])[0].lower() in ("1", "true", "yes")
            return self._json(_github_issues(force))
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
        if u.path == "/api/update/install":
            length = int(self.headers.get("Content-Length", 0) or 0)
            if length:
                self.rfile.read(length)
            with LOCK:
                if STATE["job"] and STATE["job"].get("state") == "running":
                    return self._json({"error": "Дождитесь завершения расчёта."}, 409)
            try:
                info = _update_info(False)
                return self._json({"ok": True, **updater.start_install(info)})
            except RuntimeError as exc:
                return self._json({"error": str(exc)}, 409)
            except Exception as exc:
                return self._json({"error": str(exc)}, 500)
        if u.path == "/api/welcome":
            try:
                with open(WELCOME_FILE, "w", encoding="utf-8") as f:
                    f.write("1")
                return self._json({"ok": True})
            except Exception as exc:
                return self._json({"error": str(exc)}, 500)
        if u.path == "/api/clear-cache":
            with LOCK:
                STATE["models"] = None
                STATE["job"] = {"state": "idle"}
            clear_live()
            for d in (UPLOADS, RUNS):
                shutil.rmtree(d, ignore_errors=True)
                os.makedirs(d, exist_ok=True)
            try:
                os.remove(WELCOME_FILE)
            except FileNotFoundError:
                pass
            return self._json({"ok": True})
        if u.path == "/api/folder":
            n = int(self.headers.get("Content-Length", 0))
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
                folder = body.get("path")
                if not folder:
                    return self._json({"error": "не выбрана папка"}, 400)
                sources = scan_folder(folder)
                if not sources:
                    return self._json({"error": "в папке нет файлов .obj или .txt"}, 400)
                return self._json({
                    "sources": sources,
                    "folder": os.path.abspath(os.path.expanduser(folder)),
                })
            except Exception as exc:
                return self._json({"error": str(exc)}, 400)
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
                run_token = _new_run_token()
                run_label = time.strftime("%H:%M:%S") + " · " + run_token[-4:]
                v, faces, title = prepare_source(source)
                alphas, layers = pipeline.build_sections(
                    v, pipeline.mesh_edges(faces), 60, 720
                )
                true_by_z = {round(z, 6): r for z, r in layers}
                results = []
                prev = None
                for i, pct in enumerate(pipeline.SIMPLIFY_LEVELS):
                    t0 = time.time()
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
                        metrics = pipeline.mesh_metrics(true_by_z, alphas, mv, mf)
                        prev = {
                            "mesh": {"v": mv.tolist(), "f": [list(f) for f in mf]},
                            "vertices": int(mp["vertices"]),
                            "faces": int(mp["faces"]),
                            "metrics": metrics,
                        }
                        sec = time.time() - t0
                    elif prev is not None:
                        mp = prev
                        sec = 0.0
                    else:
                        raise ValueError("не удалось построить уровень упрощения")
                    results.append(
                        {
                            "id": f"{run_token}:lv{i}",
                            "label": f"оставлено {pct:g}% · {prev['vertices']}/{prev['faces']}",
                            "kind": "level",
                            "mesh": prev["mesh"],
                            "metrics": prev["metrics"],
                            "quality": quality(prev["metrics"]),
                            "vertices": prev["vertices"],
                            "faces": prev["faces"],
                            "pct": pct,
                            "time": round(sec, 2),
                        }
                    )
                model = {
                    "id": f"levels:{run_token}",
                    "uid": f"{run_token}:levels",
                    "run": run_token,
                    "run_label": run_label,
                    "name": f"{title} · 6 уровней",
                    "levels": True,
                    "source": source,
                    "results": results,
                }
                with LOCK:
                    models = [
                        m for m in (STATE["models"] or [])
                        if not (
                            str(m.get("id", "")).startswith("levels")
                            and m.get("source") == source
                        )
                    ]
                    models.append(model)
                    STATE["models"] = models
                return self._json({
                    "ok": True,
                    "name": model["name"],
                    "id": model["id"],
                    "uid": model["uid"],
                })
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
                return self._json({"result": live_variant(source, body.get("params", {}))})
            except Exception as exc:
                return self._json({"error": str(exc)}, 500)
        if u.path == "/api/run":
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n) or b"{}")
            run_token = _new_run_token()
            run_label = time.strftime("%H:%M:%S") + " · " + run_token[-4:]
            with LOCK:
                if STATE["job"] and STATE["job"].get("state") == "running":
                    return self._json({"error": "уже выполняется"}, 409)
                STATE["job"] = {
                    "state": "running",
                    "stage": "Запуск",
                    "detail": "",
                    "progress": 0.0,
                    "eta": None,
                    "started": time.time(),
                    "elapsed": 0,
                    "model": 1,
                    "models": max(1, len(body.get("sources") or [body.get("source")])),
                    "done": 0,
                    "total": 0,
                    "run": run_token,
                }
            sources = body.get("sources") or [body.get("source")]
            threading.Thread(
                target=_run,
                args=(sources, body.get("params", {}), run_token, run_label),
                daemon=True,
            ).start()
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
    w.writerow(
        ["модель", "вариант", "качество", "MSE", "RMSE", "d_max", "вершин", "граней", "точек", "время, с"]
    )
    for model in models:
        for r in model["results"]:
            m = r.get("metrics") or {}
            w.writerow(
                [
                    model["name"],
                    r["label"],
                    r.get("quality"),
                    m.get("mse"),
                    m.get("rmse"),
                    m.get("dmax"),
                    r.get("vertices"),
                    r.get("faces"),
                    r.get("points"),
                    r.get("time"),
                ]
            )
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true", help="не открывать браузер")
    ap.add_argument("--no-window", action="store_true", help="без отдельного окна")
    args = ap.parse_args()
    with LOCK:
        STATE["models"] = load_all_models()
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
        try:
            import webview

            webview.create_window(
                APP_TITLE,
                url,
                width=1440,
                height=940,
                min_size=(880, 560),
                maximized=True,
                js_api=Api(),
            )
            webview.start(gui="edgechromium")
            return
        except Exception as exc:
            _console_print("Встроенное окно WebView2 недоступно, запускаю Edge/Chrome:", exc)
        proc = open_windows_window(url, os.path.join(DATA, "browser-profile"))
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

        setup_macos_about()
        webview.create_window(
            APP_TITLE, url, width=1440, height=940, min_size=(880, 560), maximized=True, js_api=Api()
        )
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
