"""Live preview cache and computation."""
import json
import threading
import time

import numpy as np

from core import pipeline
from sources import prepare_source, quality

LIVE = {"key": None, "base": None}
LIVE_LOCK = threading.Lock()


def clear_live():
    with LIVE_LOCK:
        LIVE["key"] = None
        LIVE["base"] = None


def live_variant(source, params):
    t0 = time.time()
    n_angles = int(params.get("angles", 720))
    n_layers = int(params.get("layers", 60))
    mode = params.get("mode", "envelope")
    noise_model = params.get("noise_model", "angles")
    method = params.get("method", "fft")
    noise = max(0.0, min(0.2, float(params.get("noise", 0.008))))
    pct = max(5.0, min(100.0, float(params.get("pct", 100))))
    harmonics = int(params.get("harmonics", 32))
    window = int(params.get("window", 5))
    angle = float(params.get("angle", 1.0))
    loss = float(params.get("loss", 0.001))
    contour_step = 3.0 / max(1, n_layers)
    key = json.dumps(
        {
            "source": source,
            "angles": n_angles,
            "layers": n_layers,
            "mode": mode,
            "noise_model": noise_model,
            "angle": angle,
        },
        sort_keys=True,
        ensure_ascii=False,
    )
    effective_method = "none" if noise <= 0 else method

    with LIVE_LOCK:
        base = LIVE.get("base")
        if LIVE.get("key") != key:
            v, faces, title = prepare_source(source)
            section_polys = None
            edge_units = []
            normal_units = []
            unit = None
            if noise_model in ("edges", "normal"):
                alphas, layers, section_polys = pipeline.build_sections_ex(
                    v, pipeline.mesh_edges(faces), n_layers, n_angles
                )
                zs = np.array([z for z, _ in layers])
                r_true = np.vstack([r for _, r in layers])
                true_by_z = {round(z, 6): r for z, r in layers}
                if noise_model == "edges":
                    edge_rng = np.random.default_rng(2000)
                    edge_units = [
                        edge_rng.uniform(-1.0, 1.0, size=len(poly)) for _, poly in section_polys
                    ]
                else:
                    normal_rng = np.random.default_rng(2000)
                    for _, poly in section_polys:
                        cnt = len(pipeline.resample_contour(poly, contour_step)[0])
                        normal_units.append(normal_rng.uniform(-1.0, 1.0, size=cnt))
            else:
                alphas, layers = pipeline.build_sections(
                    v, pipeline.mesh_edges(faces), n_layers, n_angles
                )
                zs = np.array([z for z, _ in layers])
                r_true = np.vstack([r for _, r in layers])
                true_by_z = {round(z, 6): r for z, r in layers}
                unit = np.random.default_rng(12345).uniform(-1.0, 1.0, size=r_true.shape)
            base = {
                "title": title,
                "alphas": alphas,
                "zs": zs,
                "r_true": r_true,
                "true_by_z": true_by_z,
                "noise_unit": unit,
                "section_polys": section_polys,
                "edge_units": edge_units,
                "normal_units": normal_units,
                "contour_step": contour_step,
                "noise_model": noise_model,
                "variant": None,
                "pts": None,
                "hull": None,
                "contours": None,
            }
            LIVE["key"] = key
            LIVE["base"] = base

        variant = (noise, effective_method, harmonics, window)
        if base.get("variant") != variant:
            contours = None
            if noise_model == "normal":
                contours = pipeline.normal_noise_layers(
                    base["section_polys"], base["contour_step"], noise, base["normal_units"]
                )
                rows = pipeline.contours_support_layers(contours, base["alphas"])
                r = np.vstack([row for _, row in rows])
            elif noise_model == "edges":
                if noise > 0:
                    noisy_layers = pipeline.edge_noise_layers(
                        base["section_polys"], base["alphas"], noise, base["edge_units"]
                    )
                    r = np.vstack([row for _, row in noisy_layers])
                else:
                    r = base["r_true"].copy()
            else:
                r = base["r_true"] + noise * base["noise_unit"] if noise > 0 else base["r_true"].copy()
            if noise <= 0:
                # сглаживать нечего: при нулевом шуме форма должна совпадать с точной
                rs = r
            elif effective_method == "fft":
                a, pinv = pipeline.fourier_design(base["alphas"], harmonics)
                rs = pipeline.fourier_denoise_matrix(r, a, pinv)
            elif effective_method == "uni":
                rows = []
                for i in range(len(base["zs"])):
                    rows.append(pipeline.uniform_denoise_adaptive(r[i], base["r_true"][i], window, 30))
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
            base["contours"] = contours
            base["variant"] = variant

        if effective_method == "none" and noise > 0 and base.get("contours") is not None:
            smoothed = pipeline.fourier_smooth_contours(base["contours"], harmonics)
            loft = pipeline.loft_contours(smoothed)
            if loft is not None:
                lv, lf = loft
                metrics = pipeline.contours_metrics(
                    base["true_by_z"], base["alphas"], smoothed
                )
                label = f"живой · шум {noise:g} · контуры (лофт, Фурье)"
                return {
                    "id": "live",
                    "label": label,
                    "kind": "live",
                    "mesh": {"v": lv.tolist(), "f": [list(f) for f in lf]},
                    "metrics": metrics,
                    "quality": quality(metrics),
                    "vertices": int(len(lv)),
                    "faces": int(len(lf)),
                    "points": int(sum(len(p) for _, p in smoothed)),
                    "time": round(time.time() - t0, 2),
                    "noise": noise,
                    "pct": pct,
                    "method": "none",
                }

        pts = base["pts"]
        hv, hf = base["hull"]
        mp = pipeline.minimal_polyhedron(
            pts, angle_tol_deg=angle, loss_target=loss, hull=(hv, hf), pct=pct, snap=False
        )
        mv, mf = pipeline.polygons_to_mesh(mp["polygons"])
        metrics = pipeline.mesh_metrics(base["true_by_z"], base["alphas"], mv, mf)
        label = f"живой · шум {noise:g} · оставлено {round(pct):g}%"
        if noise > 0 and effective_method == "none":
            label += " · без сглаживания"
        return {
            "id": "live",
            "label": label,
            "kind": "live",
            "mesh": {"v": mv.tolist(), "f": [list(f) for f in mf]},
            "metrics": metrics,
            "quality": quality(metrics),
            "vertices": int(mp["vertices"]),
            "faces": int(mp["faces"]),
            "points": int(len(pts)),
            "time": round(time.time() - t0, 2),
            "noise": noise,
            "pct": pct,
            "method": effective_method,
        }
