"""Полный прогон 3D-эксперимента по трём телам.

Шаги для каждого тела:
  1. восстановление эталона из точных сечений (r0);
  2. восстановление зашумлённых моделей r8 и r80;
  3. подавление шума методами fft и uniform, восстановление сглаженных;
  4. сравнение каждого варианта с эталоном по опорной функции.

Результат: out3D/points_<вариант>_<тело>.txt и out3D/metrics.csv
"""
import argparse
import csv
import os
import sys

import numpy as np

import generate3D_bodies as gen
import denoise3D_layers as den
import reconstruct3D_layers as rec
import compare3D_layers as cmp
from bodies3D import BODIES

VARIANTS = ["r0", "r8", "r80", "fft_r8", "fft_r80", "uni_r8", "uni_r80"]
HARMONICS = 12


def paths(out_dir, body, tag):
    return os.path.join(out_dir, f"data3D_{body}_{tag}.txt")


def build_all(data_dir="data3D", out_dir="out3D"):
    os.makedirs(out_dir, exist_ok=True)

    metrics = []
    for body, info in BODIES.items():
        print(f"\n=== {info['title']} ===")

        # 1-2. восстановление эталона и зашумлённых
        recon = {}
        for tag in ("r0", "r8", "r80"):
            pts = rec.reconstruct(paths(data_dir, body, tag))
            recon[tag] = pts
            rec.save_points(pts, os.path.join(out_dir, f"points_{tag}_{body}.txt"))
            print(f"  {tag:9s}: {len(pts):4d} точек")

        # 3. сглаживание и восстановление
        for method, prefix in (("fft", "fft"), ("uniform", "uni")):
            for tag in ("r8", "r80"):
                src = paths(data_dir, body, tag)
                dst = os.path.join(out_dir, f"denoised_{method}_{body}_{tag}.txt")
                layers_noisy = den.read_layers(src)
                true = {z: r for z, _, r in den.read_layers(paths(data_dir, body, "r0"))}
                alphas_out, rs_out, zs_out = [], [], []
                for z, a, r in layers_noisy:
                    if method == "fft":
                        rs = den.fourier_denoise(a, r, HARMONICS)
                    else:
                        rs, _, _ = den.uniform_denoise(r, true[z])
                    alphas_out.append(a)
                    rs_out.append(rs)
                    zs_out.append(np.full_like(a, z))
                den.save_layers(dst,
                                np.concatenate(alphas_out),
                                np.concatenate(zs_out),
                                np.concatenate(rs_out))

                pts = rec.reconstruct(dst)
                name = f"{prefix}_{tag}"
                recon[name] = pts
                rec.save_points(pts, os.path.join(out_dir, f"points_{name}_{body}.txt"))
                print(f"  {name:9s}: {len(pts):4d} точек")

        # 4. метрики
        for v in VARIANTS:
            res = cmp.compare(recon["r0"], recon[v])
            metrics.append({
                "body": body,
                "title": info["title"],
                "variant": v,
                "mse": res["mse"],
                "rmse": res["rmse"],
                "dmax": res["dmax"],
                "point_mean": res["point_mean"],
                "point_max": res["point_max"],
                "layers": res["layers"],
                "n_points": len(recon[v]),
            })

    csv_path = os.path.join(out_dir, "metrics.csv")
    with open(csv_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(metrics[0].keys()))
        writer.writeheader()
        writer.writerows(metrics)
    print(f"\nsaved {csv_path}")

    print("\n{:<10s} {:<9s} {:>12s} {:>12s} {:>12s}".format(
        "тело", "вариант", "MSE", "RMSE", "d_max"))
    for m in metrics:
        print("{:<10s} {:<9s} {:12.6f} {:12.6f} {:12.6f}".format(
            m["title"], m["variant"], m["mse"], m["rmse"], m["dmax"]))
    return metrics


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data3D")
    ap.add_argument("--out", default="out3D")
    ap.add_argument("--regenerate", action="store_true")
    args = ap.parse_args()

    if args.regenerate or not os.path.isdir(args.data):
        gen.generate(args.data)

    build_all(args.data, args.out)
