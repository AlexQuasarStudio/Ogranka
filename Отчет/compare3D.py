import numpy as np

def read_points(filename):
    points = []
    with open(filename, 'r') as f:
        for line in f:
            parts = line.split()
            if len(parts) != 3:
                continue
            try:
                x = float(parts[0])
                y = float(parts[1])
                z = float(parts[2])
                points.append([x, y, z])
            except:
                continue
    return np.array(points)


def compare_points(true_pts, test_pts):
    n = min(len(true_pts), len(test_pts))

    if n == 0:
        raise ValueError("Нет точек для сравнения")

    true_pts = true_pts[:n]
    test_pts = test_pts[:n]

    diff = true_pts - test_pts

    # 3D евклидова ошибка по каждой точке
    dist = np.linalg.norm(diff, axis=1)

    mse = np.mean(dist ** 2)
    rmse = np.sqrt(mse)
    max_err = np.max(dist)

    return mse, rmse, max_err


def main():
    true_pts = read_points("output3D_r8.txt")
    test_pts = read_points("output3D_r80.txt")

    mse, rmse, max_err = compare_points(true_pts, test_pts)

    print(f"MSE  = {mse}")
    print(f"RMSE = {rmse}")
    print(f"MAX  = {max_err}")


if __name__ == "__main__":
    main()
