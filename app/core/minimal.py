"""Минимальный многогранник и кэш упрощения."""
import hashlib
import math

import numpy as np

from .geometry import hull_compact, merge_coplanar, mesh_area, snap_to_planes
from .simplify import (
    HAS_FAST,
    _fast_auto_pct,
    _fast_simplify,
    cluster_hull,
    qem_decimate,
)

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
    hv, hf = hull if hull is not None else hull_compact(points)
    area0 = mesh_area(hv, hf)
    engine = "qem"
    best_v, best_f = hv, hf

    done = False
    if HAS_FAST:
        try:
            pct = float(pct) if pct is not None else _fast_auto_pct(hv, hf, loss_target)
            v2, f2 = _fast_simplify(hv, hf, pct)
            v2, f2 = hull_compact(v2)
            best_v, best_f = v2, f2
            engine = "fast"
            done = True
        except Exception:
            done = False
    if not done:
        try:
            lo, hi = 0.05, 1.0
            for _ in range(7):
                mid = 0.5 * (lo + hi)
                v2, f2 = qem_decimate(hv, hf, max(4, int(len(hf) * mid)))
                if len(v2) < 4:
                    lo = mid
                    continue
                if mesh_area(v2, f2) >= area0 * (1.0 - loss_target):
                    best_v, best_f = v2, f2
                    hi = mid
                else:
                    lo = mid
        except Exception:
            engine = "cluster"
            diag = float(np.linalg.norm(hv.max(axis=0) - hv.min(axis=0))) or 1.0
            lo, hi = 1e-4 * diag, 0.08 * diag
            for _ in range(14):
                mid = math.sqrt(lo * hi)
                res = cluster_hull(hv, mid)
                if res is None:
                    lo = mid
                    continue
                v2, f2 = res
                if mesh_area(v2, f2) >= area0 * (1.0 - loss_target):
                    best_v, best_f = v2, f2
                    lo = mid
                else:
                    hi = mid

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
        "engine": engine,
        "pct": float(pct) if pct is not None else 0.0,
        "hull_faces": int(len(hf)),
    }
    if key is not None:
        _MIN_CACHE[key] = res
        _MIN_ORDER.append(key)
        while len(_MIN_ORDER) > 12:
            _MIN_CACHE.pop(_MIN_ORDER.pop(0), None)
    return res
