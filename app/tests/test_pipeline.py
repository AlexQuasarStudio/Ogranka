import math
import unittest

import numpy as np

from core import pipeline


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


if __name__ == "__main__":
    unittest.main()
