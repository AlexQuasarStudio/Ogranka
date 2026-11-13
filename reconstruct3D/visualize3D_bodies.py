"""Визуализация восстановленных 3D-тел: PNG-кадры, вращающиеся GIF и монтажи.

Стили:
  report — белый фон, светло-серые грани, чёрные рёбра (как в отчёте);
  deck   — тёмный фон, бирюзовые рёбра (для презентации).
"""
import argparse
import csv
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
from scipy.spatial import ConvexHull
import imageio

VARIANTS = ["r0", "r8", "r80", "fft_r8", "fft_r80", "uni_r8", "uni_r80"]
LABELS = {
    "r0": "эталон (r0)",
    "r8": "шум r8",
    "r80": "шум r80",
    "fft_r8": "Фурье + МНК, r8",
    "fft_r80": "Фурье + МНК, r80",
    "uni_r8": "соседи, r8",
    "uni_r80": "соседи, r80",
}

STYLES = {
    "report": dict(
        bg="white", face="#D9D9D9", edge="black", lw=0.35,
        grid="0.85", label="black", pane=(1, 1, 1),
    ),
    "deck": dict(
        bg="#101820", face="#1E3347", edge="#4FC3F7", lw=0.45,
        grid="#2E3A48", label="#9AA5B1", pane=(0.06, 0.09, 0.14),
    ),
}


def load_points(path):
    return np.loadtxt(path)


def draw(ax, pts, style):
    st = STYLES[style]
    hull = ConvexHull(pts)
    faces = [pts[s] for s in hull.simplices]
    coll = Poly3DCollection(faces, facecolor=st["face"], edgecolor=st["edge"],
                            linewidths=st["lw"], alpha=1.0)
    ax.add_collection3d(coll)
    return hull


def setup_axes(ax, limits, style):
    st = STYLES[style]
    (x0, x1), (y0, y1), (z0, z1) = limits
    ax.set_xlim(x0, x1); ax.set_ylim(y0, y1); ax.set_zlim(z0, z1)
    ax.set_box_aspect((x1 - x0, y1 - y0, z1 - z0))
    ax.set_facecolor(st["bg"])
    ax.tick_params(colors=st["label"], labelsize=7)
    for axis in (ax.xaxis, ax.yaxis, ax.zaxis):
        axis.pane.set_facecolor((1, 1, 1, 0))
        axis.pane.set_edgecolor(st["grid"])
        axis._axinfo["grid"]["color"] = st["grid"]
        axis._axinfo["grid"]["linewidth"] = 0.4
    ax.set_xlabel("X", color=st["label"], fontsize=8)
    ax.set_ylabel("Y", color=st["label"], fontsize=8)
    ax.set_zlabel("Z", color=st["label"], fontsize=8)


def limits_for(pts, margin=0.12):
    lo = pts.min(axis=0); hi = pts.max(axis=0)
    span = hi - lo
    pad = span.max() * margin
    return [(lo[i] - pad, hi[i] + pad) for i in range(3)]


def render_png(points, out, style="report", azim=35, elev=20, size=4.2, dpi=110):
    st = STYLES[style]
    fig = plt.figure(figsize=(size, size), facecolor=st["bg"])
    ax = fig.add_subplot(111, projection="3d")
    setup_axes(ax, limits_for(points), style)
    draw(ax, points, style)
    ax.view_init(elev=elev, azim=azim)
    fig.savefig(out, facecolor=st["bg"], bbox_inches="tight", pad_inches=0.05, dpi=dpi)
    plt.close(fig)
    print("saved", out)


def render_gif(points, out, style="report", frames=30, elev=20, size=4.2, dpi=80, fps=12):
    st = STYLES[style]
    lims = limits_for(points)
    fig = plt.figure(figsize=(size, size), facecolor=st["bg"])
    ax = fig.add_subplot(111, projection="3d")
    setup_axes(ax, lims, style)
    draw(ax, points, style)
    with imageio.get_writer(out, mode="I", fps=fps) as writer:
        for i, angle in enumerate(np.linspace(0, 360, frames, endpoint=False)):
            ax.view_init(elev=elev, azim=angle)
            fig.canvas.draw()
            w, h = fig.canvas.get_width_height()
            buf = np.frombuffer(fig.canvas.buffer_rgba(), dtype=np.uint8)
            writer.append_data(buf.reshape(h, w, 4)[..., :3])
    plt.close(fig)
    print("saved", out)


def read_metrics(path):
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        return {(r["body"], r["variant"]): r for r in csv.DictReader(f)}


def render_montage(body, title, out, metrics, style="report"):
    """2x4: семь вариантов + панель с метриками."""
    st = STYLES[style]
    panels = VARIANTS + ["info"]
    fig = plt.figure(figsize=(11.0, 5.6), facecolor=st["bg"])
    ref = load_points(f"out3D/points_r0_{body}.txt")
    lims = limits_for(ref, margin=0.18)
    for i, v in enumerate(panels):
        ax = fig.add_subplot(2, 4, i + 1, projection="3d")
        if v == "info":
            ax.set_axis_off()
            ax.set_facecolor(st["bg"])
            text = title
            m = metrics.get((body, "r8"))
            if m:
                text += (f"\nMSE r8 = {float(m['mse']):.4f}"
                         f"\ndmax r8 = {float(m['dmax']):.4f}")
            m = metrics.get((body, "r80"))
            if m:
                text += (f"\nMSE r80 = {float(m['mse']):.4f}"
                         f"\ndmax r80 = {float(m['dmax']):.4f}")
            ax.text2D(0.02, 0.5, text, transform=ax.transAxes,
                      fontsize=9, color=st["label"], va="center")
            continue
        pts = load_points(f"out3D/points_{v}_{body}.txt")
        setup_axes(ax, lims, style)
        draw(ax, pts, style)
        ax.view_init(elev=20, azim=35)
        ax.set_title(LABELS[v], fontsize=8, color=st["label"], pad=0)
    fig.tight_layout(pad=0.4)
    fig.savefig(out, facecolor=st["bg"], bbox_inches="tight", pad_inches=0.06, dpi=170)
    plt.close(fig)
    print("saved", out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="out3D")
    ap.add_argument("--bodies", nargs="*", default=["octa", "icosa", "dodeca"])
    ap.add_argument("--frames", type=int, default=30)
    ap.add_argument("--gif", action="store_true")
    ap.add_argument("--deck", action="store_true")
    ap.add_argument("--montage", action="store_true")
    args = ap.parse_args()

    metrics = read_metrics(os.path.join(args.out, "metrics.csv"))
    titles = {"octa": "Октаэдр", "icosa": "Икосаэдр", "dodeca": "Додекаэдр", "diamond": "Бриллиант"}

    for body in args.bodies:
        for v in VARIANTS:
            pts = load_points(os.path.join(args.out, f"points_{v}_{body}.txt"))
            render_png(pts, os.path.join(args.out, f"body3D_{body}_{v}.png"))
            if args.gif:
                render_gif(pts, os.path.join(args.out, f"body3D_{body}_{v}.gif"),
                           frames=args.frames)
            if args.deck:
                render_png(pts, os.path.join(args.out, f"deck_{body}_{v}.png"),
                           style="deck")
        if args.montage:
            render_montage(body, titles[body],
                           os.path.join(args.out, f"montage_{body}.png"), metrics)
            render_montage(body, titles[body],
                           os.path.join(args.out, f"deck_montage_{body}.png"), metrics,
                           style="deck")


if __name__ == "__main__":
    main()
