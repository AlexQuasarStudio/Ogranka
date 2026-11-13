"""Геометрия: разбор, сечения, оболочка и полигоны."""

import numpy as np
from scipy.spatial import ConvexHull, QhullError

__all__ = [
    "parse_obj",
    "parse_points",
    "normalize_mesh",
    "hull",
    "mesh_edges",
    "section_from_edges",
    "support",
    "build_sections",
    "hull_compact",
    "mesh_area",
    "merge_coplanar",
    "snap_to_planes",
    "triangulate_polygon",
    "polygons_to_mesh",
]


def parse_obj(text):
    verts, faces = [], []
    for line in text.splitlines():
        parts = line.split()
        if not parts:
            continue
        if parts[0] == "v" and len(parts) >= 4:
            verts.append([float(parts[1]), float(parts[2]), float(parts[3])])
        elif parts[0] == "f" and len(parts) >= 4:
            idx = []
            for tok in parts[1:]:
                i = int(tok.split("/")[0])
                idx.append(i - 1 if i > 0 else len(verts) + i)
            for k in range(1, len(idx) - 1):
                faces.append([idx[0], idx[k], idx[k + 1]])
    return np.asarray(verts, float), faces


def parse_points(text):
    pts = []
    for line in text.splitlines():
        parts = line.replace(",", " ").split()
        if len(parts) < 3:
            continue
        try:
            pts.append([float(parts[0]), float(parts[1]), float(parts[2])])
        except ValueError:
            continue
    return np.asarray(pts, float)


def normalize_mesh(v, height=3.0, flip=True):
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


def hull(verts):
    h = ConvexHull(verts)
    return verts, [[int(i) for i in s] for s in h.simplices]


def mesh_edges(faces):
    edges = set()
    for f in faces:
        for a, b in ((f[0], f[1]), (f[1], f[2]), (f[2], f[0])):
            edges.add((min(a, b), max(a, b)))
    return sorted(edges)


def section_from_edges(v, edges, z):
    pts = []
    for i, j in edges:
        zi, zj = v[i, 2], v[j, 2]
        if (zi - z) * (zj - z) < 0:
            t = (z - zi) / (zj - zi)
            pts.append(v[i] + t * (v[j] - v[i]))
    if len(pts) < 3:
        return None
    pts = np.asarray(pts)[:, :2]
    try:
        h = ConvexHull(pts)
        poly = pts[h.vertices]
    except QhullError:
        return None
    return poly


def support(poly, alphas):
    e = np.column_stack([np.cos(alphas), np.sin(alphas)])
    return (e @ poly.T).max(axis=1)


def build_sections(v, edges, n_layers=60, n_angles=720, progress=None):
    alphas = np.arange(n_angles) * (2.0 * np.pi / n_angles)
    dz = 3.0 / n_layers
    layers = []
    for k in range(n_layers):
        z = (k + 0.5) * dz
        poly = section_from_edges(v, edges, z)
        if poly is None:
            continue
        layers.append((float(z), support(poly, alphas)))
        if progress and k % 5 == 0:
            progress(0.05 + 0.4 * k / n_layers)
    return alphas, layers


def hull_compact(points):
    h = ConvexHull(points)
    hv = points[h.vertices]
    remap = {int(old): new for new, old in enumerate(h.vertices)}
    hf = [[remap[int(i)] for i in s] for s in h.simplices]
    return hv, hf


def mesh_area(points, faces):
    return float(
        sum(
            0.5 * np.linalg.norm(np.cross(points[f][1] - points[f][0], points[f][2] - points[f][0]))
            for f in faces
        )
    )


def merge_coplanar(points, faces, angle_tol_deg=1.0):
    points = np.asarray(points, float)
    faces = [list(map(int, f)) for f in faces]
    if not faces:
        return []

    center = points.mean(axis=0)
    for f in faces:
        if len(f) < 3:
            continue
        a, b, c = points[f[0]], points[f[1]], points[f[2]]
        if np.dot(np.cross(b - a, c - a), a - center) < 0:
            f[1], f[2] = f[2], f[1]

    def key(i):
        return tuple(np.round(points[i], 6))

    key_point = {}
    for p in points:
        key_point[tuple(np.round(p, 6))] = p

    normals, offsets = [], []
    for f in faces:
        if len(f) < 3:
            normals.append(np.zeros(3))
            offsets.append(0.0)
            continue
        a, b, c = points[f[0]], points[f[1]], points[f[2]]
        n = np.cross(b - a, c - a)
        ln = np.linalg.norm(n)
        if ln < 1e-12:
            normals.append(np.zeros(3))
            offsets.append(0.0)
        else:
            n = n / ln
            normals.append(n)
            offsets.append(float(np.dot(n, a)))

    tol = np.cos(np.deg2rad(angle_tol_deg))
    edges = {}
    for fi, f in enumerate(faces):
        for a, b in ((f[0], f[1]), (f[1], f[2]), (f[2], f[0])):
            ka, kb = key(a), key(b)
            edges.setdefault((min(ka, kb), max(ka, kb)), []).append((fi, ka, kb))

    adj = [[] for _ in faces]
    for lst in edges.values():
        if len(lst) != 2:
            continue
        (fi, _, _), (fj, _, _) = lst
        if normals[fi].dot(normals[fj]) >= tol:
            adj[fi].append(fj)
            adj[fj].append(fi)

    def newell(pts):
        n = np.zeros(3)
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            n += np.cross(a, b)
        ln = np.linalg.norm(n)
        return n / ln if ln > 1e-12 else np.zeros(3)

    def angle_poly(comp):
        verts = []
        seen = set()
        for g in comp:
            for i in faces[g]:
                k = key(i)
                if k not in seen:
                    seen.add(k)
                    verts.append(key_point[k])
        verts = np.asarray(verts, float)
        ctr = verts.mean(axis=0)
        nrm = sum((normals[g] for g in comp), np.zeros(3))
        nrm = nrm / (np.linalg.norm(nrm) or 1.0)
        ref = np.array([1.0, 0.0, 0.0]) if abs(nrm[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
        u = np.cross(nrm, ref)
        u /= np.linalg.norm(u)
        v = np.cross(nrm, u)
        ang = np.arctan2((verts - ctr) @ v, (verts - ctr) @ u)
        return verts[np.argsort(ang)]

    seen = [False] * len(faces)
    polys = []
    diag = float(np.linalg.norm(points.max(axis=0) - points.min(axis=0))) or 1.0
    plane_tol = max(1e-9, 1e-6 * diag)

    def planar(poly):
        p = np.asarray(poly, float)
        if len(p) < 3:
            return False
        n = newell(p)
        if np.linalg.norm(n) < 1e-12:
            return False
        c = p.mean(axis=0)
        return float(np.max(np.abs((p - c) @ n))) <= plane_tol

    def fallback(comp):
        for g in comp:
            polys.append(np.asarray([points[i] for i in faces[g]], float))

    for i in range(len(faces)):
        if seen[i] or np.linalg.norm(normals[i]) == 0:
            continue
        q, comp = [i], []
        seen[i] = True
        while q:
            u = q.pop()
            comp.append(u)
            for w in adj[u]:
                if not seen[w]:
                    seen[w] = True
                    q.append(w)

        cnt = {}
        for g in comp:
            f = faces[g]
            for a, b in ((f[0], f[1]), (f[1], f[2]), (f[2], f[0])):
                ka, kb = key(a), key(b)
                cnt[(ka, kb)] = cnt.get((ka, kb), 0) + 1

        boundary = [e for e in cnt if cnt.get((e[1], e[0]), 0) == 0]
        if not boundary:
            poly = angle_poly(comp)
            if planar(poly):
                polys.append(poly)
            else:
                fallback(comp)
            continue

        remaining = set(boundary)
        loops = []
        while remaining:
            ka, kb = next(iter(remaining))
            loop = [ka]
            cur = kb
            remaining.discard((ka, kb))
            ok = True
            while cur != loop[0]:
                loop.append(cur)
                nxt = [e for e in remaining if e[0] == cur]
                if not nxt:
                    ok = False
                    break
                e = nxt[0]
                remaining.discard(e)
                cur = e[1]
                if len(loop) > len(boundary) + 1:
                    ok = False
                    break
            if ok and len(loop) >= 3:
                loops.append(loop)

        if not loops:
            poly = angle_poly(comp)
            if planar(poly):
                polys.append(poly)
            else:
                fallback(comp)
            continue

        def loop_area(loop):
            p = np.asarray([key_point[k] for k in loop], float)
            n = newell(p)
            return abs(float(np.dot(n, p.mean(axis=0))))

        loops.sort(key=loop_area, reverse=True)
        verts = np.asarray([key_point[k] for k in loops[0]], float)
        nrm = newell(verts)
        ncomp = sum((normals[g] for g in comp), np.zeros(3))
        if np.dot(nrm, ncomp) < 0:
            verts = verts[::-1]
        if planar(verts):
            polys.append(verts)
        else:
            fallback(comp)

    return polys


def snap_to_planes(v, v_orig, f_orig, tol):
    polys = merge_coplanar(v_orig, f_orig, 0.15)
    planes = []
    for poly in polys:
        p = np.asarray(poly, float)
        if len(p) < 3:
            continue
        n = np.zeros(3)
        for i in range(len(p)):
            n += np.cross(p[i], p[(i + 1) % len(p)])
        ln = np.linalg.norm(n)
        if ln < 1e-12:
            continue
        n /= ln
        c = p.mean(axis=0)
        if np.dot(n, c - p[0]) < 0:
            n = -n
        d = float(np.dot(n, p[0]))
        a = p[1] - p[0]
        a -= n * np.dot(a, n)
        la = np.linalg.norm(a)
        if la < 1e-12:
            continue
        a /= la
        b = np.cross(n, a)
        uv = np.array([[float(np.dot(q - p[0], a)), float(np.dot(q - p[0], b))] for q in p])
        uc = uv.mean(axis=0)
        uv = (uv - uc) * 1.25 + uc
        planes.append((n, d, p[0], a, b, uv))
    out = np.array(v, float, copy=True)
    for i in range(len(out)):
        best = tol
        target = None
        q = out[i]
        for n, d, p0, a, b, uv in planes:
            dist = abs(float(np.dot(n, q)) - d)
            if dist >= best:
                continue
            u = float(np.dot(q - p0, a))
            w = float(np.dot(q - p0, b))
            inside = False
            j = len(uv) - 1
            for k in range(len(uv)):
                uk, wk = uv[k]
                uj, wj = uv[j]
                if (wk > w) != (wj > w):
                    if u < (uj - uk) * (w - wk) / (wj - wk + 1e-30) + uk:
                        inside = not inside
                j = k
            if inside:
                best = dist
                target = (n, d)
        if target is not None:
            n, d = target
            out[i] = q - n * (float(np.dot(n, q)) - d)
    return out


def _pt_in_tri(p, a, b, c):
    s1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
    s2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0])
    s3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0])
    return (s1 >= -1e-12 and s2 >= -1e-12 and s3 >= -1e-12) or (s1 <= 1e-12 and s2 <= 1e-12 and s3 <= 1e-12)


def triangulate_polygon(poly):
    p = np.asarray(poly, float)
    n = len(p)
    if n < 3:
        return []
    if n == 3:
        return [p]
    nrm = np.zeros(3)
    for i in range(n):
        a, b = p[i], p[(i + 1) % n]
        nrm += np.cross(a, b)
    ln = np.linalg.norm(nrm)
    if ln < 1e-12:
        return [[p[0], p[i], p[i + 1]] for i in range(1, n - 1)]
    nrm /= ln
    a = p[1] - p[0]
    a -= nrm * np.dot(a, nrm)
    la = np.linalg.norm(a)
    if la < 1e-12:
        return [[p[0], p[i], p[i + 1]] for i in range(1, n - 1)]
    a /= la
    b = np.cross(nrm, a)
    uv = np.column_stack(((p - p[0]) @ a, (p - p[0]) @ b))
    area = 0.5 * float(np.sum(uv[:, 0] * np.roll(uv[:, 1], -1) - np.roll(uv[:, 0], -1) * uv[:, 1]))
    idx = list(range(n))
    if area < 0:
        idx.reverse()
    tris = []
    guard = 0
    while len(idx) > 3 and guard < n * n:
        guard += 1
        found = False
        for k in range(len(idx)):
            i0 = idx[(k - 1) % len(idx)]
            i1 = idx[k]
            i2 = idx[(k + 1) % len(idx)]
            a0, b0, c0 = uv[i0], uv[i1], uv[i2]
            cr = (b0[0] - a0[0]) * (c0[1] - b0[1]) - (b0[1] - a0[1]) * (c0[0] - b0[0])
            if cr <= 1e-12:
                continue
            inside = False
            for j in idx:
                if j in (i0, i1, i2):
                    continue
                if _pt_in_tri(uv[j], a0, b0, c0):
                    inside = True
                    break
            if inside:
                continue
            tris.append(np.array([p[i0], p[i1], p[i2]]))
            idx.pop(k)
            found = True
            break
        if not found:
            break
    for k in range(1, len(idx) - 1):
        tris.append(np.array([p[idx[0]], p[idx[k]], p[idx[k + 1]]]))
    return tris


def polygons_to_mesh(polys):
    verts, index, faces = [], {}, []
    for poly in polys:
        idx = []
        for p in poly:
            key = tuple(np.round(np.asarray(p, float), 6))
            if key not in index:
                index[key] = len(verts)
                verts.append(list(p))
            idx.append(index[key])
        faces.append(idx)
    return np.asarray(verts, float), faces
