"""Метрики восстановления по сечениям."""
import math

import numpy as np
from scipy.spatial import ConvexHull, QhullError

from .geometry import support

__all__ = ["metrics"]


def metrics(true_by_z, alphas, pts):
    from collections import defaultdict as dd

    groups = dd(list)
    for p in pts:
        groups[round(float(p[2]), 6)].append(p)
    sq, dmax = 0.0, 0.0
    n = 0
    for z, arr in groups.items():
        key = min(true_by_z.keys(), key=lambda k: abs(k - z))
        r_true = true_by_z[key]
        xy = np.asarray(arr)[:, :2]
        if len(xy) < 3:
            continue
        try:
            h = ConvexHull(xy)
        except QhullError:
            continue
        r_rec = support(xy[h.vertices], alphas)
        diff = np.abs(r_rec - r_true)
        sq += float((diff**2).sum())
        dmax = max(dmax, float(diff.max()))
        n += len(diff)
    if n == 0:
        return {"mse": None, "rmse": None, "dmax": None}
    mse = sq / n
    return {"mse": mse, "rmse": math.sqrt(mse), "dmax": dmax}
