"""Экспорт всех 3D-моделей в OBJ.

Для каждого тела выгружаются:
  <тело>_true.obj          — точное аналитическое тело;
  <тело>_<вариант>_hull.obj — выпуклая оболочка облака точек;
  <тело>_<вариант>_min.obj  — минимальный многогранник (auto-режим).

OBJ открывается в Blender, MeshLab, FreeCAD и большинстве 3D-редакторов.
"""
import argparse
import csv
import os
import numpy as np
from scipy.spatial import ConvexHull

from bodies3D import BODIES, prepare_body
from minimal3D import minimal_polyhedron, VARIANTS

BODY_ORDER = ["octa", "icosa", "dodeca", "diamond"]


# =========================================================
# OBJ
# =========================================================

def _orient(verts, faces, center):
    """Разворачивает грани наружу (единая ориентация для просмотрщиков)."""
    out = []
    for f in faces:
        pts = verts[list(f)]
        n = np.cross(pts[1] - pts[0], pts[2] - pts[0])
        c = pts.mean(axis=0)
        out.append(list(f) if np.dot(n, c - center) >= 0 else list(reversed(list(f))))
    return out


def write_obj(path, verts, faces, name):
    verts = np.asarray(verts, float)
    center = verts.mean(axis=0)
    faces = _orient(verts, faces, center)
    with open(path, "w") as f:
        f.write(f"# {name}\n")
        f.write(f"# vertices: {len(verts)}, faces: {len(faces)}\n")
        f.write(f"o {name}\n")
        for p in verts:
            f.write(f"v {p[0]:.6f} {p[1]:.6f} {p[2]:.6f}\n")
        for face in faces:
            f.write("f " + " ".join(str(int(i) + 1) for i in face) + "\n")


def compact(points, faces):
    """Оставляет только используемые вершины и перенумеровывает грани."""
    used = np.unique(np.concatenate([np.asarray(f) for f in faces]))
    remap = {int(old): new for new, old in enumerate(used)}
    verts = points[used]
    new_faces = [[remap[int(i)] for i in f] for f in faces]
    return verts, new_faces


def polys_to_faces(polys):
    """Многоугольники (массивы точек) -> вершины + индексы граней."""
    verts, index, faces = [], {}, []
    for poly in polys:
        idx = []
        for p in poly:
            key = tuple(np.round(p, 6))
            if key not in index:
                index[key] = len(verts)
                verts.append(p)
            idx.append(index[key])
        faces.append(idx)
    return np.array(verts), faces


# =========================================================
# EXPORT
# =========================================================

def export(out_dir="out3D", objects_dir=None):
    objects_dir = objects_dir or os.path.join(out_dir, "obj")
    os.makedirs(objects_dir, exist_ok=True)
    rows = []

    for body in BODY_ORDER:
        body_dir = os.path.join(objects_dir, body)
        os.makedirs(body_dir, exist_ok=True)

        # точное тело
        v = prepare_body(body)
        hull = ConvexHull(v)
        verts, faces = compact(v, [list(s) for s in hull.simplices])
        path = os.path.join(body_dir, f"{body}_true.obj")
        write_obj(path, verts, faces, f"{body}_true")
        rows.append([body, "true", "true", len(verts), len(faces), os.path.relpath(path, objects_dir)])

        for variant in VARIANTS:
            pts = np.loadtxt(os.path.join(out_dir, f"points_{variant}_{body}.txt"))

            # выпуклая оболочка
            hull = ConvexHull(pts)
            verts, faces = compact(pts, [list(s) for s in hull.simplices])
            path = os.path.join(body_dir, f"{body}_{variant}_hull.obj")
            write_obj(path, verts, faces, f"{body}_{variant}_hull")
            rows.append([body, variant, "hull", len(verts), len(faces), os.path.relpath(path, objects_dir)])

            # минимальный многогранник
            m = minimal_polyhedron(pts)
            verts, faces = polys_to_faces(m["polygons"])
            path = os.path.join(body_dir, f"{body}_{variant}_min.obj")
            write_obj(path, verts, faces, f"{body}_{variant}_min")
            rows.append([body, variant, "min", len(verts), len(faces), os.path.relpath(path, objects_dir)])

    csv_path = os.path.join(objects_dir, "manifest.csv")
    with open(csv_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["body", "variant", "kind", "vertices", "faces", "file"])
        w.writerows(rows)

    print(f"экспортировано {len(rows)} файлов в {objects_dir}")
    print(f"манифест: {csv_path}")
    return rows


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="out3D")
    ap.add_argument("--objects", default=None)
    args = ap.parse_args()
    export(args.out, args.objects)
