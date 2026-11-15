import math
import os
import tempfile
import unittest

import numpy as np

from core import pipeline
from live import clear_live, live_variant
from sources import quality, scan_folder


CUBE = np.array(
    [[x, y, z] for z in (0.0, 3.0) for x in (-1.0, 1.0) for y in (-1.0, 1.0)],
    float,
)


class PipelineSmokeTest(unittest.TestCase):
    def test_parse_obj_triangulates_quad(self):
        text = "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n"
        verts, faces = pipeline.parse_obj(text)
        self.assertEqual(verts.shape, (4, 3))
        self.assertEqual(faces, [[0, 1, 2], [0, 2, 3]])

    def test_sections_have_expected_shape(self):
        verts, faces = pipeline.hull(CUBE)
        alphas, layers = pipeline.build_sections(
            verts, pipeline.mesh_edges(faces), n_layers=4, n_angles=90
        )
        self.assertEqual(len(alphas), 90)
        self.assertEqual(len(layers), 4)
        for z, radii in layers:
            self.assertTrue(0 < z < 3)
            self.assertEqual(radii.shape, (90,))

    def test_fourier_recovers_known_curve(self):
        alphas = np.linspace(0, 2 * math.pi, 360, endpoint=False)
        truth = 2.0 + 0.3 * np.cos(3 * alphas)
        design, pinv = pipeline.fourier_design(alphas, 5)
        recovered = pipeline.fourier_denoise_matrix(truth, design, pinv)
        self.assertLess(float(np.max(np.abs(recovered - truth))), 1e-9)

    def test_triangulate_concave_polygon(self):
        poly = np.array(
            [[0, 0, 0], [2, 0, 0], [2, 2, 0], [1, 1, 0], [0, 2, 0]], float
        )
        tris = pipeline.triangulate_polygon(poly)
        self.assertEqual(len(tris), 3)
        area = 0.0
        for tri in tris:
            a, b, c = tri
            area += 0.5 * float(np.linalg.norm(np.cross(b - a, c - a)))
        self.assertAlmostEqual(area, 3.0, places=9)

    def test_merge_coplanar_does_not_merge_bent_quad(self):
        points = np.array(
            [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 1.0, 0.0], [0.0, 1.0, 0.01]]
        )
        polys = pipeline.merge_coplanar(points, [[0, 1, 2], [0, 2, 3]], angle_tol_deg=10.0)
        self.assertEqual(len(polys), 2)

    def test_minimal_polyhedron_contains_cube(self):
        verts, faces = pipeline.hull(CUBE)
        hull_verts, hull_faces = pipeline.hull_compact(verts)
        result = pipeline.minimal_polyhedron(
            hull_verts, hull=(hull_verts, hull_faces), pct=100, snap=False
        )
        self.assertGreaterEqual(result["vertices"], 4)
        self.assertGreaterEqual(result["faces"], 4)
        self.assertEqual(result["engine"], "fast")

    def test_metrics_are_zero_for_matching_circle(self):
        alphas = np.linspace(0, 2 * math.pi, 90, endpoint=False)
        truth = np.ones_like(alphas)
        pts = np.column_stack([np.cos(alphas), np.sin(alphas), np.ones_like(alphas)])
        metrics = pipeline.metrics({1.0: truth}, alphas, pts)
        self.assertLess(float(metrics["rmse"]), 1e-3)
        self.assertLess(float(metrics["dmax"]), 1e-3)

    def test_mesh_edges_supports_polygon_faces(self):
        self.assertEqual(
            pipeline.mesh_edges([[0, 1, 2, 3]]),
            [(0, 1), (0, 3), (1, 2), (2, 3)],
        )

    def test_mesh_metrics_uses_actual_geometry(self):
        verts, faces = pipeline.hull(CUBE)
        alphas, layers = pipeline.build_sections(
            verts, pipeline.mesh_edges(faces), n_layers=4, n_angles=90
        )
        truth = {round(z, 6): r for z, r in layers}
        exact = pipeline.mesh_metrics(truth, alphas, verts, faces)
        self.assertLess(float(exact["rmse"]), 1e-9)
        inner = verts.copy()
        inner[:, :2] *= 0.5
        shrunk = pipeline.mesh_metrics(truth, alphas, inner, faces)
        self.assertGreater(float(shrunk["rmse"]), 0.1)

    def test_live_metrics_follow_simplified_geometry(self):
        source = {"kind": "demo", "name": "diamond"}
        params = {
            "noise": 0.008,
            "method": "fft",
            "harmonics": 32,
            "window": 5,
            "layers": 12,
            "angles": 90,
            "mode": "envelope",
            "angle": 1.0,
            "loss": 0.001,
        }
        clear_live()
        full = live_variant(source, {**params, "pct": 100})
        simplified = live_variant(source, {**params, "pct": 15})
        self.assertNotEqual(full["faces"], simplified["faces"])
        self.assertNotEqual(full["metrics"], simplified["metrics"])

    def test_scan_folder_finds_nested_models_only(self):
        with tempfile.TemporaryDirectory() as root:
            nested = os.path.join(root, "nested")
            os.makedirs(nested)
            for name, text in (
                ("a.obj", "v 0 0 0\n"),
                ("notes.md", "not a model\n"),
                (".hidden.obj", "v 0 0 0\n"),
                (os.path.join("nested", "points.TXT"), "0 0 0\n"),
            ):
                path = os.path.join(root, name)
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(text)
            found = scan_folder(root)
            names = [item["name"].replace(os.sep, "/") for item in found]
            self.assertEqual(names, ["a.obj", "nested/points.TXT"])
            self.assertTrue(all(item["kind"] == "file" for item in found))
            self.assertTrue(all(os.path.isabs(item["path"]) for item in found))

    def test_edge_noise_zero_matches_support(self):
        alphas = np.linspace(0, 2 * np.pi, 120, endpoint=False)
        poly = np.array([[1, 1], [-1, 1], [-1, -1], [1, -1]], float)
        exact = pipeline.support(poly, alphas)
        zero = pipeline.edge_noise_support(poly, alphas, 0.0, np.zeros(4))
        self.assertLess(float(np.max(np.abs(exact - zero))), 1e-12)

    def test_edge_noise_changes_support_structurally(self):
        alphas = np.linspace(0, 2 * np.pi, 120, endpoint=False)
        poly = np.array([[1, 1], [-1, 1], [-1, -1], [1, -1]], float)
        exact = pipeline.support(poly, alphas)
        noisy = pipeline.edge_noise_support(poly, alphas, 0.08, np.array([1.0, -1.0, 1.0, -1.0]))
        self.assertTrue(np.isfinite(noisy).all())
        self.assertGreater(float(np.max(np.abs(noisy - exact))), 1e-3)
        self.assertEqual(noisy.shape, alphas.shape)

    def test_quality_uses_both_average_and_worst_error(self):
        self.assertEqual(quality({"mse": 1e-4, "rmse": 0.01, "dmax": 0.10}), "good")
        self.assertEqual(quality({"mse": 1e-4, "rmse": 0.01, "dmax": 0.20}), "medium")
        self.assertEqual(quality({"mse": 0.01, "rmse": 0.10, "dmax": 0.20}), "medium")
        self.assertEqual(quality({"mse": 0.01, "rmse": 0.10, "dmax": 0.40}), "bad")
        self.assertEqual(quality({"mse": 0.02, "rmse": 0.14, "dmax": 0.10}), "bad")

    def test_resample_contour_uses_section_step(self):
        poly = np.array([[1, 1], [-1, 1], [-1, -1], [1, -1]], float)
        pts, normals, idx = pipeline.resample_contour(poly, 0.5)
        self.assertEqual(len(pts), 16)
        self.assertEqual(normals.shape, (16, 2))
        self.assertTrue(np.allclose(np.linalg.norm(normals, axis=1), 1.0))
        self.assertEqual(int(idx.min()), 0)
        self.assertEqual(int(idx.max()), 3)

    def test_normal_noise_stays_within_amplitude(self):
        poly = np.array([[1, 1], [-1, 1], [-1, -1], [1, -1]], float)
        pts, _, _ = pipeline.resample_contour(poly, 0.5)
        unit = np.ones(len(pts))
        noisy = pipeline.normal_noise_contour(poly, 0.5, 0.01, unit)
        dist = np.linalg.norm(noisy - pts, axis=1)
        self.assertTrue(np.allclose(dist, 0.01))

    def test_fourier_smooth_ring_is_periodic_and_removes_high_frequency(self):
        theta = np.linspace(0.0, 2.0 * math.pi, 64, endpoint=False)
        exact = np.column_stack([np.cos(theta), np.sin(theta)])
        noisy = exact.copy()
        noisy[:, 0] += 0.05 * np.cos(17.0 * theta)
        smoothed = pipeline.fourier_smooth_ring(noisy, harmonics=4)
        self.assertEqual(smoothed.shape, noisy.shape)
        self.assertTrue(np.isfinite(smoothed).all())
        self.assertLess(
            float(np.max(np.linalg.norm(smoothed - exact, axis=1))),
            float(np.max(np.linalg.norm(noisy - exact, axis=1))) * 0.1,
        )

    def test_fourier_smooth_contours_keeps_layers_and_point_order(self):
        theta = np.linspace(0.0, 2.0 * math.pi, 32, endpoint=False)
        ring = np.column_stack([np.cos(theta), np.sin(theta)])
        contours = [(0.0, ring), (1.5, ring.copy())]
        smoothed = pipeline.fourier_smooth_contours(contours, harmonics=5)
        self.assertEqual([z for z, _ in smoothed], [0.0, 1.5])
        self.assertEqual([len(p) for _, p in smoothed], [32, 32])

    def test_loft_contours_is_closed(self):
        ring = np.array([[1, 1], [-1, 1], [-1, -1], [1, -1]], float)
        contours = [(0.0, ring), (1.0, ring)]
        verts, faces = pipeline.loft_contours(contours, ring_points=8)
        self.assertGreater(len(verts), 0)
        uses = {}
        for face in faces:
            for i in range(len(face)):
                a, b = face[i], face[(i + 1) % len(face)]
                key = (min(a, b), max(a, b))
                uses[key] = uses.get(key, 0) + 1
        self.assertTrue(uses)
        self.assertTrue(all(n == 2 for n in uses.values()))

    def test_live_zero_noise_is_exact_for_any_method(self):
        source = {"kind": "demo", "name": "octa"}
        params = {
            "noise": 0.0,
            "method": "fft",
            "harmonics": 32,
            "window": 5,
            "layers": 12,
            "angles": 90,
            "mode": "envelope",
            "angle": 1.0,
            "loss": 0.001,
            "pct": 100,
        }
        clear_live()
        fft = live_variant(source, params)
        clear_live()
        exact = live_variant(source, {**params, "method": "none"})
        self.assertEqual(fft["mesh"], exact["mesh"])
        self.assertLess(float(fft["metrics"]["rmse"]), 1e-9)

    def test_live_normal_noise_returns_smoothed_loft(self):
        source = {"kind": "demo", "name": "octa"}
        params = {
            "noise": 0.008,
            "method": "none",
            "noise_model": "normal",
            "harmonics": 32,
            "window": 5,
            "layers": 12,
            "angles": 90,
            "mode": "envelope",
            "angle": 1.0,
            "loss": 0.001,
            "pct": 100,
        }
        clear_live()
        loft = live_variant(source, params)
        self.assertEqual(loft["method"], "none")
        self.assertIn("лофт, Фурье", loft["label"])
        self.assertGreater(len(loft["mesh"]["f"]), 100)
        self.assertTrue(np.isfinite(loft["metrics"]["rmse"]))
        clear_live()
        smoothed = live_variant(source, {**params, "method": "fft"})
        self.assertNotEqual(len(loft["mesh"]["f"]), len(smoothed["mesh"]["f"]))


if __name__ == "__main__":
    unittest.main()
