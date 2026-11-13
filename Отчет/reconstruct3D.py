import numpy as np

def read_polar(filename):
    alphas = []
    rs = []
    zs = []

    with open(filename, 'r') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue

            parts = line.split()
            if len(parts) == 3:
                try:
                    alphas.append(float(parts[0]))
                    rs.append(float(parts[1]))
                    zs.append(float(parts[2]))
                except:
                    continue

    return np.array(alphas), np.array(rs), np.array(zs)


def find_maxima(alphas, rs, zs):
    points = []
    for i in range(2, len(rs)):
        d1 = rs[i] - rs[i - 1]
        d2 = rs[(i + 1) % len(rs)] - rs[i]

        if d1 >= 0 and d2 < 0:
            points.append((alphas[i], rs[i], zs[i]))

    return np.array(points)


def polar_to_cartesian(polar_points):
    x = polar_points[:, 1] * np.cos(polar_points[:, 0])
    y = polar_points[:, 1] * np.sin(polar_points[:, 0])
    z = polar_points[:, 2]
    return np.column_stack((x, y, z))


def save_points(points, filename):
    with open(filename, 'w') as f:
        for p in points:
            f.write(f"{p[0]} {p[1]} {p[2]}\n")


def main():
    alphas, rs, zs = read_polar("input3D_r80.txt")
    maxima = find_maxima(alphas, rs, zs)

    if len(maxima) == 0:
        return

    points = polar_to_cartesian(maxima)

    points = np.array([
        p for p in points
        if not (abs(p[0]) < 1e-16 and abs(p[1]) < 1e-16)
    ])

    if len(points) > 0:
        points = np.vstack([points, points[0]])

    save_points(points, "output3D_r80.txt")


if __name__ == "__main__":
    main()
