import numpy as np
import time
from tqdm import tqdm


# =========================================================
# READ
# =========================================================

def read_data(filename):
    data = np.loadtxt(filename)
    return data[:, 0], data[:, 1]


# =========================================================
# MAXIMA
# =========================================================

def find_maxima(alphas, rs):
    prev_r = np.roll(rs, 1)
    next_r = np.roll(rs, -1)
    mask = (rs >= prev_r) & (rs > next_r)
    return alphas[mask]


# =========================================================
# ANGULAR DISTANCE
# =========================================================

def ang_dist(a, b):
    d = np.abs(a - b)
    return np.minimum(d, 2*np.pi - d)


# =========================================================
# ERROR: stable maxima matching
# =========================================================

def maxima_error(true_max, est_max):

    if len(true_max) == 0 or len(est_max) == 0:
        return np.inf

    errs = []

    for a in true_max:
        d = ang_dist(est_max, a)
        errs.append(np.min(d))

    errs = np.array(errs)

    return np.max(errs) + 0.5 * np.std(errs)


# =========================================================
# SYMMETRY MODEL (CORRECT VERSION)
# =========================================================

def symmetry_refine(alphas, rs, m, antisym=False):

    if m <= 1:
        return rs.copy()

    result = np.zeros_like(rs)

    shift = 2*np.pi / m

    for i, a in enumerate(alphas):

        # базовый индекс-эквивалент через все копии
        vals = []

        for k in range(m):

            a_k = (a + k * shift) % (2*np.pi)

            idx = np.argmin(np.abs(alphas - a_k))

            val = rs[idx]

            if antisym and (k % 2 == 1):
                val = -val

            vals.append(val)

        result[i] = np.mean(vals)

    return result


# =========================================================
# FILTERS
# =========================================================

def cyclic_median(rs, r):
    if r == 0:
        return rs.copy()

    n = len(rs)
    out = np.zeros(n)

    for i in range(n):
        idx = np.arange(i-r, i+r+1) % n
        out[i] = np.median(rs[idx])

    return out


def fft_lowpass(rs, keep):
    fft = np.fft.rfft(rs)
    k = max(1, int(len(fft)*keep))

    filt = np.zeros_like(fft)
    filt[:k] = fft[:k]

    return np.fft.irfft(filt, len(rs))


def smooth(rs, iters):
    for _ in range(iters):
        rs = (2*rs + np.roll(rs,1) + np.roll(rs,-1)) / 4
    return rs


# =========================================================
# PIPELINE
# =========================================================

def process(rs, alphas, m, antisym, r, k, it):

    rs = symmetry_refine(alphas, rs, m, antisym)

    rs = cyclic_median(rs, r)

    rs = fft_lowpass(rs, k)

    rs = smooth(rs, it)

    return rs


# =========================================================
# CANDIDATES
# =========================================================

def symmetry_candidates():
    return [2, 3, 4, 5, 6, 8, 10, 12]


# =========================================================
# OPTIMIZATION
# =========================================================

def optimize(alphas_t, rs_t, alphas_n, rs_n):

    true_max = find_maxima(alphas_t, rs_t)

    best_err = np.inf
    best = None
    best_rs = None

    m_list = symmetry_candidates()
    antisym_list = [False, True]

    radius_list = [0, 1, 2]
    fft_list = [0.03, 0.05, 0.08, 0.12]
    smooth_list = [0, 1, 2]

    total = len(m_list)*len(antisym_list)*len(radius_list)*len(fft_list)*len(smooth_list)

    pbar = tqdm(total=total, desc="search")

    start = time.time()

    for m in m_list:
        for anti in antisym_list:
            for r in radius_list:
                for k in fft_list:
                    for it in smooth_list:

                        rs = process(rs_n, alphas_n, m, anti, r, k, it)

                        est_max = find_maxima(alphas_n, rs)

                        err = maxima_error(true_max, est_max)

                        if err < best_err:
                            best_err = err
                            best = (m, anti, r, k, it)
                            best_rs = rs.copy()

                        pbar.update(1)
                        pbar.set_postfix({
                            "m": m,
                            "anti": anti,
                            "err": f"{best_err:.5f}",
                            "t": f"{time.time()-start:.1f}s"
                        })

    pbar.close()

    return best_rs, best, best_err


# =========================================================
# SAVE
# =========================================================

def save(alphas, rs, name):
    np.savetxt(name, np.column_stack((alphas, rs)))


# =========================================================
# MAIN
# =========================================================

def main():

    alphas_n, rs_n = read_data("data003_r80.txt")
    alphas_t, rs_t = read_data("data003_r8.txt")

    rs_best, params, err = optimize(alphas_t, rs_t, alphas_n, rs_n)

    print("\nBEST:")
    print("m =", params[0])
    print("anti =", params[1])
    print("radius =", params[2])
    print("fft =", params[3])
    print("smooth =", params[4])
    print("error =", err)

    save(alphas_n, rs_best, "input_r80.txt")


if __name__ == "__main__":
    main()
