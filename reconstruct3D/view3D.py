"""Интерактивный просмотр OBJ-моделей без сторонних редакторов.

Примеры:
    python3 view3D.py out3D/obj/icosa/icosa_r80_min.obj
    python3 view3D.py --body icosa              # все варианты оболочки
    python3 view3D.py --body diamond --kind min # минимальные многогранники
    python3 view3D.py --list
    python3 view3D.py --body octa --save octa.png   # без окна

В окне модель вращается мышью, масштабируется колесом.
"""
import argparse
import os
import numpy as np
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

VARIANTS = ["r0", "r8", "r80", "fft_r8", "fft_r80", "uni_r8", "uni_r80"]
BODIES = ["octa", "icosa", "dodeca", "diamond"]
TITLES = {"octa": "Октаэдр", "icosa": "Икосаэдр", "dodeca": "Додекаэдр", "diamond": "Бриллиант"}
STYLE = dict(face="#B9CBD9", edge="#1B2A38", lw=0.45)


def read_obj(path):
    verts, faces = [], []
    with open(path) as f:
        for line in f:
            if line.startswith("v "):
                verts.append([float(x) for x in line.split()[1:4]])
            elif line.startswith("f "):
                faces.append([int(t.split("/")[0]) - 1 for t in line.split()[1:]])
    return np.asarray(verts, float), faces


def limits(vertices, margin=0.08):
    lo, hi = vertices.min(axis=0), vertices.max(axis=0)
    c = (lo + hi) / 2.0
    r = (hi - lo).max() / 2.0 * (1.0 + margin)
    return [(c[i] - r, c[i] + r) for i in range(3)]


def draw(ax, verts, faces, lims, title):
    polys = [verts[f] for f in faces]
    ax.add_collection3d(Poly3DCollection(polys, facecolor=STYLE["face"],
                                         edgecolor=STYLE["edge"], linewidths=STYLE["lw"]))
    for i, axis in enumerate((ax.set_xlim, ax.set_ylim, ax.set_zlim)):
        axis(*lims[i])
    ax.set_box_aspect((1, 1, 1))
    ax.set_xlabel("X", fontsize=8)
    ax.set_ylabel("Y", fontsize=8)
    ax.set_zlabel("Z", fontsize=8)
    ax.tick_params(labelsize=7)
    ax.set_title(title, fontsize=10)
    ax.view_init(elev=20, azim=35)


def show_list(obj_dir):
    print("Доступные тела:", ", ".join(BODIES))
    for body in BODIES:
        d = os.path.join(obj_dir, body)
        files = sorted(f for f in os.listdir(d) if f.endswith(".obj"))
        print(f"  {body:8s}: {len(files)} файлов")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path", nargs="?")
    ap.add_argument("--body", choices=BODIES)
    ap.add_argument("--kind", choices=["hull", "min", "true"], default="hull")
    ap.add_argument("--obj-dir", default="out3D/obj" if os.path.isdir("out3D/obj") else "obj")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--save")
    args = ap.parse_args()

    if args.list:
        show_list(args.obj_dir)
        return

    if args.path:
        verts, faces = read_obj(args.path)
        fig = plt.figure(figsize=(7, 7))
        ax = fig.add_subplot(111, projection="3d")
        draw(ax, verts, faces, limits(verts), os.path.basename(args.path))
        print(f"{args.path}: {len(verts)} вершин, {len(faces)} граней")
    elif args.body:
        files = []
        for v in VARIANTS:
            p = os.path.join(args.obj_dir, args.body, f"{args.body}_{v}_{args.kind}.obj")
            if os.path.exists(p):
                files.append((v, p))
        if not files:
            raise SystemExit(f"нет файлов для {args.body} / {args.kind}")
        loaded = [(v, *read_obj(p)) for v, p in files]
        lims = limits(np.vstack([verts for _, verts, _ in loaded]))
        cols = 4
        rows = int(np.ceil(len(loaded) / cols))
        fig = plt.figure(figsize=(4.2 * cols, 4.2 * rows))
        for i, (v, verts, faces) in enumerate(loaded):
            ax = fig.add_subplot(rows, cols, i + 1, projection="3d")
            draw(ax, verts, faces, lims, f"{TITLES[args.body]} · {v} · {args.kind}")
        fig.tight_layout()
    else:
        ap.print_help()
        return

    if args.save:
        fig.savefig(args.save, dpi=160, bbox_inches="tight")
        print("saved", args.save)
    else:
        print("Вращайте модель мышью; колесо — масштаб.")
        plt.show()


if __name__ == "__main__":
    main()
