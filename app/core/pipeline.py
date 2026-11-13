"""Самодостаточное ядро конвейера: только numpy и scipy.

Всё считается в памяти: загрузка модели, сечения, шум, сглаживание,
восстановление (максимумы или полуплоскости), минимальный многогранник,
метрики. Внешние 3D-библиотеки не нужны.
"""
import math
import time
from collections import defaultdict, deque

import numpy as np

try:
    import fast_simplification as _fast
except Exception:
    _fast = None
from scipy.spatial import ConvexHull, QhullError


# ---------------------------------------------------------------- загрузка

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


# ---------------------------------------------------------------- обработка

def add_noise(rs, rv, rng):
    return rs + rv * rng.uniform(-1.0, 1.0, size=rs.shape)


def fourier_denoise(alphas, rs, m=12):
    cols = [np.ones_like(alphas)]
    for k in range(1, m + 1):
        cols.append(np.cos(k * alphas))
        cols.append(np.sin(k * alphas))
    A = np.column_stack(cols)
    coef, *_ = np.linalg.lstsq(A, rs, rcond=None)
    return A @ coef


def fourier_design(alphas, m=12):
    cols = [np.ones_like(alphas)]
    for k in range(1, m + 1):
        cols.append(np.cos(k * alphas))
        cols.append(np.sin(k * alphas))
    A = np.column_stack(cols)
    return A, np.linalg.pinv(A)


def fourier_denoise_matrix(R, A, pinv):
    return (np.asarray(R) @ pinv.T) @ A.T


def hull_compact(points):
    h = ConvexHull(points)
    hv = points[h.vertices]
    remap = {int(old): new for new, old in enumerate(h.vertices)}
    hf = [[remap[int(i)] for i in s] for s in h.simplices]
    return hv, hf


def moving_average(rs, k):
    k = max(1, int(k))
    if k == 1:
        return rs.copy()
    kernel = np.ones(2 * k + 1) / (2 * k + 1)
    padded = np.concatenate([rs[-k:], rs, rs[:k]])
    return np.convolve(padded, kernel, mode="valid")


def _minima(rs):
    n = len(rs)
    return [i for i in range(n) if rs[i - 1] > rs[i] and rs[(i + 1) % n] > rs[i]]


def uniform_denoise_adaptive(rs_noisy, rs_true, k_min=5, k_max=30):
    """Подбор k по зонам между минимумами, как в разделе 4 отчёта."""
    rs = np.asarray(rs_noisy, float)
    true = np.asarray(rs_true, float)
    n = len(rs)
    mins = _minima(rs)
    if len(mins) < 2:
        return moving_average(rs, k_min)
    out = rs.copy()
    for a, b in zip(mins, mins[1:]):
        idx = list(range(a, b + 1)) if b > a else list(range(a, n)) + list(range(0, b + 1))
        best_k, best_err = k_min, None
        for k in range(k_min, k_max + 1):
            sm = moving_average(rs, k)
            err = float(np.mean((sm[idx] - true[idx]) ** 2))
            if best_err is None or err < best_err:
                best_err, best_k = err, k
        out[idx] = moving_average(rs, best_k)[idx]
    return out


def maxima_points(alphas, rs, z):
    out = []
    n = len(rs)
    for i in range(n):
        d1 = rs[i] - rs[i - 1]
        d2 = rs[(i + 1) % n] - rs[i]
        if d1 >= 0 and d2 < 0:
            out.append([rs[i] * math.cos(alphas[i]), rs[i] * math.sin(alphas[i]), z])
    return out


def envelope(alphas, rs, tol=1e-9):
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
    return P[np.all(vals <= rs[None, :] + tol, axis=1)]


def envelope_points(alphas, rs, z):
    P = envelope(alphas, rs)
    if len(P) < 3:
        return []
    return [[p[0], p[1], z] for p in P]


# ---------------------------------------------------------------- многогранник

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
            normals.append(np.zeros(3)); offsets.append(0.0); continue
        a, b, c = points[f[0]], points[f[1]], points[f[2]]
        n = np.cross(b - a, c - a)
        ln = np.linalg.norm(n)
        if ln < 1e-12:
            normals.append(np.zeros(3)); offsets.append(0.0)
        else:
            n = n / ln
            normals.append(n); offsets.append(float(np.dot(n, a)))

    tol = np.cos(np.deg2rad(angle_tol_deg))
    diag = float(np.linalg.norm(points.max(axis=0) - points.min(axis=0))) or 1.0
    plane_tol = max(1e-6, 0.002 * diag)

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
                    seen.add(k); verts.append(key_point[k])
        verts = np.asarray(verts, float)
        ctr = verts.mean(axis=0)
        nrm = sum((normals[g] for g in comp), np.zeros(3))
        nrm = nrm / (np.linalg.norm(nrm) or 1.0)
        ref = np.array([1.0, 0.0, 0.0]) if abs(nrm[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
        u = np.cross(nrm, ref); u /= np.linalg.norm(u)
        v = np.cross(nrm, u)
        ang = np.arctan2((verts - ctr) @ v, (verts - ctr) @ u)
        return verts[np.argsort(ang)]

    seen = [False] * len(faces)
    polys = []
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
            polys.append(angle_poly(comp))
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
            polys.append(angle_poly(comp))
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
        polys.append(verts)

    return polys


def mesh_area(points, faces):
    return float(sum(0.5 * np.linalg.norm(np.cross(points[f][1] - points[f][0], points[f][2] - points[f][0])) for f in faces))


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
    v2, f2 = _fast.simplify(np.asarray(points, float), np.asarray(faces, int),
                            target_reduction=reduction)
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


def _o3d_mesh(points, faces):
    import open3d as o3d
    m = o3d.geometry.TriangleMesh(
        o3d.utility.Vector3dVector(np.asarray(points, float)),
        o3d.utility.Vector3iVector(np.asarray(faces, np.int32)))
    m.compute_vertex_normals()
    m.remove_unreferenced_vertices()
    m.remove_degenerate_triangles()
    m.remove_duplicated_triangles()
    m.remove_duplicated_vertices()
    m.remove_non_manifold_edges()
    return m


def _o3d_simplify(points, faces, pct):
    m = _o3d_mesh(points, faces)
    target = max(4, int(len(m.triangles) * pct / 100.0))
    dec = m.simplify_quadric_decimation(target_number_of_triangles=target)
    return np.asarray(dec.vertices), np.asarray(dec.triangles).astype(int).tolist()


def _o3d_auto_pct(points, faces, rel_tol):
    orig = _o3d_mesh(points, faces).get_surface_area()
    low, high, best = 0.0, 100.0, 100.0
    iters = int(np.log2(max(4, len(faces)))) + 2
    for _ in range(iters):
        mid = 0.5 * (low + high)
        v2, f2 = _o3d_simplify(points, faces, mid)
        if len(f2) < 4:
            low = mid
            continue
        try:
            v2, f2 = hull_compact(v2)
        except Exception:
            pass
        area = mesh_area(v2, f2)
        if area / orig >= 1.0 - rel_tol:
            best = mid
            high = mid
        else:
            low = mid
    return best


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
        for (n, d, p0, a, b, uv) in planes:
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


_MIN_CACHE = {}
_MIN_ORDER = []


def minimal_polyhedron(points, angle_tol_deg=1.0, loss_target=0.001, hull=None, pct=None, snap=True):
    points = np.asarray(points, float)
    key = None
    try:
        import hashlib
        key = (hashlib.blake2b(np.ascontiguousarray(points, dtype=np.float64).tobytes(),
                               digest_size=16).hexdigest(),
               round(float(loss_target), 6), round(float(angle_tol_deg), 3), pct, bool(snap), ENGINE, bool(USE_OPEN3D))
        if key in _MIN_CACHE:
            return dict(_MIN_CACHE[key])
    except Exception:
        key = None
    hv, hf = hull if hull is not None else hull_compact(points)
    area0 = mesh_area(hv, hf)
    engine = "qem"
    best_v, best_f = hv, hf

    done = False
    if ENGINE == "fast" and _fast is not None:
        try:
            pct = float(pct) if pct is not None else _fast_auto_pct(hv, hf, loss_target)
            v2, f2 = _fast_simplify(hv, hf, pct)
            v2, f2 = hull_compact(v2)
            best_v, best_f = v2, f2
            engine = "fast"
            done = True
        except Exception:
            done = False
    if not done and ENGINE in ("open3d", "auto") and USE_OPEN3D:
        try:
            import open3d  # noqa: F401
            pct = float(pct) if pct is not None else _o3d_auto_pct(hv, hf, loss_target)
            v2, f2 = _o3d_simplify(hv, hf, pct)
            v2, f2 = hull_compact(v2)
            best_v, best_f = v2, f2
            engine = "open3d"
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


USE_OPEN3D = True
ENGINE = "open3d"

SIMPLIFY_LEVELS = [100, 70, 50, 35, 25, 15]


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


# ---------------------------------------------------------------- метрики

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
        sq += float((diff ** 2).sum())
        dmax = max(dmax, float(diff.max()))
        n += len(diff)
    if n == 0:
        return {"mse": None, "rmse": None, "dmax": None}
    mse = sq / n
    return {"mse": mse, "rmse": math.sqrt(mse), "dmax": dmax}
