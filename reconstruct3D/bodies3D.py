import numpy as np
from scipy.spatial import ConvexHull

PHI = (1.0 + 5.0 ** 0.5) / 2.0


# =========================================================
# BODIES
# =========================================================

def vertices_octahedron():
    return np.array([
        [1, 0, 0], [-1, 0, 0],
        [0, 1, 0], [0, -1, 0],
        [0, 0, 1], [0, 0, -1],
    ], float)


def vertices_icosahedron():
    v = []
    for s1 in (1, -1):
        for s2 in (1, -1):
            v.append([0, s1 * 1.0, s2 * PHI])
            v.append([s1 * 1.0, s2 * PHI, 0])
            v.append([s2 * PHI, 0, s1 * 1.0])
    return np.array(v, float)


def vertices_dodecahedron():
    v = []
    for s1 in (1, -1):
        for s2 in (1, -1):
            for s3 in (1, -1):
                v.append([s1 * 1.0, s2 * 1.0, s3 * 1.0])
    for s1 in (1, -1):
        for s2 in (1, -1):
            v.append([0, s1 / PHI, s2 * PHI])
            v.append([s1 / PHI, s2 * PHI, 0])
            v.append([s2 * PHI, 0, s1 / PHI])
    return np.array(v, float)


def vertices_diamond(sides=10, r_table=0.8, r_girdle=1.7, z_girdle=2.05,
                     girdle_h=0.1, r_culet=0.1, height=3.0):
    """Бриллиант короной вверх: площадка, корона, рундист, павильон, колет."""
    v = []
    rings = (
        (r_table, height),                      # площадка (table)
        (r_girdle, z_girdle),                   # верх рундиста
        (r_girdle, z_girdle - girdle_h),        # низ рундиста
        (r_culet, 0.0),                         # колет (culet)
    )
    for r, z in rings:
        for k in range(sides):
            a = 2.0 * np.pi * k / sides
            v.append([r * np.cos(a), r * np.sin(a), z])
    return np.array(v, float)


BODIES = {
    "octa": {
        "title": "Октаэдр",
        "vertices": vertices_octahedron,
        "faces": 8,
        "upright": True,
    },
    "icosa": {
        "title": "Икосаэдр",
        "vertices": vertices_icosahedron,
        "faces": 20,
        "upright": True,
    },
    "dodeca": {
        "title": "Додекаэдр",
        "vertices": vertices_dodecahedron,
        "faces": 12,
        "upright": True,
    },
    "diamond": {
        "title": "Бриллиант",
        "vertices": vertices_diamond,
        "faces": 32,
        "upright": False,   # тело уже ориентировано короной вверх
    },
}


def rotation_to_z(u):
    """Поворот, переводящий направление u в ось +z."""
    u = u / np.linalg.norm(u)
    z = np.array([0.0, 0.0, 1.0])
    axis = np.cross(u, z)
    s = np.linalg.norm(axis)
    c = float(u @ z)
    if s < 1e-12:
        return np.eye(3)
    axis /= s
    K = np.array([[0.0, -axis[2], axis[1]],
                  [axis[2], 0.0, -axis[0]],
                  [-axis[1], axis[0], 0.0]])
    return np.eye(3) + s * K + (1.0 - c) * (K @ K)


def prepare_body(name, height=3.0, upright=None, spin=13.0):
    """Нормирует тело по описанной сфере, ставит вершину вверх,
    растягивает по z до height и сдвигает так, чтобы z начинался с нуля.

    Ориентация "вершиной вверх" нужна, чтобы у полюсов не возникали
    вырожденные сечения-«лезвия»: иначе соседние вершины сечения
    сближаются по углу и не разрешаются дискретной сеткой.
    Тела с собственной ориентацией (бриллиант) не поворачиваются.
    """
    v = BODIES[name]["vertices"]().astype(float)
    v = v / np.linalg.norm(v, axis=1).max()

    if upright is None:
        upright = BODIES[name].get("upright", True)

    if upright:
        top = np.argmax(v[:, 2])
        v = v @ rotation_to_z(v[top]).T
        a = np.radians(spin)
        rz = np.array([[np.cos(a), -np.sin(a), 0.0],
                       [np.sin(a), np.cos(a), 0.0],
                       [0.0, 0.0, 1.0]])
        v = v @ rz.T

    zmin, zmax = v[:, 2].min(), v[:, 2].max()
    v = v * (height / (zmax - zmin))
    v[:, 2] -= v[:, 2].min()
    return v


def body_edges(v):
    hull = ConvexHull(v)
    edges = set()
    for tri in hull.simplices:
        for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
            edges.add((min(a, b), max(a, b)))
    return sorted(edges)


# =========================================================
# SECTIONS
# =========================================================

def section_polygon(v, edges, z):
    """Сечение выпуклого многогранника плоскостью z = const."""
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

    # убираем коллинеарные точки: триангуляция рёбер даёт точки на
    # серединах сторон, которые не являются вершинами сечения
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


def support_function(poly, alphas):
    e = np.column_stack([np.cos(alphas), np.sin(alphas)])
    return (e @ poly.T).max(axis=1)


def generate_sections(v, edges, zs, n_angles):
    alphas = np.arange(n_angles) * (2.0 * np.pi / n_angles)
    layers = []
    for z in zs:
        poly = section_polygon(v, edges, z)
        if poly is None:
            continue
        layers.append((z, support_function(poly, alphas)))
    return alphas, layers


def add_noise(r, rv, rng):
    if rv <= 0:
        return r.copy()
    return r + rv * rng.uniform(-1.0, 1.0, size=r.shape)


def save_polar_3d(path, alphas, layers):
    with open(path, "w") as f:
        for z, r in layers:
            for a, val in zip(alphas, r):
                f.write(f"{a:.8f} {val:.8f} {z:.8f}\n")


def read_polar_3d(path):
    data = np.loadtxt(path)
    return data[:, 0], data[:, 1], data[:, 2]


def layer_indices(zs):
    """Границы слоёв в плоском массиве (слои идут подряд)."""
    order = np.argsort(zs, kind="stable")
    zs_sorted = zs[order]
    uniq, starts = np.unique(zs_sorted, return_index=True)
    idx = []
    for k, z in enumerate(uniq):
        s = starts[k]
        e = starts[k + 1] if k + 1 < len(starts) else len(zs)
        idx.append((z, order[s:e]))
    return idx
