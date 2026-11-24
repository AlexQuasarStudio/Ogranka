"""Геометрия: разбор моделей, сечения, оболочки и полигоны.

Модуль векторизован: горячие пути (сечения, площади, слияние компланарных
граней и привязка вершин к плоскостям) работают на массивах NumPy, а не на
циклах Python. Публичные функции сохраняют прежние сигнатуры и семантику.
"""
from __future__ import annotations

import math

import numpy as np
from qhull_compat import ConvexHull, QhullError

__all__ = [
    "parse_obj",
    "parse_points",
    "normalize_mesh",
    "hull",
    "mesh_edges",
    "edge_array",
    "section_from_edges",
    "support",
    "build_sections",
    "build_sections_ex",
    "SectionSlicer",
    "hull_compact",
    "mesh_area",
    "merge_coplanar",
    "snap_to_planes",
    "triangulate_polygon",
    "polygons_to_mesh",
    "edge_noise_support",
    "edge_noise_layers",
    "resample_contour",
    "normal_noise_contour",
    "normal_noise_layers",
    "contours_support_layers",
    "fourier_smooth_ring",
    "fourier_smooth_contours",
    "loft_contours",
]

_EPS = 1e-12


# ---------------------------------------------------------------- разбор


def parse_obj(text: str):
    """Read ``v``/``f`` records of an OBJ file; polygons are fan-triangulated."""
    verts: list[list[float]] = []
    faces: list[list[int]] = []
    add_vert = verts.append
    add_face = faces.append
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        tag = parts[0]
        if tag == "v":
            add_vert([float(parts[1]), float(parts[2]), float(parts[3])])
        elif tag == "f":
            count = len(verts)
            idx = []
            for tok in parts[1:]:
                i = int(tok.split("/", 1)[0])
                idx.append(i - 1 if i > 0 else count + i)
            first = idx[0]
            for k in range(1, len(idx) - 1):
                add_face([first, idx[k], idx[k + 1]])
    return np.asarray(verts, float), faces


def parse_points(text: str) -> np.ndarray:
    """Read ``x y z`` (or comma separated) rows; malformed rows are skipped."""
    pts = []
    add = pts.append
    for line in text.splitlines():
        parts = line.replace(",", " ").split()
        if len(parts) < 3:
            continue
        try:
            add([float(parts[0]), float(parts[1]), float(parts[2])])
        except ValueError:
            continue
    return np.asarray(pts, float)


def normalize_mesh(v, height=3.0, flip=True):
    """Centre the model in XY, put its base at z=0 and scale it to ``height``."""
    v = np.asarray(v, float).copy()
    if flip:
        v[:, 2] *= -1.0
    v[:, 2] -= v[:, 2].min()
    span = max(v[:, 0].max() - v[:, 0].min(), v[:, 1].max() - v[:, 1].min())
    if span > 0:
        v[:, :2] /= span * 0.5 / 1.15
    v[:, 0] -= (v[:, 0].max() + v[:, 0].min()) / 2.0
    v[:, 1] -= (v[:, 1].max() + v[:, 1].min()) / 2.0
    h = v[:, 2].max() - v[:, 2].min()
    if h > 0:
        v *= height / h
    v[:, 2] -= v[:, 2].min()
    return v


# ---------------------------------------------------------------- оболочки


def hull(verts):
    """Convex hull of ``verts``; returns the original points and triangles."""
    h = ConvexHull(verts)
    return verts, h.simplices.tolist()


def hull_compact(points):
    """Convex hull that keeps only hull vertices (indices are compacted)."""
    points = np.asarray(points, float)
    h = ConvexHull(points)
    used = h.vertices
    remap = np.full(len(points), -1, dtype=np.int64)
    remap[used] = np.arange(len(used))
    return points[used], remap[h.simplices].tolist()


def _face_array(faces):
    """Faces as an ``(F, 3)`` int array when every face is a triangle."""
    if isinstance(faces, np.ndarray):
        return faces[:, :3] if faces.ndim == 2 and faces.shape[1] >= 3 else None
    if not faces:
        return np.zeros((0, 3), dtype=np.int64)
    try:
        arr = np.asarray(faces, dtype=np.int64)
    except (ValueError, TypeError):
        return None
    if arr.ndim != 2 or arr.shape[1] < 3:
        return None
    return arr[:, :3]


def mesh_area(points, faces) -> float:
    """Surface area of a triangle mesh (first three vertices of every face)."""
    points = np.asarray(points, float)
    tri = _face_array(faces)
    if tri is None:
        tri = np.asarray([f[:3] for f in faces], dtype=np.int64)
    if len(tri) == 0:
        return 0.0
    a = points[tri[:, 0]]
    cross = np.cross(points[tri[:, 1]] - a, points[tri[:, 2]] - a)
    return float(0.5 * np.sqrt(np.einsum("ij,ij->i", cross, cross)).sum())


# ---------------------------------------------------------------- рёбра и сечения


def edge_array(faces) -> np.ndarray:
    """Unique undirected edges of polygon faces as a sorted ``(E, 2)`` array."""
    tri = _face_array(faces)
    if tri is not None and (isinstance(faces, np.ndarray) or all(len(f) == 3 for f in faces)):
        a = tri
        pairs = np.concatenate((a[:, [0, 1]], a[:, [1, 2]], a[:, [2, 0]]))
    else:
        rows = []
        for f in faces:
            n = len(f)
            if n < 2:
                continue
            for i in range(n):
                rows.append((f[i], f[(i + 1) % n]))
        if not rows:
            return np.zeros((0, 2), dtype=np.int64)
        pairs = np.asarray(rows, dtype=np.int64)
    if len(pairs) == 0:
        return np.zeros((0, 2), dtype=np.int64)
    pairs = np.sort(pairs, axis=1)
    return np.unique(pairs, axis=0)


def mesh_edges(faces):
    """Unique undirected edges as a sorted list of ``(i, j)`` tuples, ``i < j``."""
    return [tuple(e) for e in edge_array(faces).tolist()]


class SectionSlicer:
    """Cuts a mesh by horizontal planes; edge data is prepared once.

    A section consists of the points where edges cross the plane *and* the
    vertices lying on it.  Restored polyhedra have many vertices exactly at
    the section heights; counting only strict crossings dropped them and
    produced truncated sections with a huge, essentially random ``dmax``.
    """

    def __init__(self, verts, edges):
        v = np.asarray(verts, float).reshape(-1, 3)
        e = np.asarray(edges, dtype=np.int64).reshape(-1, 2)
        self.verts = v
        self.p0 = v[e[:, 0]]
        self.p1 = v[e[:, 1]]
        self.z0 = self.p0[:, 2]
        self.z1 = self.p1[:, 2]
        self.dp = self.p1 - self.p0
        used = np.unique(e) if len(e) else np.zeros(0, dtype=np.int64)
        self.used = v[used]
        span = float(np.ptp(v[:, 2])) if len(v) else 0.0
        self.tol = 1e-9 * max(1.0, span)

    def points(self, z: float) -> np.ndarray:
        """XY points of the section at height ``z`` (crossings, then vertices)."""
        cross = (self.z0 - z) * (self.z1 - z) < 0
        on = np.abs(self.used[:, 2] - z) <= self.tol
        parts = []
        if cross.any():
            z0 = self.z0[cross]
            t = (z - z0) / (self.z1[cross] - z0)
            parts.append((self.p0[cross] + t[:, None] * self.dp[cross])[:, :2])
        if on.any():
            parts.append(self.used[on, :2])
        if not parts:
            return np.zeros((0, 2))
        return parts[0] if len(parts) == 1 else np.concatenate(parts)

    def polygon(self, z: float):
        """Convex section polygon at height ``z`` or ``None``."""
        pts = self.points(z)
        if len(pts) < 3:
            return None
        try:
            h = ConvexHull(pts)
        except QhullError:
            return None
        return pts[h.vertices]


def section_from_edges(v, edges, z):
    """Convex section polygon of the mesh at height ``z`` (``None`` if empty)."""
    return SectionSlicer(v, edges).polygon(z)


_DIRECTIONS: dict = {}


def _directions(alphas) -> np.ndarray:
    """Unit direction matrix for the angle grid (cached for the common grids)."""
    alphas = np.asarray(alphas, float)
    key = (alphas.shape, alphas.tobytes()) if alphas.size <= 4096 else None
    if key is not None:
        cached = _DIRECTIONS.get(key)
        if cached is not None:
            return cached
    e = np.column_stack([np.cos(alphas), np.sin(alphas)])
    if key is not None:
        if len(_DIRECTIONS) > 16:
            _DIRECTIONS.clear()
        _DIRECTIONS[key] = e
    return e


def support(poly, alphas):
    """Support function ``r(α) = max_j (x_j cos α + y_j sin α)``."""
    return (_directions(alphas) @ np.asarray(poly, float).T).max(axis=1)


def build_sections_ex(v, edges, n_layers=60, n_angles=720, progress=None):
    """Build sections and keep the ordered polygon of every section."""
    alphas = np.arange(n_angles) * (2.0 * np.pi / n_angles)
    dz = 3.0 / n_layers
    slicer = SectionSlicer(v, edges)
    layers = []
    polygons = []
    for k in range(n_layers):
        z = (k + 0.5) * dz
        poly = slicer.polygon(z)
        if poly is None:
            continue
        layers.append((float(z), support(poly, alphas)))
        polygons.append((float(z), poly))
        if progress and k % 5 == 0:
            progress(0.05 + 0.4 * k / n_layers)
    return alphas, layers, polygons


def build_sections(v, edges, n_layers=60, n_angles=720, progress=None):
    alphas, layers, _ = build_sections_ex(
        v, edges, n_layers=n_layers, n_angles=n_angles, progress=progress
    )
    return alphas, layers


# ---------------------------------------------------------------- модели шума


def _ccw_polygon(poly):
    p = np.asarray(poly, float)
    if len(p) < 3:
        return p
    area = 0.5 * float(np.sum(
        p[:, 0] * np.roll(p[:, 1], -1) - p[:, 1] * np.roll(p[:, 0], -1)
    ))
    return p if area >= 0 else p[::-1]


def edge_noise_support(poly, alphas, rv, unit):
    """Support of a polygon whose edge lines are shifted by one epsilon each."""
    p = _ccw_polygon(poly)
    if rv <= 0 or len(p) < 3:
        return support(p, alphas)
    m = len(p)
    unit = np.asarray(unit, float)
    if len(unit) != m:
        unit = np.resize(unit, m)
    edge = np.roll(p, -1, axis=0) - p
    length = np.linalg.norm(edge, axis=1)
    if np.any(length < _EPS):
        return support(p, alphas)
    normal = np.column_stack((edge[:, 1], -edge[:, 0])) / length[:, None]
    rhs = np.einsum("ij,ij->i", normal, p) + rv * unit
    nxt = np.roll(np.arange(m), -1)
    mats = np.stack((normal, normal[nxt]), axis=1)
    det = mats[:, 0, 0] * mats[:, 1, 1] - mats[:, 0, 1] * mats[:, 1, 0]
    if np.any(np.abs(det) < 1e-10):
        return support(p, alphas)
    verts = np.linalg.solve(mats, np.stack((rhs, rhs[nxt]), axis=1)[..., None])[..., 0]
    try:
        h = ConvexHull(verts)
        verts = verts[h.vertices]
    except QhullError:
        return support(p, alphas)
    return support(verts, alphas)


def edge_noise_layers(polygons, alphas, rv, units):
    """Apply edge-line noise to every section of the model."""
    if rv <= 0:
        return [(z, support(poly, alphas)) for z, poly in polygons]
    return [
        (z, edge_noise_support(poly, alphas, rv, unit))
        for (z, poly), unit in zip(polygons, units)
    ]


def resample_contour(poly, step):
    """Sample a closed section contour by arc length with a fixed step.

    Returns (points, outward edge normals, source edge index).  The step is
    the same as the vertical spacing of sections, so the noisy point grid is
    roughly isotropic in 3D.
    """
    p = _ccw_polygon(poly)
    if len(p) < 3:
        return np.zeros((0, 2)), np.zeros((0, 2)), np.zeros(0, int)
    seg = np.roll(p, -1, axis=0) - p
    length = np.linalg.norm(seg, axis=1)
    perim = float(length.sum())
    if perim <= _EPS:
        return np.zeros((0, 2)), np.zeros((0, 2)), np.zeros(0, int)
    step = max(float(step), perim / 4000.0, 1e-6)
    n = max(8, int(round(perim / step)))
    s = np.linspace(0.0, perim, n, endpoint=False)
    cum = np.concatenate(([0.0], np.cumsum(length)))
    idx = np.clip(np.searchsorted(cum, s, side="right") - 1, 0, len(p) - 1)
    safe = np.maximum(length[idx], 1e-15)
    t = (s - cum[idx]) / safe
    pts = p[idx] + t[:, None] * seg[idx]
    normals = np.column_stack((seg[idx, 1], -seg[idx, 0])) / safe[:, None]
    return pts, normals, idx


def normal_noise_contour(poly, step, rv, unit=None):
    """Shift every resampled contour point along the normal of its edge."""
    pts, normals, _ = resample_contour(poly, step)
    if len(pts) == 0 or rv <= 0:
        return pts
    u = np.asarray(unit, float) if unit is not None else np.zeros(len(pts))
    if len(u) != len(pts):
        u = np.resize(u, len(pts)) if len(u) else np.zeros(len(pts))
    return pts + rv * u[:, None] * normals


def normal_noise_layers(polygons, step, rv, units):
    """Apply point-normal noise to every ordered section contour."""
    return [
        (float(z), normal_noise_contour(poly, step, rv, unit))
        for (z, poly), unit in zip(polygons, units)
    ]


def contours_support_layers(contours, alphas):
    """Support function of every noisy contour (rows match section order)."""
    out = []
    for z, pts in contours:
        pts = np.asarray(pts, float)
        if len(pts) < 3:
            continue
        out.append((float(z), support(pts, alphas)))
    return out


# ---------------------------------------------------------------- контуры и лофт


def _resample_closed_n(poly, n):
    p = np.asarray(poly, float)
    if len(p) < 2:
        return np.zeros((n, 2))
    seg = np.roll(p, -1, axis=0) - p
    length = np.linalg.norm(seg, axis=1)
    perim = float(length.sum())
    if perim <= _EPS:
        return np.repeat(p[:1], n, axis=0)
    s = np.linspace(0.0, perim, n, endpoint=False)
    cum = np.concatenate(([0.0], np.cumsum(length)))
    idx = np.clip(np.searchsorted(cum, s, side="right") - 1, 0, len(p) - 1)
    t = (s - cum[idx]) / np.maximum(length[idx], 1e-15)
    return p[idx] + t[:, None] * seg[idx]


def fourier_smooth_ring(points, harmonics=32):
    """Periodically low-pass a closed contour ring in its point order."""
    pts = np.asarray(points, float)
    n = len(pts)
    if n < 4:
        return pts.copy()
    m = max(1, min(int(harmonics), n // 2 - 1))
    spectrum = np.fft.rfft(pts, axis=0)
    spectrum[m + 1:] = 0.0
    return np.fft.irfft(spectrum, n=n, axis=0)


def fourier_smooth_contours(contours, harmonics=32):
    """Smooth every closed section ring before lofting the layers."""
    out = []
    for z, pts in contours:
        pts = np.asarray(pts, float)
        if len(pts) >= 3:
            out.append((float(z), fourier_smooth_ring(pts, harmonics)))
    return out


def _ear_clip(uv: np.ndarray, order: list[int]) -> tuple[list[tuple[int, int, int]], list[int]]:
    """Ear clipping on 2D points ``uv`` for the ring ``order`` (CCW).

    Returns the clipped triangles and the indices left when no ear is found.
    The point-in-triangle test of every candidate ear is vectorized.
    """
    idx = list(order)
    n = len(idx)
    tris = []
    guard = 0
    while len(idx) > 3 and guard < n * n:
        guard += 1
        ring = np.asarray(idx)
        pts = uv[ring]
        found = False
        count = len(idx)
        for k in range(count):
            i0 = idx[(k - 1) % count]
            i1 = idx[k]
            i2 = idx[(k + 1) % count]
            a, b, c = uv[i0], uv[i1], uv[i2]
            cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
            if cross <= 1e-12:
                continue
            mask = (ring != i0) & (ring != i1) & (ring != i2)
            if mask.any() and _points_in_triangle(pts[mask], a, b, c).any():
                continue
            tris.append((i0, i1, i2))
            idx.pop(k)
            found = True
            break
        if not found:
            break
    return tris, idx


def _points_in_triangle(p, a, b, c):
    s1 = (b[0] - a[0]) * (p[:, 1] - a[1]) - (b[1] - a[1]) * (p[:, 0] - a[0])
    s2 = (c[0] - b[0]) * (p[:, 1] - b[1]) - (c[1] - b[1]) * (p[:, 0] - b[0])
    s3 = (a[0] - c[0]) * (p[:, 1] - c[1]) - (a[1] - c[1]) * (p[:, 0] - c[0])
    pos = (s1 >= -1e-12) & (s2 >= -1e-12) & (s3 >= -1e-12)
    neg = (s1 <= 1e-12) & (s2 <= 1e-12) & (s3 <= 1e-12)
    return pos | neg


def _signed_area2(uv: np.ndarray) -> float:
    return float(np.sum(uv[:, 0] * np.roll(uv[:, 1], -1) - np.roll(uv[:, 0], -1) * uv[:, 1]))


def _triangulate_indices(poly):
    """Ear clipping for a possibly non-convex 2D ring; returns index triples."""
    p = np.asarray(poly, float)
    n = len(p)
    if n < 3:
        return []
    order = list(range(n))
    if _signed_area2(p) < 0:
        order.reverse()
    tris, rest = _ear_clip(p, order)
    for k in range(1, len(rest) - 1):
        tris.append((rest[0], rest[k], rest[k + 1]))
    return tris


def loft_contours(contours, ring_points=200):
    """Build a closed non-convex surface by lofting ordered section rings."""
    rings = [(float(z), np.asarray(pts, float)) for z, pts in contours if len(pts) >= 3]
    if len(rings) < 2:
        return None
    counts = [len(pts) for _, pts in rings]
    n = max(8, min(int(ring_points), int(round(float(np.median(counts))))))
    samples = []
    ref = None
    for z, pts in rings:
        q = _resample_closed_n(pts, n)
        if ref is not None:
            shift = int(np.argmin(np.linalg.norm(q - ref, axis=1)))
            q = np.roll(q, -shift, axis=0)
        ref = q[0]
        samples.append((z, q))
    layers = len(samples)
    verts = np.empty((layers * n, 3))
    for li, (z, q) in enumerate(samples):
        verts[li * n:(li + 1) * n, :2] = q
        verts[li * n:(li + 1) * n, 2] = z
    k = np.arange(n)
    k2 = (k + 1) % n
    base = (np.arange(layers - 1) * n)[:, None]
    quads = np.stack((base + k, base + k2, base + n + k2, base + n + k), axis=-1).reshape(-1, 4)
    faces = quads.tolist()
    for tri in _triangulate_indices(samples[0][1]):
        faces.append([tri[2], tri[1], tri[0]])
    off = (layers - 1) * n
    for tri in _triangulate_indices(samples[-1][1]):
        faces.append([off + tri[0], off + tri[1], off + tri[2]])
    return verts, faces


# ---------------------------------------------------------------- полигоны


def _newell(pts: np.ndarray) -> np.ndarray:
    """Unnormalised Newell normal of a closed 3D polygon."""
    return np.cross(pts, np.roll(pts, -1, axis=0)).sum(axis=0)


def _unit(vec: np.ndarray) -> np.ndarray:
    ln = float(np.linalg.norm(vec))
    return vec / ln if ln > _EPS else np.zeros(3)


def merge_coplanar(points, faces, angle_tol_deg=1.0):
    """Merge adjacent triangles whose normals differ less than ``angle_tol_deg``.

    Returns a list of planar polygons (arrays of 3D points).  Components that
    cannot be traced into a single planar loop fall back to their triangles.
    """
    points = np.asarray(points, float)
    faces = [list(map(int, f)) for f in faces]
    if not faces:
        return []

    tri = np.asarray([f[:3] for f in faces], dtype=np.int64)
    a = points[tri[:, 0]]
    cross = np.cross(points[tri[:, 1]] - a, points[tri[:, 2]] - a)
    center = points.mean(axis=0)
    flip = np.einsum("ij,ij->i", cross, a - center) < 0
    for fi in np.flatnonzero(flip).tolist():
        f = faces[fi]
        f[1], f[2] = f[2], f[1]
    cross[flip] = -cross[flip]

    lengths = np.sqrt(np.einsum("ij,ij->i", cross, cross))
    valid = lengths >= _EPS
    normals = np.zeros_like(cross)
    normals[valid] = cross[valid] / lengths[valid, None]

    # Ключ вершины — координаты, округлённые до 1e-6: совпавшие точки сливаются.
    keys = [tuple(row) for row in np.round(points, 6).tolist()]
    key_index = {}
    for i, k in enumerate(keys):
        key_index[k] = i

    tol = math.cos(math.radians(angle_tol_deg))
    face_edges = []
    edges: dict = {}
    for fi, f in enumerate(faces):
        k0, k1, k2 = keys[f[0]], keys[f[1]], keys[f[2]]
        pairs = ((k0, k1), (k1, k2), (k2, k0))
        face_edges.append(pairs)
        for ka, kb in pairs:
            edge = (ka, kb) if ka < kb else (kb, ka)
            lst = edges.get(edge)
            if lst is None:
                edges[edge] = [fi]
            else:
                lst.append(fi)

    adj: list[list[int]] = [[] for _ in faces]
    for lst in edges.values():
        if len(lst) != 2:
            continue
        fi, fj = lst
        if float(normals[fi] @ normals[fj]) >= tol:
            adj[fi].append(fj)
            adj[fj].append(fi)

    diag = float(np.linalg.norm(points.max(axis=0) - points.min(axis=0))) or 1.0
    plane_tol = max(1e-9, 1e-6 * diag)

    def key_points(seq) -> np.ndarray:
        return points[[key_index[k] for k in seq]]

    def planar(poly: np.ndarray) -> bool:
        if len(poly) < 3:
            return False
        n = _newell(poly)
        ln = float(np.linalg.norm(n))
        if ln < _EPS:
            return False
        n = n / ln
        return float(np.max(np.abs((poly - poly.mean(axis=0)) @ n))) <= plane_tol

    def angle_poly(comp) -> np.ndarray:
        seen = set()
        order = []
        for g in comp:
            for i in faces[g][:3]:
                k = keys[i]
                if k not in seen:
                    seen.add(k)
                    order.append(k)
        verts = key_points(order)
        ctr = verts.mean(axis=0)
        nrm = normals[comp].sum(axis=0)
        nrm = nrm / (np.linalg.norm(nrm) or 1.0)
        ref = np.array([1.0, 0.0, 0.0]) if abs(nrm[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
        u = np.cross(nrm, ref)
        u /= np.linalg.norm(u)
        v = np.cross(nrm, u)
        rel = verts - ctr
        return verts[np.argsort(np.arctan2(rel @ v, rel @ u))]

    polys: list[np.ndarray] = []

    def emit(poly: np.ndarray, comp) -> None:
        if planar(poly):
            polys.append(poly)
        else:
            for g in comp:
                polys.append(points[faces[g]])

    seen_face = [False] * len(faces)
    for i in range(len(faces)):
        if seen_face[i] or not valid[i]:
            continue
        stack, comp = [i], []
        seen_face[i] = True
        while stack:
            u = stack.pop()
            comp.append(u)
            for w in adj[u]:
                if not seen_face[w]:
                    seen_face[w] = True
                    stack.append(w)

        if len(comp) == 1:
            polys.append(points[faces[comp[0]]])
            continue

        cnt: dict = {}
        for g in comp:
            for edge in face_edges[g]:
                cnt[edge] = cnt.get(edge, 0) + 1
        boundary = [e for e in cnt if (e[1], e[0]) not in cnt]
        if not boundary:
            emit(angle_poly(comp), comp)
            continue

        # Обход контура: следующий отрезок ищется по началу, а не перебором.
        remaining = set(boundary)
        ordered = list(remaining)
        successors: dict = {}
        for e in ordered:
            successors.setdefault(e[0], []).append(e)
        loops = []
        cursor = 0
        limit = len(boundary) + 1
        while remaining:
            while ordered[cursor] not in remaining:
                cursor += 1
            start = ordered[cursor]
            remaining.discard(start)
            loop = [start[0]]
            cur = start[1]
            ok = True
            while cur != loop[0]:
                loop.append(cur)
                nxt = None
                for e in successors.get(cur, ()):
                    if e in remaining:
                        nxt = e
                        break
                if nxt is None:
                    ok = False
                    break
                remaining.discard(nxt)
                cur = nxt[1]
                if len(loop) > limit:
                    ok = False
                    break
            if ok and len(loop) >= 3:
                loops.append(loop)

        if not loops:
            emit(angle_poly(comp), comp)
            continue

        def loop_area(loop):
            p = key_points(loop)
            return abs(float(_newell(p) @ p.mean(axis=0)))

        best = max(loops, key=loop_area) if len(loops) > 1 else loops[0]
        verts = key_points(best)
        if float(_newell(verts) @ normals[comp].sum(axis=0)) < 0:
            verts = verts[::-1]
        emit(verts, comp)

    return polys


def snap_to_planes(v, v_orig, f_orig, tol):
    """Move vertices of ``v`` onto nearby facet planes of the original hull.

    A vertex is projected onto the closest facet plane (closer than ``tol``)
    whose slightly enlarged polygon contains the vertex projection.
    """
    out = np.array(v, float, copy=True)
    if not len(out):
        return out
    normals, offsets, origins, axes_u, axes_w, rings = [], [], [], [], [], []
    for poly in merge_coplanar(v_orig, f_orig, 0.15):
        p = np.asarray(poly, float)
        if len(p) < 3:
            continue
        n = _newell(p)
        ln = float(np.linalg.norm(n))
        if ln < _EPS:
            continue
        n = n / ln
        if float(n @ (p.mean(axis=0) - p[0])) < 0:
            n = -n
        a = p[1] - p[0]
        a = a - n * float(a @ n)
        la = float(np.linalg.norm(a))
        if la < _EPS:
            continue
        a = a / la
        b = np.cross(n, a)
        rel = p - p[0]
        uv = np.column_stack((rel @ a, rel @ b))
        uc = uv.mean(axis=0)
        normals.append(n)
        offsets.append(float(n @ p[0]))
        origins.append(p[0])
        axes_u.append(a)
        axes_w.append(b)
        rings.append((uv - uc) * 1.25 + uc)
    if not normals:
        return out

    dist = np.abs(out @ np.asarray(normals).T - np.asarray(offsets))
    score = np.full(dist.shape, np.inf)
    for pi, ring in enumerate(rings):
        cand = np.flatnonzero(dist[:, pi] < tol)
        if not len(cand):
            continue
        rel = out[cand] - origins[pi]
        inside = _points_in_polygon(rel @ axes_u[pi], rel @ axes_w[pi], ring)
        hit = cand[inside]
        score[hit, pi] = dist[hit, pi]

    best = np.argmin(score, axis=1)
    rows = np.flatnonzero(np.isfinite(score[np.arange(len(out)), best]))
    if len(rows):
        n = np.asarray(normals)[best[rows]]
        d = np.asarray(offsets)[best[rows]]
        q = out[rows]
        out[rows] = q - n * (np.einsum("ij,ij->i", n, q) - d)[:, None]
    return out


def _points_in_polygon(u, w, ring):
    """Even-odd test of many 2D points against one polygon ``ring``."""
    inside = np.zeros(len(u), dtype=bool)
    j = len(ring) - 1
    for k in range(len(ring)):
        uk, wk = ring[k]
        uj, wj = ring[j]
        crosses = (wk > w) != (wj > w)
        if crosses.any():
            x = (uj - uk) * (w - wk) / (wj - wk + 1e-30) + uk
            inside ^= crosses & (u < x)
        j = k
    return inside


def _pt_in_tri(p, a, b, c):
    s1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
    s2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0])
    s3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0])
    return (s1 >= -1e-12 and s2 >= -1e-12 and s3 >= -1e-12) or (s1 <= 1e-12 and s2 <= 1e-12 and s3 <= 1e-12)


def triangulate_polygon(poly):
    """Triangulate a planar 3D polygon (ear clipping in its own plane)."""
    p = np.asarray(poly, float)
    n = len(p)
    if n < 3:
        return []
    if n == 3:
        return [p]
    nrm = _newell(p)
    ln = float(np.linalg.norm(nrm))
    if ln < _EPS:
        return [[p[0], p[i], p[i + 1]] for i in range(1, n - 1)]
    nrm = nrm / ln
    a = p[1] - p[0]
    a = a - nrm * float(a @ nrm)
    la = float(np.linalg.norm(a))
    if la < _EPS:
        return [[p[0], p[i], p[i + 1]] for i in range(1, n - 1)]
    a = a / la
    b = np.cross(nrm, a)
    rel = p - p[0]
    uv = np.column_stack((rel @ a, rel @ b))
    order = list(range(n))
    if _signed_area2(uv) < 0:
        order.reverse()
    tris, rest = _ear_clip(uv, order)
    out = [np.array([p[i0], p[i1], p[i2]]) for i0, i1, i2 in tris]
    for k in range(1, len(rest) - 1):
        out.append(np.array([p[rest[0]], p[rest[k]], p[rest[k + 1]]]))
    return out


def polygons_to_mesh(polys):
    """Weld polygon vertices (1e-6 grid) into a shared vertex/face mesh."""
    polys = [np.asarray(poly, float) for poly in polys]
    if not polys:
        return np.zeros((0, 3)), []
    flat = np.concatenate(polys)
    keys = [tuple(row) for row in np.round(flat, 6).tolist()]
    index: dict = {}
    order = []
    ids = []
    for pos, key in enumerate(keys):
        found = index.get(key)
        if found is None:
            found = len(order)
            index[key] = found
            order.append(pos)
        ids.append(found)
    faces = []
    start = 0
    for poly in polys:
        end = start + len(poly)
        faces.append(ids[start:end])
        start = end
    return flat[order], faces
