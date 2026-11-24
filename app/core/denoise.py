"""Шум и сглаживание опорной функции."""
from __future__ import annotations

import math

import numpy as np

__all__ = [
    "add_noise",
    "fourier_denoise",
    "fourier_design",
    "fourier_denoise_matrix",
    "moving_average",
    "moving_average_bank",
    "uniform_denoise_adaptive",
    "uniform_denoise_adaptive_matrix",
    "maxima_points",
    "maxima_points_array",
    "envelope",
    "envelope_points",
    "envelope_points_array",
]


def add_noise(rs, rv, rng):
    return rs + rv * rng.uniform(-1.0, 1.0, size=rs.shape)


def _fourier_columns(alphas, m):
    alphas = np.asarray(alphas, float)
    cols = [np.ones_like(alphas)]
    for k in range(1, m + 1):
        cols.append(np.cos(k * alphas))
        cols.append(np.sin(k * alphas))
    return np.column_stack(cols)


def fourier_denoise(alphas, rs, m=12):
    """Least-squares fit of a truncated Fourier series with ``m`` harmonics."""
    design = _fourier_columns(alphas, m)
    coef, *_ = np.linalg.lstsq(design, rs, rcond=None)
    return design @ coef


def fourier_design(alphas, m=12):
    """Design matrix of the Fourier fit and its pseudo-inverse."""
    design = _fourier_columns(alphas, m)
    return design, np.linalg.pinv(design)


def fourier_denoise_matrix(R, A, pinv):
    """Fit every row of ``R`` at once: ``R → A (A⁺ R)``."""
    return (np.asarray(R) @ pinv.T) @ A.T


def moving_average(rs, k):
    """Periodic moving average with half-width ``k`` (window ``2k + 1``)."""
    k = max(1, int(k))
    if k == 1:
        return rs.copy()
    kernel = np.ones(2 * k + 1) / (2 * k + 1)
    padded = np.concatenate([rs[-k:], rs, rs[:k]])
    return np.convolve(padded, kernel, mode="valid")


def moving_average_bank(rs, ks):
    """Periodic moving averages of one row for several half-widths at once.

    Uses one cumulative sum, so the cost does not depend on the window size.
    Rows of the result follow ``ks``; ``k <= 1`` keeps the row unchanged, as
    :func:`moving_average` does.
    """
    rs = np.asarray(rs, float)
    n = len(rs)
    ks = [max(1, int(k)) for k in ks]
    kmax = max(ks)
    reps = -(-kmax // n) if n else 0
    tiled = np.concatenate([rs] * (2 * reps + 1)) if reps else rs
    start = reps * n
    csum = np.concatenate(([0.0], np.cumsum(tiled)))
    idx = np.arange(n) + start
    out = np.empty((len(ks), n))
    for row, k in enumerate(ks):
        if k == 1:
            out[row] = rs
        else:
            out[row] = (csum[idx + k + 1] - csum[idx - k]) / (2 * k + 1)
    return out


def _minima(rs):
    """Indices of strict periodic local minima (ascending)."""
    rs = np.asarray(rs, float)
    return np.flatnonzero((np.roll(rs, 1) > rs) & (np.roll(rs, -1) > rs))


def uniform_denoise_adaptive(rs_noisy, rs_true, k_min=5, k_max=30):
    """Подбор k по зонам между минимумами, как в разделе 4 отчёта.

    Zones run from one local minimum of the noisy row to the next, including
    the zone that wraps around the end of the period.  In every zone the
    window ``k`` with the smallest mean squared error against the reference
    is chosen (ties go to the smaller ``k``).  A shared minimum takes the
    value of the zone that starts at it.
    """
    rs = np.asarray(rs_noisy, float)
    true = np.asarray(rs_true, float)
    n = len(rs)
    mins = _minima(rs)
    if len(mins) < 2:
        return moving_average(rs, k_min)
    ks = list(range(k_min, k_max + 1))
    bank = moving_average_bank(rs, ks)
    err = np.cumsum(np.concatenate((np.zeros((len(ks), 1)), (bank - true) ** 2), axis=1), axis=1)

    starts = mins
    ends = np.roll(mins, -1)
    wraps = ends < starts
    sums = np.where(
        wraps,
        (err[:, n:n + 1] - err[:, starts]) + err[:, ends + 1],
        err[:, ends + 1] - err[:, starts],
    )
    counts = np.where(wraps, n - starts + ends + 1, ends - starts + 1)
    best = np.argmin(sums / counts, axis=0)

    # Точка принадлежит зоне, которая начинается в ближайшем минимуме слева;
    # до первого минимума (и в нём самом) действует зона, проходящая через
    # конец периода: она обрабатывается последней и перекрывает общий край.
    zone = np.searchsorted(mins, np.arange(n), side="right") - 1
    zone[zone < 0] = len(mins) - 1
    zone[mins[0]] = len(mins) - 1
    return bank[best[zone], np.arange(n)]


def uniform_denoise_adaptive_matrix(R, R_true, k_min=5, k_max=30):
    """Row-wise :func:`uniform_denoise_adaptive` for a whole layer matrix."""
    R = np.asarray(R, float)
    R_true = np.asarray(R_true, float)
    return np.vstack([
        uniform_denoise_adaptive(R[i], R_true[i], k_min, k_max) for i in range(len(R))
    ]) if len(R) else R.copy()


_TRIG: dict = {}


def _trig(alphas):
    """``cos``/``sin`` of the angle grid (``math`` precision, cached)."""
    alphas = np.asarray(alphas, float)
    key = alphas.tobytes()
    cached = _TRIG.get(key)
    if cached is None:
        values = alphas.tolist()
        cached = (
            np.array([math.cos(a) for a in values]),
            np.array([math.sin(a) for a in values]),
        )
        if len(_TRIG) > 16:
            _TRIG.clear()
        _TRIG[key] = cached
    return cached


def maxima_points_array(alphas, rs, z):
    """Points at local maxima of the support function as an ``(N, 3)`` array."""
    rs = np.asarray(rs, float)
    d1 = rs - np.roll(rs, 1)
    d2 = np.roll(rs, -1) - rs
    hit = (d1 >= 0) & (d2 < 0)
    cos, sin = _trig(alphas)
    r = rs[hit]
    return np.column_stack((r * cos[hit], r * sin[hit], np.full(len(r), float(z))))


def maxima_points(alphas, rs, z):
    return maxima_points_array(alphas, rs, z).tolist()


def envelope(alphas, rs, tol=1e-9):
    """Vertices of the polygon ``∩ {x·e(α) ≤ r(α)}`` (neighbouring lines meet)."""
    rs = np.asarray(rs, float)
    alphas = np.asarray(alphas, float)
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


def envelope_points_array(alphas, rs, z):
    """Envelope vertices lifted to height ``z``; empty when fewer than three."""
    P = envelope(alphas, rs)
    if len(P) < 3:
        return np.zeros((0, 3))
    return np.column_stack((P, np.full(len(P), float(z))))


def envelope_points(alphas, rs, z):
    return envelope_points_array(alphas, rs, z).tolist()
