"""Генерация горизонтальных точечных сечений выпуклых тел.

Для каждого слоя z_k строится сечение тела плоскостью z = z_k,
вычисляется опорная функция R(alpha_i) = max_k p_i^(k) и сохраняется
тройка (alpha_i, R(alpha_i), z_k). Шум добавляется к каждому значению R.

Файлы: data3D_<тело>_r0.txt, _r8.txt, _r80.txt
"""
import os
import argparse
import numpy as np

from bodies3D import BODIES, prepare_body, body_edges, generate_sections, add_noise, save_polar_3d

N_ANGLES = 720          # шаг по углу h = 2*pi/720 = 0.5 градуса
DZ = 0.05               # шаг по высоте
HEIGHT = 3.0
NOISE = {"r0": 0.0, "r8": 0.008, "r80": 0.08}
SEED = {"octa": 11, "icosa": 23, "dodeca": 37, "diamond": 41}


def generate(out_dir="data3D"):
    os.makedirs(out_dir, exist_ok=True)
    report = []
    for name in BODIES:
        v = prepare_body(name, HEIGHT)
        edges = body_edges(v)
        zs = np.arange(DZ / 2.0, HEIGHT, DZ)
        alphas, layers = generate_sections(v, edges, zs, N_ANGLES)
        rng = np.random.default_rng(SEED[name])
        for tag, rv in NOISE.items():
            noisy = [(z, add_noise(r, rv, rng)) for z, r in layers]
            path = os.path.join(out_dir, f"data3D_{name}_{tag}.txt")
            save_polar_3d(path, alphas, noisy)
            report.append((name, tag, len(noisy), N_ANGLES, rv, path))
    for name, tag, nl, na, rv, path in report:
        print(f"{BODIES[name]['title']:10s} {tag:4s} layers={nl:3d} angles={na:4d} rv={rv:<6g} -> {path}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data3D")
    args = ap.parse_args()
    generate(args.out)
