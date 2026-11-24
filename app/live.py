"""Живой предпросмотр: кэш сечений модели и быстрый пересчёт варианта."""
from __future__ import annotations

import json
import threading
import time

from core import pipeline
from core.variants import ModelSections
from jobs import mesh_payload
from sources import prepare_source, quality

_LOCK = threading.Lock()
_CACHE: dict = {"key": None, "sections": None, "variant": None, "pts": None, "hull": None, "contours": None}


def clear_live() -> None:
    with _LOCK:
        _CACHE.update(key=None, sections=None, variant=None, pts=None, hull=None, contours=None)


def _param(params, key, default, cast, low=None, high=None):
    try:
        value = cast(params.get(key, default))
    except (TypeError, ValueError):
        value = cast(default)
    if low is not None:
        value = max(low, value)
    if high is not None:
        value = min(high, value)
    return value


def _result(label, mesh, metrics, vertices, faces, points, started, noise, pct, method) -> dict:
    return {
        "id": "live",
        "label": label,
        "kind": "live",
        "mesh": mesh,
        "metrics": metrics,
        "quality": quality(metrics),
        "vertices": int(vertices),
        "faces": int(faces),
        "points": int(points),
        "time": round(time.time() - started, 2),
        "noise": noise,
        "pct": pct,
        "method": method,
    }


def live_variant(source: dict, params: dict) -> dict:
    """One preview variant for the active viewport.

    Sections of the model are cached between calls; the noisy cloud and its
    hull are reused while only the share of kept triangles changes.
    """
    started = time.time()
    n_angles = _param(params, "angles", 720, int, 16, 4096)
    n_layers = _param(params, "layers", 60, int, 2, 400)
    mode = "maxima" if params.get("mode") == "maxima" else "envelope"
    noise_model = params.get("noise_model", "angles")
    method = params.get("method", "fft")
    noise = _param(params, "noise", 0.008, float, 0.0, 0.2)
    pct = _param(params, "pct", 100, float, 5.0, 100.0)
    harmonics = _param(params, "harmonics", 32, int, 1, 200)
    window = _param(params, "window", 5, int, 1, 30)
    angle = _param(params, "angle", 1.0, float, 0.0, 90.0)
    loss = _param(params, "loss", 0.001, float, 0.0, 1.0)
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
    # При нулевом шуме сглаживать нечего: форма должна совпасть с точной.
    effective = "none" if noise <= 0 else method

    with _LOCK:
        if _CACHE["key"] != key:
            v, faces, _ = prepare_source(source)
            sections = ModelSections(
                v, faces, n_layers, n_angles, noise_model,
                seeds={"angles": 12345, "edges": 2000, "normal": 2000},
            )
            _CACHE.update(key=key, sections=sections, variant=None, pts=None, hull=None, contours=None)
        sections: ModelSections = _CACHE["sections"]

        variant = (noise, effective, harmonics, window)
        if _CACHE["variant"] != variant:
            rows, contours = sections.noisy(noise)
            smoothed = rows if noise <= 0 else sections.smooth(rows, effective, harmonics, window)
            pts = sections.points(smoothed, mode)
            if len(pts) < 4:
                raise ValueError("слишком мало точек")
            _CACHE.update(
                variant=variant, pts=pts, hull=pipeline.hull_compact(pts), contours=contours,
            )

        if effective == "none" and noise > 0 and _CACHE["contours"] is not None:
            rings = pipeline.fourier_smooth_contours(_CACHE["contours"], harmonics)
            loft = pipeline.loft_contours(rings)
            if loft is not None:
                lv, lf = loft
                metrics = pipeline.contours_metrics(sections.true_by_z, sections.alphas, rings)
                return _result(
                    f"живой · шум {noise:g} · контуры (лофт, Фурье)",
                    mesh_payload(lv, lf), metrics, len(lv), len(lf),
                    sum(len(r) for _, r in rings), started, noise, pct, "none",
                )

        pts = _CACHE["pts"]
        mp = pipeline.minimal_polyhedron(
            pts, angle_tol_deg=angle, loss_target=loss, hull=_CACHE["hull"], pct=pct, snap=False
        )
        mv, mf = pipeline.polygons_to_mesh(mp["polygons"])
        metrics = pipeline.mesh_metrics(sections.true_by_z, sections.alphas, mv, mf)
        label = f"живой · шум {noise:g} · оставлено {round(pct):g}%"
        if noise > 0 and effective == "none":
            label += " · без сглаживания"
        return _result(
            label, mesh_payload(mv, mf), metrics, mp["vertices"], mp["faces"],
            len(pts), started, noise, pct, effective,
        )
