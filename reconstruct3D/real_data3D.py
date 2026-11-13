"""Конвейер для реальных OBJ-моделей: два режима восстановления.

  maxima   — исходный метод: вершины = локальные максимумы R(alpha);
  envelope — обобщение: сечение = пересечение полуплоскостей
             x*cos(a) + y*sin(a) <= R(a).

Для реальных огранок с гладкими овальными сечениями режим maxima дает
3-4 точки на слой, поэтому основным выбран envelope. Режим maxima
сохранен для сравнения и для правильных многогранников.

Слои: 60 (шаг 0.05), направления: 720 (шаг 0.5°), высота H = 3.
"""
import argparse
import csv
import glob
import os
import numpy as np

from real3D import load_obj, mesh_edges, normalize_mesh, section_from_edges, support, envelope
from bodies3D import layer_indices, save_polar_3d, read_polar_3d
import denoise3D_layers as den
import reconstruct3D_layers as rec
import metrics_analytic as ma
from minimal3D import minimal_polyhedron

N_ANGLES = 720
DZ = 0.05
HEIGHT = 3.0
NOISE = {"r0": 0.0, "r8": 0.008, "r80": 0.08}
HARMONICS = 32
VARIANTS = ["r0", "r8", "r80", "fft_r8", "fft_r80", "uni_r8", "uni_r80"]
TOL = 1e-6


def load_real(path):
    v, faces = load_obj(path)
    v = normalize_mesh(v)
    return v, mesh_edges(faces)


def true_sections(v, edges, n_angles=N_ANGLES, dz=DZ, height=HEIGHT):
    alphas = np.arange(n_angles) * (2.0 * np.pi / n_angles)
    layers = []
    for z in np.arange(dz / 2.0, height, dz):
        poly = section_from_edges(v, edges, z)
        if poly is None:
            continue
        layers.append((float(z), support(poly, alphas)))
    return alphas, layers


def envelope_reconstruct(path, tol=TOL):
    alphas, rs, zs = read_polar_3d(path)
    out = []
    for z, idx in layer_indices(zs):
        order = np.argsort(alphas[idx])
        idx = idx[order]
        P = envelope(alphas[idx], rs[idx], tol=tol)
        if len(P) < 3:
            continue
        ang = np.arctan2(P[:, 1], P[:, 0])
        P = P[np.argsort(ang)]
        out.append(np.column_stack([P, np.full(len(P), z)]))
    return np.vstack(out) if out else np.zeros((0, 3))


def run(model_paths, out_dir="out3D_real", data_dir="data3D_real", modes=("maxima", "envelope")):
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(data_dir, exist_ok=True)
    rows = []

    for idx, path in enumerate(model_paths, start=1):
        name = f"real{idx}"
        v, edges = load_real(path)
        alphas, layers = true_sections(v, edges)

        rng = np.random.default_rng(100 + idx)
        for tag, rv in NOISE.items():
            noisy = [(z, r + rv * rng.uniform(-1, 1, size=r.shape)) for z, r in layers]
            save_polar_3d(os.path.join(data_dir, f"data3D_{name}_{tag}.txt"), alphas, noisy)

        true_by_z = {round(z, 8): r for z, r in layers}

        # сглаживание
        for method, prefix in (("fft", "fft"), ("uniform", "uni")):
            for tag in ("r8", "r80"):
                src = os.path.join(data_dir, f"data3D_{name}_{tag}.txt")
                dst = os.path.join(out_dir, f"denoised_{method}_{name}_{tag}.txt")
                noisy = den.read_layers(src)
                true = {z: r for z, _, r in den.read_layers(os.path.join(data_dir, f"data3D_{name}_r0.txt"))}
                a_out, r_out, z_out = [], [], []
                for z, a, r in noisy:
                    if method == "fft":
                        rs = den.fourier_denoise(a, r, HARMONICS)
                    else:
                        rs, _, _ = den.uniform_denoise(r, true[z])
                    a_out.append(a)
                    r_out.append(rs)
                    z_out.append(np.full_like(a, z))
                den.save_layers(dst, np.concatenate(a_out), np.concatenate(z_out), np.concatenate(r_out))

        # восстановление
        for mode in modes:
            for variant in VARIANTS:
                if variant.startswith("fft_"):
                    src = os.path.join(out_dir, f"denoised_fft_{name}_{variant[4:]}.txt")
                elif variant.startswith("uni_"):
                    src = os.path.join(out_dir, f"denoised_uniform_{name}_{variant[4:]}.txt")
                else:
                    src = os.path.join(data_dir, f"data3D_{name}_{variant}.txt")

                if mode == "maxima":
                    pts = rec.reconstruct(src)
                else:
                    pts = envelope_reconstruct(src)

                if len(pts) < 4:
                    rows.append({"model": name, "file": os.path.basename(path), "mode": mode,
                                 "variant": variant, "points": len(pts), "mse": None,
                                 "rmse": None, "dmax": None, "min_vertices": 0, "min_faces": 0})
                    print(f"{name} {mode:8s} {variant:8s}: вырождено ({len(pts)} точек)")
                    continue

                rec.save_points(pts, os.path.join(out_dir, f"points_{mode}_{variant}_{name}.txt"))
                try:
                    m = ma.metrics(true_by_z, alphas, pts)
                    mp = minimal_polyhedron(pts)
                    mse, rmse, dmax = m["mse"], m["rmse"], m["dmax"]
                    minv, minf = mp["vertices"], mp["faces"]
                except Exception as exc:
                    print(f"{name} {mode:8s} {variant:8s}: не строится ({type(exc).__name__})")
                    rows.append({"model": name, "file": os.path.basename(path), "mode": mode,
                                 "variant": variant, "points": len(pts), "mse": None,
                                 "rmse": None, "dmax": None, "min_vertices": 0, "min_faces": 0})
                    continue
                rows.append({"model": name, "file": os.path.basename(path), "mode": mode,
                             "variant": variant, "points": len(pts), "mse": mse,
                             "rmse": rmse, "dmax": dmax,
                             "min_vertices": minv, "min_faces": minf})
                print(f"{name} {mode:8s} {variant:8s}: точек={len(pts):6d} "
                      f"MSE={mse:.6f} dmax={dmax:.4f} min={minv}/{minf}")

        # эталонная модель (OBJ) для сравнения
        np.savetxt(os.path.join(out_dir, f"true_{name}.txt"), v, fmt="%.6f")

    csv_path = os.path.join(out_dir, "metrics_real.csv")
    with open(csv_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print("saved", csv_path)
    return rows


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="real_data/Attachments_v-dinsky@yandex.ru_2026-09-30_18-39-11")
    ap.add_argument("--out", default="out3D_real")
    ap.add_argument("--data-out", default="data3D_real")
    args = ap.parse_args()

    paths = sorted(glob.glob(os.path.join(args.data, "*.obj")))
    print("модели:", [os.path.basename(p) for p in paths])
    run(paths, args.out, args.data_out)
