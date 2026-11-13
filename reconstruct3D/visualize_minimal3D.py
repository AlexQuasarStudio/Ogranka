"""Визуализация минимальных многогранников, построенных auto-режимом.

Грани рисуются как многоугольники (после слияния копланарных
треугольников), а не как триангулированная оболочка.
"""
import argparse
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
import imageio

from minimal3D import minimal_polyhedron, VARIANTS, BODIES
from visualize3D_bodies import STYLES, setup_axes, limits_for, LABELS

TITLES = {"octa": "Октаэдр", "icosa": "Икосаэдр", "dodeca": "Додекаэдр", "diamond": "Бриллиант"}


def draw_polys(ax, polys, style):
    st = STYLES[style]
    coll = Poly3DCollection(polys, facecolor=st["face"], edgecolor=st["edge"],
                            linewidths=st["lw"], alpha=1.0)
    ax.add_collection3d(coll)


def render_png(polys, limits, out, style="report", azim=35, elev=20, size=4.2, dpi=110):
    st = STYLES[style]
    fig = plt.figure(figsize=(size, size), facecolor=st["bg"])
    ax = fig.add_subplot(111, projection="3d")
    setup_axes(ax, limits, style)
    draw_polys(ax, polys, style)
    ax.view_init(elev=elev, azim=azim)
    fig.savefig(out, facecolor=st["bg"], bbox_inches="tight", pad_inches=0.05, dpi=dpi)
    plt.close(fig)
    print("saved", out)


def render_gif(polys, limits, out, style="report", frames=30, elev=20, size=4.2, dpi=80, fps=12):
    st = STYLES[style]
    fig = plt.figure(figsize=(size, size), facecolor=st["bg"])
    ax = fig.add_subplot(111, projection="3d")
    setup_axes(ax, limits, style)
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
        for ci, (body, variant) in enumerate(row):
            ax = fig.add_subplot(nrow, ncol, ri * ncol + ci + 1, projection="3d")
            ref = np.loadtxt(f"out3D/points_r0_{body}.txt")
            setup_axes(ax, limits_for(ref, margin=0.2), style)
            pts = np.loadtxt(f"out3D/points_{variant}_{body}.txt")
            m = minimal_polyhedron(pts)
            draw_polys(ax, m["polygons"], style)
            ax.view_init(elev=20, azim=35)
            ax.set_title(f"{TITLES[body]} · {LABELS[variant]}", fontsize=9, color=fg, pad=2)
    fig.tight_layout(pad=0.6)
    fig.savefig(out, bbox_inches="tight", pad_inches=0.05, dpi=dpi, facecolor=bg)
    plt.close(fig)
    print("saved", out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="out3D")
    ap.add_argument("--gif", action="store_true")
    ap.add_argument("--deck", action="store_true")
    ap.add_argument("--figs", action="store_true")
    ap.add_argument("--bodies", nargs="*", default=BODIES)
    args = ap.parse_args()

    for body in args.bodies:
        ref = np.loadtxt(os.path.join(args.out, f"points_r0_{body}.txt"))
        lims = limits_for(ref, margin=0.12)
        for v in VARIANTS:
            pts = np.loadtxt(os.path.join(args.out, f"points_{v}_{body}.txt"))
            m = minimal_polyhedron(pts)
            base = os.path.join(args.out, f"min3d_{body}_{v}.png")
            render_png(m["polygons"], lims, base)
            if args.gif:
                render_gif(m["polygons"], lims, os.path.join(args.out, f"min3d_{body}_{v}.gif"))
            if args.deck:
                render_png(m["polygons"], lims, os.path.join(args.out, f"deck_min3d_{body}_{v}.png"),
                           style="deck")
        print(f"{body}: done")

    if args.figs:
        grid([[ (b, "r0") for b in BODIES ]], os.path.join(args.out, "fig3dmin_ref.png"))
        grid([[ (b, "r8") for b in BODIES ],
              [ (b, "r80") for b in BODIES ]], os.path.join(args.out, "fig3dmin_noisy.png"))
        grid([[ (b, "fft_r8") for b in BODIES ],
              [ (b, "fft_r80") for b in BODIES ]], os.path.join(args.out, "fig3dmin_fft.png"))
        grid([[ (b, "uni_r8") for b in BODIES ],
              [ (b, "uni_r80") for b in BODIES ]], os.path.join(args.out, "fig3dmin_uni.png"))


if __name__ == "__main__":
    main()
