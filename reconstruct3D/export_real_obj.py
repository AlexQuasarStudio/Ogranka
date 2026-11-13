"""Экспорт реальных моделей в OBJ: точная и минимальные (auto-режим).

Вход — каталог с любыми *.obj: файлы берутся в алфавитном порядке и
нумеруются real1, real2, ... так же, как в real_data3D.py.
"""
import argparse
import glob
import os
import numpy as np

from real3D import load_obj, normalize_mesh
from minimal3D import minimal_polyhedron
from export3D_obj import write_obj, compact, polys_to_faces

VARIANTS = ["r0", "r8", "r80", "fft_r8", "fft_r80", "uni_r8", "uni_r80"]


def main(data_dir="real_data/Attachments_v-dinsky@yandex.ru_2026-09-30_18-39-11",
         points_dir="out3D_real", out_dir="out3D_real/obj"):
    os.makedirs(out_dir, exist_ok=True)
    files = sorted(glob.glob(os.path.join(data_dir, "*.obj")))
    if not files:
        print(f"нет OBJ в {data_dir}")
        return
    print("модели:", [os.path.basename(p) for p in files])

    for idx, path in enumerate(files, start=1):
        name = f"real{idx}"
        v, faces = load_obj(path)
        v = normalize_mesh(v)
        verts, fs = compact(v, faces)
        write_obj(os.path.join(out_dir, f"{name}_true.obj"), verts, fs, f"{name}_true")
        print(f"{name}_true.obj: {len(verts)} вершин, {len(fs)} граней")

        for variant in VARIANTS:
            p = os.path.join(points_dir, f"points_envelope_{variant}_{name}.txt")
            if not os.path.exists(p):
                continue
            pts = np.loadtxt(p)
            if len(pts) < 4:
                continue
            try:
                m = minimal_polyhedron(pts)
            except Exception:
                continue
            verts, fs = polys_to_faces(m["polygons"])
            write_obj(os.path.join(out_dir, f"{name}_{variant}_min.obj"), verts, fs,
                      f"{name}_{variant}_min")
            print(f"{name}_{variant}_min.obj: {len(verts)} вершин, {len(fs)} граней")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="real_data/Attachments_v-dinsky@yandex.ru_2026-09-30_18-39-11")
    ap.add_argument("--points", default="out3D_real")
    ap.add_argument("--out", default="out3D_real/obj")
    args = ap.parse_args()
    main(args.data, args.points, args.out)
