import numpy as np

def read_data(filename):
    alphas = []
    rs = []

    with open(filename, 'r') as f:
        for line in f:
            line = line.strip()

            if not line or line.startswith('#'):
                continue

            parts = line.split()

            if len(parts) == 2:
                try:
                    alphas.append(float(parts[0]))
                    rs.append(float(parts[1]))
                except:
                    continue

    return np.array(alphas), np.array(rs)

def fourier_denoise(alphas, rs, harmonics=8):
    n = len(alphas)

    A = [np.ones(n)]

    for k in range(1, harmonics + 1):
        A.append(np.cos(k * alphas))
        A.append(np.sin(k * alphas))

    A = np.column_stack(A)

    coeffs, _, _, _ = np.linalg.lstsq(A, rs, rcond=None)

    rs_smooth = A @ coeffs

    return rs_smooth

def save_data(alphas, rs, filename):
    with open(filename, 'w') as f:
        for a, r in zip(alphas, rs):
            f.write(f"{a} {r}\n")

def main():
    alphas, rs = read_data("data003_r80.txt")

    rs_smooth = fourier_denoise(alphas, rs, harmonics=8)

    save_data(alphas, rs_smooth, "input_r80.txt")

if __name__ == "__main__":
    main()
