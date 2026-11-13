"""Коллаж: шесть синтетических тел × шесть уровней упрощения."""
import os
import sys
import csv

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "app")))

import app as A
from core import pipeline
from visualize3D_bodies import STYLES, limits_for
from visualize_minimal3D import draw_polys

BODIES = ["octa", "icosa", "dodeca", "diamond", "cube", "prism"]
TITLES = {
    "octa": "Октаэдр", "icosa": "Икосаэдр", "dodeca": "Додекаэдр",
    "diamond": "Бриллиант", "cube": "Куб", "prism": "Призма",
}
LEVELS = list(pipeline.SIMPLIFY_LEVELS)


def build_data():
    data = {}
    rows = []
    for body in BODIES:
        v = pipeline.normalize_mesh(A.demo_body(body), flip=False)
        hv, hf = pipeline.hull(v)
        lims = limits_for(hv, margin=0.15)
        data[body] = {"hull": (hv, hf), "lims": lims, "levels": []}
        for pct in LEVELS:
            m = pipeline.minimal_polyhedron(hv, hull=(hv, hf), pct=pct, snap=False)
            data[body]["levels"].append((m["polygons"], m["vertices"], m["faces"]))
            rows.append((body, pct, m["vertices"], m["faces"]))
    return data, rows


def render(data, style, out):
    st = STYLES[style]
    bg = "white" if style == "report" else "#101820"
    fg = "black" if style == "report" else "#F2F2F2"
    muted = "#555555" if style == "report" else "#9AA5B1"
    fig = plt.figure(figsize=(14.4, 14.4), facecolor=bg)
    for ri, body in enumerate(BODIES):
        lims = data[body]["lims"]
        (x0, x1), (y0, y1), (z0, z1) = lims
        for ci, (polys, nv, nf) in enumerate(data[body]["levels"]):
            ax = fig.add_subplot(len(BODIES), len(LEVELS), ri * len(LEVELS) + ci + 1,
                                 projection="3d")
            ax.set_facecolor(bg)
            ax.set_xlim(x0, x1); ax.set_ylim(y0, y1); ax.set_zlim(z0, z1)
            ax.set_box_aspect((x1 - x0, y1 - y0, z1 - z0))
            ax.set_axis_off()
            draw_polys(ax, polys, style)
            ax.view_init(elev=20, azim=35)
            if ri == 0:
                ax.set_title(f"{LEVELS[ci]}%", fontsize=11, color=fg, pad=2)
            if ci == 0:
                ax.text2D(-0.10, 0.5, TITLES[body], transform=ax.transAxes,
                          rotation=90, va="center", ha="right", fontsize=11, color=fg)
            ax.text2D(0.5, -0.02, f"{nv}/{nf}", transform=ax.transAxes,
                      ha="center", va="top", fontsize=8, color=muted)
    fig.subplots_adjust(left=0.055, right=0.995, top=0.965, bottom=0.02,
                        wspace=0.02, hspace=0.02)
    fig.savefig(out, facecolor=bg, bbox_inches="tight", pad_inches=0.06, dpi=150)
    plt.close(fig)
    print("saved", out)


def main():
    data, rows = build_data()
    root = os.path.abspath(os.path.join(HERE, ".."))
    render(data, "report", os.path.join(root, "Отчет", "fig_levels.png"))
    render(data, "deck", os.path.join(root, "img", "deck_levels.png"))
    path = os.path.join(HERE, "out3D", "levels_counts.csv")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["body", "pct", "vertices", "faces"])
        w.writerows(rows)
    print("saved", path)


if __name__ == "__main__":
    main()
