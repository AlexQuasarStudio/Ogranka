import numpy as np

def read_points(filename):
    points = []

    with open(filename, 'r') as f:
        for line in f:
            parts = line.split()

            if len(parts) != 2:
                continue

            try:
                x = float(parts[0])
                y = float(parts[1])
                points.append([x, y])
            except:
                continue

    return np.array(points)

def compare_points(true_pts, test_pts):
    n = min(len(true_pts), len(test_pts))

    true_pts = true_pts[:n]
    test_pts = test_pts[:n]

    diff = true_pts - test_pts

    dist = np.linalg.norm(diff, axis=1)

    mse = np.mean(dist**2)

    max_err = np.max(dist)

    return mse, max_err

def main():
    true_pts = read_points("output_r8_uniform.txt")

    test_pts = read_points("output.txt")

    mse, max_err = compare_points(true_pts, test_pts)

    print(f"MSE = {mse}")
    print(f"MAX = {max_err}")

if __name__ == "__main__":
    main()
