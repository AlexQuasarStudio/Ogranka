"""Метрики восстановления по опорной функции сечений."""
from __future__ import annotations

import math
from collections import defaultdict

import numpy as np
from qhull_compat import ConvexHull, QhullError

from .geometry import SectionSlicer, edge_array, support

__all__ = ["metrics", "mesh_metrics", "contours_metrics"]


class _Accumulator:
    """Running sum of squared errors, the worst error and the sample count."""

    __slots__ = ("sq", "dmax", "n")

    def __init__(self):
        self.sq = 0.0
        self.dmax = 0.0
        self.n = 0

    def add(self, r_rec, r_true) -> None:
        diff = np.abs(r_rec - np.asarray(r_true, float))
        self.sq += float((diff ** 2).sum())
        self.dmax = max(self.dmax, float(diff.max()))
        self.n += len(diff)

    def result(self) -> dict:
        if self.n == 0:
            return {"mse": None, "rmse": None, "dmax": None}
        mse = self.sq / self.n
        return {"mse": mse, "rmse": math.sqrt(mse), "dmax": self.dmax}


def _nearest_key(keys, z):
    return min(keys, key=lambda k: abs(k - z))


def metrics(true_by_z, alphas, pts):
    """Error of a point cloud: every layer's hull is compared with the truth."""
    pts = np.asarray(pts, float)
    acc = _Accumulator()
    if not len(pts):
        return acc.result()
    groups = defaultdict(list)
    for i, z in enumerate(np.round(pts[:, 2], 6).tolist()):
        groups[z].append(i)
    keys = list(true_by_z.keys())
    for z, rows in groups.items():
        xy = pts[rows, :2]
        if len(xy) < 3:
            continue
        try:
            h = ConvexHull(xy)
        except QhullError:
            continue
        acc.add(support(xy[h.vertices], alphas), true_by_z[_nearest_key(keys, z)])
    return acc.result()


def mesh_metrics(true_by_z, alphas, verts, faces):
    """Error of a mesh: it is sliced at the reference heights."""
    slicer = SectionSlicer(np.asarray(verts, float), edge_array(faces))
    acc = _Accumulator()
    for z, r_true in true_by_z.items():
        poly = slicer.polygon(float(z))
        if poly is None or len(poly) < 3:
            continue
        acc.add(support(poly, alphas), r_true)
    return acc.result()


def contours_metrics(true_by_z, alphas, contours):
    """Support-based error of ordered section contours (works for loud rings)."""
    acc = _Accumulator()
    keys = list(true_by_z.keys())
    for z, pts in contours:
        pts = np.asarray(pts, float)
        if len(pts) < 3 or not keys:
            continue
        acc.add(support(pts, alphas), true_by_z[_nearest_key(keys, float(z))])
    return acc.result()
