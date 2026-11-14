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
    method = params.get("method", "fft")
    noise = max(0.0, min(0.2, float(params.get("noise", 0.008))))
    pct = max(5.0, min(100.0, float(params.get("pct", 100))))
    harmonics = int(params.get("harmonics", 32))
    window = int(params.get("window", 5))
    angle = float(params.get("angle", 1.0))
    loss = float(params.get("loss", 0.001))
    key = json.dumps(
        {
            "source": source,
            "angles": n_angles,
            "layers": n_layers,
            "mode": mode,
            "method": method,
            "harmonics": harmonics,
            "window": window,
            "angle": angle,
        },
        sort_keys=True,
        ensure_ascii=False,
    )

    with LIVE_LOCK:
        base = LIVE.get("base")
        if LIVE.get("key") != key:
            v, faces, title = prepare_source(source)
            alphas, layers = pipeline.build_sections(v, pipeline.mesh_edges(faces), n_layers, n_angles)
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
                "noise": None,
                "pts": None,
                "hull": None,
                "metrics": None,
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
            base["metrics"] = pipeline.metrics(base["true_by_z"], base["alphas"], pts)
            base["noise"] = noise

        pts = base["pts"]
        hv, hf = base["hull"]
        mp = pipeline.minimal_polyhedron(
            pts, angle_tol_deg=angle, loss_target=loss, hull=(hv, hf), pct=pct, snap=False
        )
        mv, mf = pipeline.polygons_to_mesh(mp["polygons"])
        metrics = base["metrics"]
        label = f"живой · шум {noise:g} · упрощение {round(100 - pct):g}%"
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
            "method": method,
        }
