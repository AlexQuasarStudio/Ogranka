"""Минимальный многогранник и кэш упрощения."""
from __future__ import annotations

import hashlib
import threading
from collections import OrderedDict

import numpy as np

from .geometry import hull_compact, merge_coplanar, snap_to_planes
from .simplify import HAS_FAST, _fast_auto_pct, _fast_simplify

__all__ = ["minimal_polyhedron", "SIMPLIFY_LEVELS", "clear_cache"]

SIMPLIFY_LEVELS = [100, 70, 50, 35, 25, 15]
_CACHE_SIZE = 12
_CACHE: OrderedDict = OrderedDict()
_LOCK = threading.Lock()


def clear_cache() -> None:
    with _LOCK:
        _CACHE.clear()


def _cache_key(points, loss_target, angle_tol_deg, pct, snap):
    digest = hashlib.blake2b(
        np.ascontiguousarray(points, dtype=np.float64).tobytes(), digest_size=16
    ).hexdigest()
    return (digest, round(float(loss_target), 6), round(float(angle_tol_deg), 3), pct, bool(snap))


def minimal_polyhedron(points, angle_tol_deg=1.0, loss_target=0.001, hull=None, pct=None, snap=True):
    """Simplified convex polyhedron of ``points`` with merged planar faces.

    ``pct`` fixes the share of kept hull triangles; otherwise it is chosen by
    bisection so that the hull loses at most ``loss_target`` of its area.
    With ``snap`` the vertices return onto nearby facet planes of the hull,
    which removes steps on flat faces.  Results are cached (LRU).
    """
    points = np.asarray(points, float)
    key = _cache_key(points, loss_target, angle_tol_deg, pct, snap)
    with _LOCK:
        cached = _CACHE.get(key)
        if cached is not None:
            _CACHE.move_to_end(key)
            return dict(cached)
    if not HAS_FAST:
        raise RuntimeError("fast_simplification не установлен")
    hv, hf = hull if hull is not None else hull_compact(points)
    pct = float(pct) if pct is not None else _fast_auto_pct(hv, hf, loss_target)
    best_v, best_f = _fast_simplify(hv, hf, pct)
    best_v, best_f = hull_compact(best_v)

    if snap:
        diag = float(np.linalg.norm(np.max(hv, axis=0) - np.min(hv, axis=0))) or 1.0
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
        "pct": float(pct),
        "hull_faces": int(len(hf)),
    }
    with _LOCK:
        _CACHE[key] = res
        _CACHE.move_to_end(key)
        while len(_CACHE) > _CACHE_SIZE:
            _CACHE.popitem(last=False)
    return dict(res)
