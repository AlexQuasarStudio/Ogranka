"""Сравнение восстановленного тела с эталоном по слоям.

Для каждого слоя z_k строится опорная функция восстановленного
многоугольника R_hat(alpha) и сравнивается с эталонной R(alpha) на той же
сетке углов. Это устойчиво к разному числу вершин в слоях.

    eps_i   = |R_hat(alpha_i) - R(alpha_i)|
    MSE     = mean eps_i^2
    RMSE    = sqrt(MSE)
    d_max   = max eps_i
"""
import argparse
import numpy as np

from bodies3D import read_polar_3d


def read_points(path):
    return np.loadtxt(path)


def split_layers(points):
    zs = np.round(points[:, 2], 8)
    layers = {}
    for z in np.unique(zs):
        layers[z] = points[zs == z][:, :2]
    return layers


def support(poly, alphas):
    e = np.column_stack([np.cos(alphas), np.sin(alphas)])
    return (e @ poly.T).max(axis=1)


def compare(true_pts, test_pts, n_angles=720):
    alphas = np.arange(n_angles) * (2.0 * np.pi / n_angles)
    t_layers = split_layers(true_pts)
    e_layers = split_layers(test_pts)
    zs = sorted(set(t_layers) & set(e_layers))
    if not zs:
        raise ValueError("нет общих слоёв")

    errs = []
    for z in zs:
        r_true = support(t_layers[z], alphas)
        r_est = support(e_layers[z], alphas)
        errs.append(r_est - r_true)

    errs = np.concatenate(errs)
    mse = float(np.mean(errs ** 2))
    rmse = float(np.sqrt(mse))
    dmax = float(np.max(np.abs(errs)))

    # ошибки только по вершинам (поточечно, ближайший сосед в эталоне)
    d_point = []
    for z in zs:
        a = t_layers[z]
        b = e_layers[z]
        d = np.sqrt(((b[:, None, :] - a[None, :, :]) ** 2).sum(axis=2))
        d_point.append(d.min(axis=1))
    d_point = np.concatenate(d_point)

    return {
        "mse": mse,
        "rmse": rmse,
        "dmax": dmax,
        "point_mean": float(np.mean(d_point)),
        "point_max": float(np.max(d_point)),
        "layers": len(zs),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--true", required=True)
    ap.add_argument("--test", required=True)
    args = ap.parse_args()

    true_pts = read_points(args.true)
    test_pts = read_points(args.test)
    res = compare(true_pts, test_pts)

    print(f"layers = {res['layers']}")
    print(f"MSE    = {res['mse']:.10f}")
    print(f"RMSE   = {res['rmse']:.10f}")
    print(f"d_max  = {res['dmax']:.10f}")
    print(f"point mean = {res['point_mean']:.10f}")
    print(f"point max  = {res['point_max']:.10f}")


if __name__ == "__main__":
    main()
