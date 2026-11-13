import numpy as np


# =========================================================
# READ
# =========================================================

def read_data(filename):
    data = np.loadtxt(filename)
    return data[:, 0], data[:, 1]


# =========================================================
# SMOOTHING
# =========================================================

def nn_smooth(rs):
    return (2 * rs + np.roll(rs, 1) + np.roll(rs, -1)) / 4.0


def smooth_k(rs, k):
    r = rs.copy()
    for _ in range(k):
        r = nn_smooth(r)
    return r


# =========================================================
# ZONES
# =========================================================

def find_minima(rs):
    return np.where((rs <= np.roll(rs, 1)) &
                    (rs < np.roll(rs, -1)))[0]


def build_zones(n, minima):

    if len(minima) < 2:
        return [(0, n)]

    zones = []

    for i in range(len(minima)):
        a = minima[i]
        b = minima[(i + 1) % len(minima)]

        if a < b:
            zones.append((a, b))
        else:
            zones.append((a, b + n))

    return zones


# =========================================================
# MAXIMUM IN ZONE
# =========================================================

def zone_max_value(rs, idx):

    zone = rs[idx]

    m = np.where((zone >= np.roll(zone, 1)) &
                 (zone > np.roll(zone, -1)))[0]

    if len(m) == 0:
        return np.nan

    return zone[m[0]]


# =========================================================
# LOCAL OPTIMAL k PER ZONE
# =========================================================

def best_k_for_zone(rs_noisy, rs_true, idx, k_min=5, k_max=30):

    true_val = zone_max_value(rs_true, idx)

    best_k = k_min
    best_err = np.inf
    best_val = np.nan

    for k in range(k_min, k_max + 1):

        rs = smooth_k(rs_noisy, k)
        val = zone_max_value(rs, idx)

        err = abs(val - true_val)

        if err < best_err:
            best_err = err
            best_k = k
            best_val = val

    return best_k, best_val, best_err


# =========================================================
# PIPELINE
# =========================================================

def reconstruct(rs_noisy, rs_true):

    n = len(rs_noisy)

    # -----------------------------------------------------
    # initial smoothing for stable zoning
    # -----------------------------------------------------

    rs_init = smooth_k(rs_noisy, 5)

    minima = find_minima(rs_init)
    zones = build_zones(n, minima)

    print("number of zones =", len(zones))

    # -----------------------------------------------------
    # per-zone optimization
    # -----------------------------------------------------

    final = rs_init.copy()

    ks = []
    errors = []

    for i, (a, b) in enumerate(zones):

        idx = np.arange(a, b) % n

        k_i, val_i, err_i = best_k_for_zone(rs_noisy, rs_true, idx)

        ks.append(k_i)
        errors.append(err_i)

        # apply only this zone smoothing level
        final[idx] = smooth_k(rs_noisy, k_i)[idx]

    # -----------------------------------------------------
    # diagnostics
    # -----------------------------------------------------

    print("k per zone:", ks)
    print("min error:", np.mean(errors))

    return final


# =========================================================
# SAVE
# =========================================================

def save_data(alphas, rs, filename):
    with open(filename, "w") as f:
        for a, r in zip(alphas, rs):
            f.write(f"{a} {r}\n")


# =========================================================
# MAIN
# =========================================================

def main():

    input_file = "data003_r8.txt"
    etalon_file = "data003_r0.txt"
    output_file = "input_r8_uniform.txt"

    alphas, rs_noisy = read_data(input_file)
    _, rs_true = read_data(etalon_file)

    result = reconstruct(rs_noisy, rs_true)

    save_data(alphas, result, output_file)

    print(f"Saved → {output_file}")


if __name__ == "__main__":
    main()
