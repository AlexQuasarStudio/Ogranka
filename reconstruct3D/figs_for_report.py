"""Сводные рисунки для отчёта: эталон, шум, два метода сглаживания.

В отличие от монтажа на одно тело (visualize3D_bodies.py), здесь
сравниваются три тела в одном состоянии — это компактнее для текста.
"""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from visualize3D_bodies import draw, setup_axes, load_points, limits_for, LABELS
from bodies3D import BODIES

TITLES = {k: v["title"] for k, v in BODIES.items()}
BODIES_ORDER = ["octa", "icosa", "dodeca", "diamond"]


def grid(rows, out, style="report", panel=3.0, dpi=170):
    """rows — список списков (body, variant)."""
    st_style = style
    nrow, ncol = len(rows), len(rows[0])
    fig = plt.figure(figsize=(panel * ncol, panel * nrow), facecolor="white" if style == "report" else "#101820")
    for ri, row in enumerate(rows):
        for ci, (body, variant) in enumerate(row):
            ax = fig.add_subplot(nrow, ncol, ri * ncol + ci + 1, projection="3d")
            ref = load_points(f"out3D/points_r0_{body}.txt")
            setup_axes(ax, limits_for(ref, margin=0.2), style)
            draw(ax, load_points(f"out3D/points_{variant}_{body}.txt"), style)
            ax.view_init(elev=20, azim=35)
            ax.set_title(f"{TITLES[body]} · {LABELS[variant]}", fontsize=9,
                         color="black" if style == "report" else "#F2F2F2", pad=2)
    fig.tight_layout(pad=0.6)
    fig.savefig(out, bbox_inches="tight", pad_inches=0.05, dpi=dpi,
                facecolor=fig.get_facecolor())
    plt.close(fig)
    print("saved", out)


def main():
    os.makedirs("out3D", exist_ok=True)
    grid([[ (b, "r0") for b in BODIES_ORDER ]], "out3D/fig3d_ref.png")
    grid([[ (b, "r8") for b in BODIES_ORDER ],
          [ (b, "r80") for b in BODIES_ORDER ]], "out3D/fig3d_noisy.png")
    grid([[ (b, "fft_r8") for b in BODIES_ORDER ],
          [ (b, "fft_r80") for b in BODIES_ORDER ]], "out3D/fig3d_fft.png")
    grid([[ (b, "uni_r8") for b in BODIES_ORDER ],
          [ (b, "uni_r80") for b in BODIES_ORDER ]], "out3D/fig3d_uni.png")


if __name__ == "__main__":
    main()
