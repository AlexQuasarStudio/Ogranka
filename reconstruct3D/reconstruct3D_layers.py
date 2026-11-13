"""Восстановление вершин сечений: локальные максимумы опорной функции.

Вершина в слое z_k — точка i, для которой
    d1 = r_i - r_{i-1} >= 0,  d2 = r_{i+1} - r_i < 0.
Каждый слой обрабатывается отдельно (замыкание по кругу внутри слоя).
"""
import argparse
import numpy as np

from bodies3D import read_polar_3d, layer_indices


def find_maxima(alphas, rs):
    points = []
    n = len(rs)
    for i in range(n):
        d1 = rs[i] - rs[i - 1]
        d2 = rs[(i + 1) % n] - rs[i]
        if d1 >= 0 and d2 < 0:
            points.append((alphas[i], rs[i]))
    return np.array(points)


def reconstruct(path):
    alphas, rs, zs = read_polar_3d(path)
    out = []
    for z, idx in layer_indices(zs):
        order = np.argsort(alphas[idx])
        idx = idx[order]
        maxima = find_maxima(alphas[idx], rs[idx])
        if len(maxima) == 0:
            continue
        x = maxima[:, 1] * np.cos(maxima[:, 0])
        y = maxima[:, 1] * np.sin(maxima[:, 0])
        layer = np.column_stack([x, y, np.full(len(x), z)])
        out.append(layer)
    return np.vstack(out) if out else np.zeros((0, 3))


def save_points(points, filename):
    with open(filename, "w") as f:
        for p in points:
            f.write(f"{p[0]:.8f} {p[1]:.8f} {p[2]:.8f}\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    pts = reconstruct(args.input)
    save_points(pts, args.output)
    print(f"{args.input} -> {args.output}: {len(pts)} точек")


if __name__ == "__main__":
    main()
