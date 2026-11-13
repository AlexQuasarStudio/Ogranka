"""Подавление шума в 3D-данных: сглаживание каждого слоя отдельно.

Методы:
  fft      — ряд Фурье + МНК (denoise.py / denoise3D.py), m гармоник;
  uniform  — метод "ближайших соседей" с зональным подбором k_i
             (denoise_uniform.py), нижний порог k = 5.

Сглаживание выполняется ПОСЛОЙНО: r(alpha) задана в плоскости z = z_k,
поэтому коэффициенты Фурье и число итераций подбираются для каждого слоя.
"""
import argparse
import os
import numpy as np

from bodies3D import read_polar_3d, layer_indices

K_MIN, K_MAX = 5, 30


# =========================================================
# READ / WRITE
# =========================================================

def read_layers(path):
    alphas, rs, zs = read_polar_3d(path)
    layers = []
    for z, idx in layer_indices(zs):
        order = np.argsort(alphas[idx])
        idx = idx[order]
        layers.append((z, alphas[idx], rs[idx]))
    return layers


def save_layers(path, alphas, zs, rs):
    with open(path, "w") as f:
        for a, r, z in zip(alphas, rs, zs):
            f.write(f"{a:.8f} {r:.8f} {z:.8f}\n")


# =========================================================
# FOURIER + LEAST SQUARES
# =========================================================

def fourier_denoise(alphas, rs, harmonics=12):
    n = len(alphas)
    A = [np.ones(n)]
    for k in range(1, harmonics + 1):
        A.append(np.cos(k * alphas))
        A.append(np.sin(k * alphas))
    A = np.column_stack(A)
    coeffs, _, _, _ = np.linalg.lstsq(A, rs, rcond=None)
    return A @ coeffs


# =========================================================
# NEAREST NEIGHBOURS (ZONAL)
# =========================================================

def nn_smooth(rs):
    return (2.0 * rs + np.roll(rs, 1) + np.roll(rs, -1)) / 4.0


def smooth_k(rs, k):
    r = rs.copy()
    for _ in range(k):
        r = nn_smooth(r)
    return r


def find_minima(rs):
    return np.where((rs <= np.roll(rs, 1)) & (rs < np.roll(rs, -1)))[0]


def build_zones(n, minima):
    if len(minima) < 2:
        return [(0, n)]
    zones = []
    for i in range(len(minima)):
        a = minima[i]
        b = minima[(i + 1) % len(minima)]
        zones.append((a, b) if a < b else (a, b + n))
    return zones


def zone_max_value(rs, idx):
    zone = rs[idx]
    m = np.where((zone >= np.roll(zone, 1)) & (zone > np.roll(zone, -1)))[0]
    if len(m) == 0:
        return np.nan
    return zone[m[0]]


def best_k_for_zone(rs_noisy, rs_true, idx, k_min=K_MIN, k_max=K_MAX):
    true_val = zone_max_value(rs_true, idx)
    best_k, best_err = k_min, np.inf
    for k in range(k_min, k_max + 1):
        err = abs(zone_max_value(smooth_k(rs_noisy, k), idx) - true_val)
        if err < best_err:
            best_err, best_k = err, k
    return best_k, best_err


def uniform_denoise(rs_noisy, rs_true):
    n = len(rs_noisy)
    rs_init = smooth_k(rs_noisy, K_MIN)
    zones = build_zones(n, find_minima(rs_init))
    final = rs_init.copy()
    ks, errors = [], []
    for a, b in zones:
        idx = np.arange(a, b) % n
        k_i, err_i = best_k_for_zone(rs_noisy, rs_true, idx)
        ks.append(k_i)
        errors.append(err_i)
        final[idx] = smooth_k(rs_noisy, k_i)[idx]
    return final, ks, float(np.mean(errors))


# =========================================================
# MAIN
# =========================================================

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--etalon", required=True)
    ap.add_argument("--method", choices=["fft", "uniform"], default="fft")
    ap.add_argument("--harmonics", type=int, default=12)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    noisy = read_layers(args.input)
    true = {z: r for z, _, r in read_layers(args.etalon)}

    alphas_out, rs_out, zs_out = [], [], []
    all_k = []
    for z, a, r in noisy:
        if args.method == "fft":
            rs = fourier_denoise(a, r, args.harmonics)
        else:
            rs, ks, _ = uniform_denoise(r, true[z])
            all_k.extend(ks)
        alphas_out.append(a)
        rs_out.append(rs)
        zs_out.append(np.full_like(a, z))

    save_layers(args.output,
                np.concatenate(alphas_out),
                np.concatenate(zs_out),
                np.concatenate(rs_out))
    print(f"saved {args.output}")
    if all_k:
        print(f"k_i: min={min(all_k)} max={max(all_k)} mean={np.mean(all_k):.2f}")


if __name__ == "__main__":
    main()
