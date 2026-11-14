"""Минимальный многогранник и кэш упрощения."""
import hashlib

import numpy as np

from .geometry import hull_compact, merge_coplanar, snap_to_planes
from .simplify import HAS_FAST, _fast_auto_pct, _fast_simplify

__all__ = ["minimal_polyhedron", "SIMPLIFY_LEVELS"]

_MIN_CACHE = {}
_MIN_ORDER = []
SIMPLIFY_LEVELS = [100, 70, 50, 35, 25, 15]


def minimal_polyhedron(points, angle_tol_deg=1.0, loss_target=0.001, hull=None, pct=None, snap=True):
    points = np.asarray(points, float)
    key = None
    try:
        key = (
            hashlib.blake2b(
                np.ascontiguousarray(points, dtype=np.float64).tobytes(), digest_size=16
            ).hexdigest(),
            round(float(loss_target), 6),
            round(float(angle_tol_deg), 3),
            pct,
            bool(snap),
        )
        if key in _MIN_CACHE:
            return dict(_MIN_CACHE[key])
    except Exception:
        key = None
    if not HAS_FAST:
        raise RuntimeError("fast_simplification не установлен")
    hv, hf = hull if hull is not None else hull_compact(points)
    pct = float(pct) if pct is not None else _fast_auto_pct(hv, hf, loss_target)
    best_v, best_f = _fast_simplify(hv, hf, pct)
    best_v, best_f = hull_compact(best_v)

    if snap:
        diag = float(np.linalg.norm(hv.max(axis=0) - hv.min(axis=0))) or 1.0
        try:
            snapped = snap_to_planes(best_v, hv, hf, 0.02 * diag)
            sv, sf = hull_compact(snapped)
            if len(sf) >= 4:
                best_v, best_f = sv, sf
        except Exception:
            pass

    polys = merge_coplanar(best_v, best_f, angle_tol_deg)
    res = {
        "vertices": int(len(best_v)),
        "faces": int(len(polys)),
        "triangles": int(len(best_f)),
        "polygons": polys,
        "points": best_v,
        "engine": "fast",
        "pct": float(pct) if pct is not None else 0.0,
        "hull_faces": int(len(hf)),
    }
    if key is not None:
        _MIN_CACHE[key] = res
        _MIN_ORDER.append(key)
        while len(_MIN_ORDER) > 12:
            _MIN_CACHE.pop(_MIN_ORDER.pop(0), None)
    return res
