import numpy as np

def read_polar(filename):
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
                    a = float(parts[0])
                    r = float(parts[1])
                    alphas.append(a)
                    rs.append(r)
                except:
                    continue
    return np.array(alphas), np.array(rs)

def polar_to_cartesian(alphas, rs):
    x = rs * np.cos(alphas)
    y = rs * np.sin(alphas)
    return np.column_stack((x, y))

def save_points(points, filename):
    with open(filename, 'w') as f:
        for p in points:
            f.write(f"{p[0]} {p[1]}\n")

def main():
    alphas, rs = read_polar("denoised.txt")
    points = polar_to_cartesian(alphas, rs)

    points = np.array([p for p in points if not (abs(p[0]) < 1e-12 and abs(p[1]) < 1e-12)])

    if len(points) > 0:
        points = np.vstack([points, points[0]])

    save_points(points, "input.txt")

if __name__ == "__main__":
    main()
