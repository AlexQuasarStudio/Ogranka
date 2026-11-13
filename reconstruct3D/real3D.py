"""Работа с реальными OBJ-моделями: загрузка, ориентация, сечения.

Модели из сканера лежат площадкой вниз (z_min) и колетом вверх (z_max),
поэтому по умолчанию они переворачиваются: корона оказывается сверху,
колет — внизу, z отсчитывается от 0, высота нормируется к H = 3.
"""
import numpy as np
from scipy.spatial import ConvexHull


def load_obj(path):
    verts, faces = [], []
    with open(path) as f:
        for line in f:
            if line.startswith("v "):
                verts.append([float(x) for x in line.split()[1:4]])
            elif line.startswith("f "):
                faces.append([int(t.split("/")[0]) - 1 for t in line.split()[1:]])
    return np.asarray(verts, float), faces


def mesh_edges(faces):
    edges = set()
    for face in faces:
        n = len(face)
        for i in range(n):
            a, b = face[i], face[(i + 1) % n]
            edges.add((min(a, b), max(a, b)))
    return sorted(edges)


def normalize_mesh(v, height=3.0, flip=True, center=True):
    v = v.copy()
    if flip:
        v[:, 2] = v[:, 2].max() + v[:, 2].min() - v[:, 2]
    if center:
        c = (v[:, :2].min(axis=0) + v[:, :2].max(axis=0)) / 2.0
        v[:, :2] -= c
    zmin, zmax = v[:, 2].min(), v[:, 2].max()
    v *= height / (zmax - zmin)
    v[:, 2] -= v[:, 2].min()
    return v


def section_from_edges(v, edges, z):
    """Сечение сетки плоскостью z = const (выпуклая оболочка точек пересечения)."""
    pts = []
    for i, j in edges:
        zi, zj = v[i, 2], v[j, 2]
        if (zi - z) * (zj - z) < 0:
            t = (z - zi) / (zj - zi)
            pts.append(v[i] + t * (v[j] - v[i]))
    if len(pts) < 3:
        return None
    pts = np.asarray(pts)[:, :2]
    hull = ConvexHull(pts)
    poly = pts[hull.vertices]

    keep = []
    n = len(poly)
    scale = np.abs(poly).max() if np.abs(poly).max() > 0 else 1.0
    for i in range(n):
        a, b, c = poly[i - 1], poly[i], poly[(i + 1) % n]
        cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        if abs(cross) > 1e-9 * scale * scale:
            keep.append(i)
    if len(keep) >= 3:
        poly = poly[keep]
    return poly


def support(poly, alphas):
    e = np.column_stack([np.cos(alphas), np.sin(alphas)])
    return (e @ poly.T).max(axis=1)


def envelope(alphas, rs, tol=1e-9):
    """Восстановление сечения как пересечения полуплоскостей.

    Каждое измерение даёт ограничение x*cos(a) + y*sin(a) <= r(a).
    Кандидаты в вершины — пересечения соседних прямых; оставляются те,
    что удовлетворяют всем ограничениям.
    """
    A = np.column_stack([np.cos(alphas), np.sin(alphas)])
    A2 = np.roll(A, -1, axis=0)
    b2 = np.roll(rs, -1)
    det = A[:, 0] * A2[:, 1] - A[:, 1] * A2[:, 0]
    ok = np.abs(det) > 1e-12
    safe = np.where(ok, det, 1.0)
    x = (rs * A2[:, 1] - A[:, 1] * b2) / safe
    y = (A[:, 0] * b2 - rs * A2[:, 0]) / safe
    P = np.column_stack([x, y])[ok]
    if len(P) == 0:
        return P
    vals = P @ A.T
    mask = np.all(vals <= rs[None, :] + tol, axis=1)
    return P[mask]
