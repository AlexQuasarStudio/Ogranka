"""Регрессионные тесты векторизованного ядра против эталонных циклов."""
import math
import random
import threading
import unittest

import numpy as np

import delta
from core import denoise, geometry, minimal, pipeline
from core.variants import ModelSections
from qhull_compat import ConvexHull
from sources import demo_body


def reference_uniform_adaptive(rs, true, k_min=5, k_max=30):
    """Исходный алгоритм «соседей» с зоной через конец периода."""
    n = len(rs)
    mins = [i for i in range(n) if rs[i - 1] > rs[i] and rs[(i + 1) % n] > rs[i]]
    if len(mins) < 2:
        return denoise.moving_average(rs, k_min)
    out = rs.copy()
    for a, b in zip(mins, mins[1:] + mins[:1]):
        idx = list(range(a, b + 1)) if b > a else list(range(a, n)) + list(range(0, b + 1))
        best_k, best_err = k_min, None
        for k in range(k_min, k_max + 1):
            sm = denoise.moving_average(rs, k)
            err = float(np.mean((sm[idx] - true[idx]) ** 2))
            if best_err is None or err < best_err:
                best_err, best_k = err, k
        out[idx] = denoise.moving_average(rs, best_k)[idx]
    return out


def reference_maxima(alphas, rs, z):
    out = []
    n = len(rs)
    for i in range(n):
        if rs[i] - rs[i - 1] >= 0 and rs[(i + 1) % n] - rs[i] < 0:
            out.append([rs[i] * math.cos(alphas[i]), rs[i] * math.sin(alphas[i]), z])
    return out


def polygon_area(poly):
    p = np.asarray(poly, float)
    n = np.cross(p, np.roll(p, -1, axis=0)).sum(axis=0)
    return 0.5 * float(np.linalg.norm(n))


class DenoiseTest(unittest.TestCase):
    def setUp(self):
        self.alphas = np.arange(720) * (2 * math.pi / 720)
        self.true = 1.5 + 0.2 * np.cos(4 * self.alphas) + 0.05 * np.sin(9 * self.alphas)
        self.noisy = self.true + 0.02 * np.random.default_rng(3).uniform(-1, 1, 720)

    def test_moving_average_bank_matches_convolution(self):
        bank = denoise.moving_average_bank(self.noisy, [1, 2, 5, 30])
        for row, k in zip(bank, [1, 2, 5, 30]):
            self.assertTrue(np.allclose(row, denoise.moving_average(self.noisy, k), atol=1e-12))

    def test_uniform_adaptive_matches_reference(self):
        fast = denoise.uniform_denoise_adaptive(self.noisy, self.true)
        slow = reference_uniform_adaptive(self.noisy, self.true)
        self.assertLess(float(np.max(np.abs(fast - slow))), 1e-12)

    def test_uniform_adaptive_smooths_wrap_zone(self):
        out = denoise.uniform_denoise_adaptive(self.noisy, self.true)
        mins = np.flatnonzero((np.roll(self.noisy, 1) > self.noisy) & (np.roll(self.noisy, -1) > self.noisy))
        tail = np.r_[mins[-1] + 1:720]
        # До исправления хвост после последнего минимума оставался зашумлённым.
        self.assertFalse(np.allclose(out[tail], self.noisy[tail]))
        self.assertLess(
            float(np.mean((out - self.true) ** 2)), float(np.mean((self.noisy - self.true) ** 2))
        )

    def test_uniform_adaptive_matrix_rows(self):
        R = np.vstack([self.noisy, self.noisy[::-1]])
        T = np.vstack([self.true, self.true[::-1]])
        out = denoise.uniform_denoise_adaptive_matrix(R, T)
        self.assertTrue(np.allclose(out[1], denoise.uniform_denoise_adaptive(R[1], T[1])))

    def test_maxima_points_match_reference(self):
        fast = denoise.maxima_points(self.alphas, self.noisy, 1.25)
        self.assertEqual(fast, reference_maxima(self.alphas, self.noisy, 1.25))


class GeometryTest(unittest.TestCase):
    def test_mesh_area_matches_loop(self):
        pts = np.random.default_rng(1).normal(size=(300, 3))
        verts, faces = geometry.hull_compact(pts)
        loop = sum(
            0.5 * np.linalg.norm(np.cross(verts[f[1]] - verts[f[0]], verts[f[2]] - verts[f[0]]))
            for f in faces
        )
        self.assertAlmostEqual(geometry.mesh_area(verts, faces), loop, places=10)

    def test_section_slicer_matches_naive_loop(self):
        v, faces = pipeline.hull(pipeline.normalize_mesh(demo_body("diamond"), flip=False))
        edges = pipeline.mesh_edges(faces)
        z = 1.7
        naive = []
        for i, j in edges:
            if (v[i, 2] - z) * (v[j, 2] - z) < 0:
                t = (z - v[i, 2]) / (v[j, 2] - v[i, 2])
                naive.append((v[i] + t * (v[j] - v[i]))[:2])
        fast = geometry.SectionSlicer(v, edges).points(z)
        self.assertTrue(np.array_equal(np.asarray(naive), fast))

    def test_section_through_vertices_is_complete(self):
        v, faces = pipeline.hull(pipeline.normalize_mesh(demo_body("octa"), flip=False))
        z_equator = float(np.median(v[:, 2]))
        poly = geometry.section_from_edges(v, pipeline.mesh_edges(faces), z_equator)
        # Раньше вершины на плоскости не учитывались и сечение пропадало.
        self.assertIsNotNone(poly)
        self.assertEqual(len(poly), 4)
        alphas = np.arange(360) * (2 * math.pi / 360)
        truth = {round(z_equator, 6): pipeline.support(v[np.abs(v[:, 2] - z_equator) < 1e-9, :2], alphas)}
        self.assertLess(pipeline.mesh_metrics(truth, alphas, v, faces)["dmax"], 1e-12)

    def test_merge_coplanar_cube_and_icosahedron(self):
        for name, faces, sides in (("cube", 6, 4), ("icosa", 20, 3)):
            v = demo_body(name)
            hv, hf = geometry.hull_compact(v)
            polys = geometry.merge_coplanar(hv, hf, 1.0)
            self.assertEqual(len(polys), faces, name)
            self.assertTrue(all(len(p) == sides for p in polys), name)
            area = sum(polygon_area(p) for p in polys)
            self.assertAlmostEqual(area, geometry.mesh_area(hv, hf), places=9)

    def test_merge_coplanar_keeps_outward_orientation(self):
        hv, hf = geometry.hull_compact(demo_body("prism"))
        center = hv.mean(axis=0)
        for poly in geometry.merge_coplanar(hv, hf, 1.0):
            n = np.cross(poly, np.roll(poly, -1, axis=0)).sum(axis=0)
            self.assertGreater(float(n @ (poly.mean(axis=0) - center)), 0)

    def test_snap_to_planes_moves_vertices_onto_facets(self):
        hv, hf = geometry.hull_compact(demo_body("cube"))
        moved = np.array([[0.2, 0.3, 3.004], [0.99, -0.5, 1.0], [5.0, 5.0, 5.0]])
        snapped = geometry.snap_to_planes(moved, hv, hf, 0.05)
        self.assertAlmostEqual(snapped[0, 2], 3.0, places=12)
        self.assertAlmostEqual(snapped[1, 0], 1.0, places=12)
        self.assertTrue(np.array_equal(snapped[2], moved[2]))

    def test_polygons_to_mesh_welds_shared_vertices(self):
        square = np.array([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], float)
        other = np.array([[1, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0]], float)
        verts, faces = geometry.polygons_to_mesh([square, other])
        self.assertEqual(len(verts), 6)
        self.assertEqual(faces, [[0, 1, 2, 3], [1, 4, 5, 2]])

    def test_edge_array_mixed_faces(self):
        edges = geometry.edge_array([[0, 1, 2], [0, 2, 3, 4]])
        self.assertEqual(edges.tolist(), [[0, 1], [0, 2], [0, 4], [1, 2], [2, 3], [3, 4]])

    def test_hull_compact_indices_are_valid(self):
        pts = np.random.default_rng(7).random((200, 3))
        hv, hf = geometry.hull_compact(pts)
        self.assertEqual(len(hv), len(ConvexHull(pts).vertices))
        self.assertTrue(all(0 <= i < len(hv) for f in hf for i in f))


class SimplifyTest(unittest.TestCase):
    def test_minimal_polyhedron_is_thread_safe(self):
        rng = np.random.default_rng(11)
        clouds = [rng.normal(size=(400, 3)) * [1, 1.3, 0.8] for _ in range(6)]
        minimal.clear_cache()
        expected = [minimal.minimal_polyhedron(c, pct=40, snap=False)["triangles"] for c in clouds]
        minimal.clear_cache()
        got = [None] * len(clouds)

        def work(i):
            for _ in range(3):
                got[i] = minimal.minimal_polyhedron(clouds[i], pct=40, snap=False)["triangles"]
                minimal.clear_cache()

        threads = [threading.Thread(target=work, args=(i,)) for i in range(len(clouds))]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(got, expected)

    def test_model_sections_noise_is_deterministic(self):
        v, faces = pipeline.hull(pipeline.normalize_mesh(demo_body("octa"), flip=False))
        a = ModelSections(v, faces, 10, 90, "angles", seeds={"angles": 5})
        b = ModelSections(v, faces, 10, 90, "angles", seeds={"angles": 5})
        self.assertTrue(np.array_equal(a.noisy(0.01)[0], b.noisy(0.01)[0]))
        self.assertTrue(np.array_equal(a.noisy(0.0)[0], a.r_true))
        pts = a.points(a.smooth(a.noisy(0.01)[0], "fft", 12), "envelope")
        self.assertEqual(pts.shape[1], 3)
        self.assertTrue(set(np.round(pts[:, 2], 6)) <= set(np.round(a.zs, 6)))


class DeltaChunksTest(unittest.TestCase):
    def test_vectorized_chunks_match_reference(self):
        rnd = random.Random(2)
        blobs = [
            b"",
            b"short",
            bytes(rnd.randrange(256) for _ in range(300_000)),
            b"\0" * 1_200_000,
            bytes(rnd.randrange(256) for _ in range(40_000)) + b"ab" * 400_000,
        ]
        for blob in blobs:
            self.assertEqual(list(delta.chunks(blob)), list(delta._chunks_reference(blob)))


if __name__ == "__main__":
    unittest.main()
