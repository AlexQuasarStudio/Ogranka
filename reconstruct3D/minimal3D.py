"""Автоматический режим построения минимального многогранника.

Повторяет логику visualization.py: по облаку точек строится выпуклая
оболочка, затем квадратичная декцимация подбирается автоматически так,
чтобы площадь поверхности уменьшилась не более чем на 0.1%, а близкие
по нормали треугольники сливаются в многоугольные грани.
"""
import argparse
import csv
import os
import numpy as np
from collections import defaultdict, deque
from scipy.spatial import ConvexHull
import open3d as o3d

REL_TOL = 0.001
VARIANTS = ["r0", "r8", "r80", "fft_r8", "fft_r80", "uni_r8", "uni_r80"]
BODIES = ["octa", "icosa", "dodeca", "diamond"]


# =========================================================
# MESH HELPERS (как в visualization.py)
# =========================================================

def repair_mesh(mesh):
    mesh.remove_unreferenced_vertices()
    mesh.remove_degenerate_triangles()
    mesh.remove_duplicated_triangles()
    mesh.remove_duplicated_vertices()
    mesh.remove_non_manifold_edges()
    return mesh


def simplify_mesh(points, faces, pct):
    verts = o3d.utility.Vector3dVector(points.astype(np.float64))
    tris = o3d.utility.Vector3iVector(faces.astype(np.int32))
    mesh = o3d.geometry.TriangleMesh(verts, tris)
    mesh.compute_vertex_normals()
    repair_mesh(mesh)
    target = max(4, int(len(mesh.triangles) * pct / 100))
    dec = mesh.simplify_quadric_decimation(target_number_of_triangles=target)
    return np.asarray(dec.vertices), np.asarray(dec.triangles)


def surface_area(points, faces):
    tris = points[faces]
    v1 = tris[:, 1] - tris[:, 0]
    v2 = tris[:, 2] - tris[:, 0]
    return 0.5 * np.linalg.norm(np.cross(v1, v2), axis=1).sum()


def hull_mesh(points):
    hull = ConvexHull(points)
    idx = hull.vertices
    remap = {int(old): new for new, old in enumerate(idx)}
    faces = np.array([[remap[int(i)] for i in tri] for tri in hull.simplices])
    return points[idx], faces


def auto_pct(points, faces):
    mesh_orig = o3d.geometry.TriangleMesh(
        o3d.utility.Vector3dVector(points.astype(np.float64)),
        o3d.utility.Vector3iVector(faces.astype(np.int32)),
    )
    mesh_orig.compute_vertex_normals()
    repair_mesh(mesh_orig)
    orig_area = mesh_orig.get_surface_area()

    low, high = 0.0, 100.0
    best = high
    iters = int(np.log2(len(faces))) + 2
    for _ in range(iters):
        mid = (low + high) / 2.0
        pts2, f2 = simplify_mesh(points, faces, mid)
        mesh2 = o3d.geometry.TriangleMesh(
            o3d.utility.Vector3dVector(pts2.astype(np.float64)),
            o3d.utility.Vector3iVector(f2.astype(np.int32)),
        )
        mesh2.compute_vertex_normals()
        repair_mesh(mesh2)
        if mesh2.get_surface_area() / orig_area >= 1 - REL_TOL:
            best = mid
            high = mid
        else:
            low = mid
    return best


def merge_coplanar_faces(points, faces, angle_tol_deg=1.0):
    normals = np.cross(points[faces][:, 1] - points[faces][:, 0],
                       points[faces][:, 2] - points[faces][:, 0])
    normals /= np.linalg.norm(normals, axis=1)[:, None]
    tol = np.cos(np.deg2rad(angle_tol_deg))

    edges = defaultdict(list)
    for i, f in enumerate(faces):
        for e in ((f[0], f[1]), (f[1], f[2]), (f[2], f[0])):
            edges[tuple(sorted(e))].append(i)

    adj = [[] for _ in faces]
    for nbrs in edges.values():
        if len(nbrs) == 2:
            a, b = nbrs
            if abs(normals[a].dot(normals[b])) >= tol:
                adj[a].append(b)
                adj[b].append(a)

    visited = [False] * len(faces)
    merged = []
    for i in range(len(faces)):
        if visited[i]:
            continue
        queue = deque([i])
        visited[i] = True
        group = [i]
        while queue:
            u = queue.popleft()
            for v in adj[u]:
                if not visited[v]:
                    visited[v] = True
                    queue.append(v)
                    group.append(v)
        verts = np.unique(points[np.concatenate(faces[group])], axis=0)
        ctr = verts.mean(axis=0)
        n = normals[group[0]]
        ref = np.array([1.0, 0, 0])
        if abs(n.dot(ref)) > 0.9:
            ref = np.array([0, 1.0, 0])
        u = np.cross(n, ref)
        u /= np.linalg.norm(u)
        v = np.cross(n, u)
        ang = np.arctan2((verts - ctr) @ v, (verts - ctr) @ u)
        merged.append(verts[np.argsort(ang)])
    return merged


# =========================================================
# PIPELINE
# =========================================================

def minimal_polyhedron(points):
    """Автоматический режим с перестроением оболочки после декцимации."""
    import sys
    app_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "app"))
    if app_dir not in sys.path:
        sys.path.insert(0, app_dir)
    from core import pipeline as _pipeline
    m = _pipeline.minimal_polyhedron(np.asarray(points, float))
    return {
        "pct": float(m.get("pct") or 0.0),
        "vertices": int(m["vertices"]),
        "faces": int(m["faces"]),
        "triangles": int(m["triangles"]),
        "polygons": m["polygons"],
        "points": m["points"],
        "hull_faces": int(m.get("hull_faces") or 0),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="out3D")
    args = ap.parse_args()

    rows = []
    for body in BODIES:
        for v in VARIANTS:
            pts = np.loadtxt(os.path.join(args.out, f"points_{v}_{body}.txt"))
            m = minimal_polyhedron(pts)
            rows.append({
                "body": body,
                "variant": v,
                "hull_triangles": m["hull_faces"],
                "pct": round(m["pct"], 2),
                "vertices": m["vertices"],
                "faces": m["faces"],
                "triangles": m["triangles"],
            })
            print(f"{body:8s} {v:8s} hull={m['hull_faces']:5d} pct={m['pct']:6.2f}% "
                  f"-> {m['vertices']:4d} вершин, {m['faces']:4d} граней")

    path = os.path.join(args.out, "minimal_counts.csv")
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print("saved", path)


if __name__ == "__main__":
    main()
