"""Метрики вариантов восстановления относительно аналитического эталона.

Эталон — не восстановленная модель r0, а точная опорная функция сечений
R(alpha, z), вычисленная из исходного многогранника. Это исключает
из сравнения собственную погрешность дискретизации восстановления.

Для каждого слоя и каждого угла сетки:
    eps = R_hat(alpha) - R(alpha)
    MSE  = mean eps^2,  RMSE = sqrt(MSE),  d_max = max |eps|
"""
import argparse
import csv
import os
import numpy as np

from bodies3D import BODIES, prepare_body, body_edges, generate_sections, read_polar_3d, layer_indices
from compare3D_layers import read_points, split_layers, support

N_ANGLES = 720


def analytic_layers(body, n_angles=N_ANGLES, dz=0.05, height=3.0):
    v = prepare_body(body, height)
    alphas, layers = generate_sections(v, body_edges(v), np.arange(dz / 2, height, dz), n_angles)
    return {round(float(z), 8): r for z, r in layers}, alphas


def metrics(true_by_z, alphas, pts):
    layers = split_layers(pts)
    errs = []
    for z in sorted(set(true_by_z) & set(layers)):
        errs.append(support(layers[z], alphas) - true_by_z[z])
    errs = np.concatenate(errs)
    mse = float(np.mean(errs ** 2))
    return {
        "mse": mse,
        "rmse": float(np.sqrt(mse)),
        "dmax": float(np.max(np.abs(errs))),
        "bias": float(np.mean(errs)),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="out3D")
    args = ap.parse_args()

    rows = []
    for body, info in BODIES.items():
        true_by_z, alphas = analytic_layers(body)
        for v in ("r0", "r8", "r80", "fft_r8", "fft_r80", "uni_r8", "uni_r80"):
            pts = read_points(os.path.join(args.out, f"points_{v}_{body}.txt"))
            m = metrics(true_by_z, alphas, pts)
            m.update({"body": body, "title": info["title"], "variant": v,
                      "n_points": len(pts)})
            rows.append(m)

    path = os.path.join(args.out, "metrics_analytic.csv")
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print("saved", path)

    print("\n{:<10s} {:<9s} {:>12s} {:>12s} {:>12s}".format("тело", "вариант", "MSE", "RMSE", "d_max"))
    for r in rows:
        print("{:<10s} {:<9s} {:12.6f} {:12.6f} {:12.6f}".format(
            r["title"], r["variant"], r["mse"], r["rmse"], r["dmax"]))


if __name__ == "__main__":
    main()
