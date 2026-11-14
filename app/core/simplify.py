"""Упрощение сетки через fast-simplification."""

import numpy as np

from .geometry import hull_compact, mesh_area

try:
    import fast_simplification as _fast
except Exception:
    _fast = None

HAS_FAST = _fast is not None

__all__ = ["HAS_FAST"]


def _fast_simplify(points, faces, pct):
    if _fast is None:
        raise RuntimeError("fast_simplification недоступен")
    target = max(4, int(len(faces) * pct / 100.0))
    reduction = max(0.0, 1.0 - target / max(1, len(faces)))
    v2, f2 = _fast.simplify(np.asarray(points, float), np.asarray(faces, int), target_reduction=reduction)
    return np.asarray(v2, float), [list(map(int, f)) for f in f2]


def _fast_auto_pct(points, faces, rel_tol):
    orig = mesh_area(points, faces)
    low, high, best = 0.0, 100.0, 100.0
    iters = int(np.log2(max(4, len(faces)))) + 2
    for _ in range(iters):
        mid = 0.5 * (low + high)
        try:
            v2, f2 = _fast_simplify(points, faces, mid)
        except Exception:
            low = mid
            continue
        if len(f2) < 4:
            low = mid
            continue
        try:
            v2, f2 = hull_compact(v2)
        except Exception:
            pass
        if mesh_area(v2, f2) / orig >= 1.0 - rel_tol:
            best = mid
            high = mid
        else:
            low = mid
    return best
