"""Упрощение сетки: fast-simplification и собственный QEM fallback."""

import numpy as np
from scipy.spatial import ConvexHull, QhullError

from .geometry import hull_compact, mesh_area

try:
    import fast_simplification as _fast
except Exception:
    _fast = None

HAS_FAST = _fast is not None

__all__ = ["cluster_hull", "qem_decimate", "HAS_FAST"]


def cluster_hull(points, step):
    snapped = np.round(points / step) * step
    uniq = np.unique(snapped, axis=0)
    if len(uniq) < 4:
        return None
    try:
        h = ConvexHull(uniq)
    except QhullError:
        return None
    return uniq, [list(s) for s in h.simplices]


def _vertex_quadrics(points, faces):
    q = [np.zeros((4, 4)) for _ in range(len(points))]
    for f in faces:
        p0, p1, p2 = points[f[0]], points[f[1]], points[f[2]]
        n = np.cross(p1 - p0, p2 - p0)
        norm = np.linalg.norm(n)
        if norm < 1e-12:
            continue
        n = n / norm
        d = -float(n @ p0)
        row = np.array([n[0], n[1], n[2], d])
        m = np.outer(row, row)
        for v in f:
            q[v] += m
    return q


def qem_decimate(points, faces, target_tri):
    """Квадратичное стягивание рёбер (QEM) с перестроением оболочки в конце."""
    pts = np.asarray(points, float).copy()
    faces = [list(map(int, f)) for f in faces]
    quad = np.asarray(_vertex_quadrics(pts, faces))
    alive = np.ones(len(pts), bool)

    while len(faces) > max(4, target_tri):
        edges = set()
        for f in faces:
            a, b = f[0], f[1]
            edges.add((min(a, b), max(a, b)))
            a, b = f[1], f[2]
            edges.add((min(a, b), max(a, b)))
            a, b = f[2], f[0]
            edges.add((min(a, b), max(a, b)))
        if not edges:
            break
        e = np.array(sorted(edges))
        i, j = e[:, 0], e[:, 1]
        mid = 0.5 * (pts[i] + pts[j])
        m4 = np.column_stack([mid, np.ones(len(mid))])
        qs = quad[i] + quad[j]
        cost = np.einsum("ei,eij,ej->e", m4, qs, m4)
        k = int(np.argmin(cost))
        a, b = int(i[k]), int(j[k])
        Q = quad[a] + quad[b]
        mid = 0.5 * (pts[a] + pts[b])
        cand = [mid, pts[a], pts[b]]
        try:
            opt = np.linalg.solve(Q[:3, :3] + 1e-9 * np.eye(3), -Q[:3, 3])
            if np.all(np.isfinite(opt)):
                cand.append(opt)
        except Exception:
            pass
        best, bestc = mid, float("inf")
        for p in cand:
            m4 = np.array([p[0], p[1], p[2], 1.0])
            c = float(m4 @ Q @ m4)
            if c < bestc:
                best, bestc = np.asarray(p, float), c
        pts[a] = best
        quad[a] = Q
        alive[b] = False
        nf = []
        for f in faces:
            if a in f and b in f:
                continue
            f = [a if v == b else v for v in f]
            if len(set(f)) < 3:
                continue
            nf.append(f)
        faces = nf

    verts = pts[alive]
    if len(verts) < 4:
        verts = pts
    try:
        h = ConvexHull(verts)
        return verts[h.vertices], [list(s) for s in h.simplices]
    except QhullError:
        return pts, faces


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
