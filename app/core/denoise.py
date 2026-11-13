"""Шум и сглаживание опорной функции."""
import math

import numpy as np

__all__ = [
    "add_noise",
    "fourier_denoise",
    "fourier_design",
    "fourier_denoise_matrix",
    "moving_average",
    "uniform_denoise_adaptive",
    "maxima_points",
    "envelope",
    "envelope_points",
]


def add_noise(rs, rv, rng):
    return rs + rv * rng.uniform(-1.0, 1.0, size=rs.shape)


def fourier_denoise(alphas, rs, m=12):
    cols = [np.ones_like(alphas)]
    for k in range(1, m + 1):
        cols.append(np.cos(k * alphas))
        cols.append(np.sin(k * alphas))
    A = np.column_stack(cols)
    coef, *_ = np.linalg.lstsq(A, rs, rcond=None)
    return A @ coef


def fourier_design(alphas, m=12):
    cols = [np.ones_like(alphas)]
    for k in range(1, m + 1):
        cols.append(np.cos(k * alphas))
        cols.append(np.sin(k * alphas))
    A = np.column_stack(cols)
    return A, np.linalg.pinv(A)


def fourier_denoise_matrix(R, A, pinv):
    return (np.asarray(R) @ pinv.T) @ A.T


def moving_average(rs, k):
    k = max(1, int(k))
    if k == 1:
        return rs.copy()
    kernel = np.ones(2 * k + 1) / (2 * k + 1)
    padded = np.concatenate([rs[-k:], rs, rs[:k]])
    return np.convolve(padded, kernel, mode="valid")


def _minima(rs):
    n = len(rs)
    return [i for i in range(n) if rs[i - 1] > rs[i] and rs[(i + 1) % n] > rs[i]]


def uniform_denoise_adaptive(rs_noisy, rs_true, k_min=5, k_max=30):
    """Подбор k по зонам между минимумами, как в разделе 4 отчёта."""
    rs = np.asarray(rs_noisy, float)
    true = np.asarray(rs_true, float)
    n = len(rs)
    mins = _minima(rs)
    if len(mins) < 2:
        return moving_average(rs, k_min)
    out = rs.copy()
    for a, b in zip(mins, mins[1:]):
        idx = list(range(a, b + 1)) if b > a else list(range(a, n)) + list(range(0, b + 1))
        best_k, best_err = k_min, None
        for k in range(k_min, k_max + 1):
            sm = moving_average(rs, k)
            err = float(np.mean((sm[idx] - true[idx]) ** 2))
            if best_err is None or err < best_err:
                best_err, best_k = err, k
        out[idx] = moving_average(rs, best_k)[idx]
    return out


def maxima_points(alphas, rs, z):
    out = []
    n = len(rs)
    for i in range(n):
        d1 = rs[i] - rs[i - 1]
        d2 = rs[(i + 1) % n] - rs[i]
        if d1 >= 0 and d2 < 0:
            out.append([rs[i] * math.cos(alphas[i]), rs[i] * math.sin(alphas[i]), z])
    return out


def envelope(alphas, rs, tol=1e-9):
    A = np.column_stack([np.cos(alphas), np.sin(alphas)])
    A2 = np.roll(A, -1, axis=0)
    b2 = np.roll(rs, -1)
    det = A[:, 0] * A2[:, 1] - A[:, 1] * A2[:, 0]
    ok = np.abs(det) > 1e-12
    safe = np.where(ok, det, 1.0)
    x = (rs * A2[:, 1] - A[:, 1] * b2) / safe
    y = (A[:, 0] * b2 - rs * A2[:, 0]) / safe
    P = np.column_stack([x, y])[ok]
    if len(P) == 0:
        return P
    vals = P @ A.T
    return P[np.all(vals <= rs[None, :] + tol, axis=1)]


def envelope_points(alphas, rs, z):
    P = envelope(alphas, rs)
    if len(P) < 3:
        return []
    return [[p[0], p[1], z] for p in P]
