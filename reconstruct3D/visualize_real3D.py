"""Визуализация реальных моделей: точная, эталонная и восстановленные.

Рисуются многоугольные грани минимального многогранника (auto-режим),
для точной модели — исходные грани OBJ.
"""
import argparse
import glob
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
import imageio

from real3D import load_obj, normalize_mesh
from minimal3D import minimal_polyhedron
from visualize3D_bodies import STYLES, setup_axes, limits_for

VARIANTS = ["r0", "r8", "r80", "fft_r8", "fft_r80", "uni_r8", "uni_r80"]
LABELS = {"r0": "точные сечения", "r8": "шум r8", "r80": "шум r80",
          "fft_r8": "Фурье r8", "fft_r80": "Фурье r80",
          "uni_r8": "соседи r8", "uni_r80": "соседи r80"}


def true_polys(path):
    v, faces = load_obj(path)
    v = normalize_mesh(v)
    return v, [v[f] for f in faces]


def draw_polys(ax, polys, style):
    st = STYLES[style]
    ax.add_collection3d(Poly3DCollection(polys, facecolor=st["face"],
                                         edgecolor=st["edge"], linewidths=st["lw"]))


def render_png(polys, lims, out, style="report", azim=35, elev=20, size=4.2, dpi=110):
    st = STYLES[style]
    fig = plt.figure(figsize=(size, size), facecolor=st["bg"])
    ax = fig.add_subplot(111, projection="3d")
    setup_axes(ax, lims, style)
    draw_polys(ax, polys, style)
    ax.view_init(elev=elev, azim=azim)
    fig.savefig(out, facecolor=st["bg"], bbox_inches="tight", pad_inches=0.05, dpi=dpi)
    plt.close(fig)
    print("saved", out)


def render_gif(polys, lims, out, style="report", frames=30, elev=20, size=4.2, dpi=80, fps=12):
    st = STYLES[style]
    fig = plt.figure(figsize=(size, size), facecolor=st["bg"])
    ax = fig.add_subplot(111, projection="3d")
    setup_axes(ax, lims, style)
    draw_polys(ax, polys, style)
    with imageio.get_writer(out, mode="I", fps=fps) as writer:
        for angle in np.linspace(0, 360, frames, endpoint=False):
            ax.view_init(elev=elev, azim=angle)
            fig.canvas.draw()
            w, h = fig.canvas.get_width_height()
            buf = np.frombuffer(fig.canvas.buffer_rgba(), dtype=np.uint8)
            writer.append_data(buf.reshape(h, w, 4)[..., :3])
    plt.close(fig)
    print("saved", out)


def grid(rows, out, style="report", panel=3.0, dpi=170):
    nrow, ncol = len(rows), len(rows[0])
    bg = "white" if style == "report" else "#101820"
    fg = "black" if style == "report" else "#F2F2F2"
    fig = plt.figure(figsize=(panel * ncol, panel * nrow), facecolor=bg)
    for ri, row in enumerate(rows):
        for ci, (polys, title, lims) in enumerate(row):
            ax = fig.add_subplot(nrow, ncol, ri * ncol + ci + 1, projection="3d")
            setup_axes(ax, lims, style)
            draw_polys(ax, polys, style)
            ax.view_init(elev=20, azim=35)
            ax.set_title(title, fontsize=9, color=fg, pad=2)
    fig.tight_layout(pad=0.6)
    fig.savefig(out, bbox_inches="tight", pad_inches=0.05, dpi=dpi, facecolor=bg)
    plt.close(fig)
    print("saved", out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="out3D_real")
    ap.add_argument("--data", default="real_data/Attachments_v-dinsky@yandex.ru_2026-09-30_18-39-11")
    ap.add_argument("--gif", action="store_true")
    ap.add_argument("--deck", action="store_true")
    ap.add_argument("--figs", action="store_true")
    args = ap.parse_args()

    files = sorted(glob.glob(os.path.join(args.data, "*.obj")))
    if not files:
        print(f"нет OBJ в {args.data}")
        return
    models = [(f"real{i}", f"Образец {i}") for i in range(1, len(files) + 1)]
    file_of = dict(zip([name for name, _ in models], files))

    truth = {}
    lims = {}
    for name, title in models:
        path = file_of[name]
        v, polys = true_polys(path)
        truth[name] = polys
        lims[name] = limits_for(v, margin=0.12)
        render_png(polys, lims[name], os.path.join(args.out, f"true_{name}.png"))
        if args.deck:
            render_png(polys, lims[name], os.path.join(args.out, f"deck_true_{name}.png"), style="deck")

    cache = {}
    for name, title in models:
        for variant in VARIANTS:
            pts_path = os.path.join(args.out, f"points_envelope_{variant}_{name}.txt")
            if not os.path.exists(pts_path):
                print("нет", pts_path)
                continue
            pts = np.loadtxt(pts_path)
            if len(pts) < 4:
                continue
            try:
                m = minimal_polyhedron(pts)
            except Exception as exc:
                print(f"{name} {variant}: пропуск ({type(exc).__name__})")
                continue
            cache[(name, variant)] = m["polygons"]
            base = os.path.join(args.out, f"real_{name}_{variant}_min.png")
            render_png(m["polygons"], lims[name], base)
            if args.gif:
                render_gif(m["polygons"], lims[name],
                           os.path.join(args.out, f"real_{name}_{variant}_min.gif"))
            if args.deck:
                render_png(m["polygons"], lims[name],
                           os.path.join(args.out, f"deck_real_{name}_{variant}.png"), style="deck")
        print(name, "done")

    if args.figs:
        grid([[(truth[n], f"{t} · сканер", lims[n]) for n, t in models]],
             os.path.join(args.out, "fig_real_true.png"))
        grid([[(cache[(n, "r0")], f"{t} · точные сечения", lims[n]) for n, t in models]],
             os.path.join(args.out, "fig_real_r0.png"))
        grid([[(cache[(n, v)], f"{t} · {LABELS[v]}", lims[n]) for n, t in models]
              for v in ("fft_r8", "fft_r80")], os.path.join(args.out, "fig_real_fft.png"))
        grid([[(cache[(n, v)], f"{t} · {LABELS[v]}", lims[n]) for n, t in models]
              for v in ("uni_r8", "uni_r80")], os.path.join(args.out, "fig_real_uni.png"))


if __name__ == "__main__":
    main()
