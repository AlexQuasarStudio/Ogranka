"""Общая часть конвейера и живого предпросмотра.

``ModelSections`` хранит эталонные сечения одной модели и фиксированные
реализации шума, а методы строят зашумлённые опорные функции, сглаживают
их и восстанавливают точки сечений.  Раньше этот код дублировался в
сервере и в живом предпросмотре.
"""
from __future__ import annotations

from typing import Callable, Optional

import numpy as np

from .denoise import (
    envelope_points_array,
    fourier_denoise_matrix,
    fourier_design,
    maxima_points_array,
    uniform_denoise_adaptive_matrix,
)
from .geometry import (
    build_sections_ex,
    contours_support_layers,
    edge_array,
    edge_noise_layers,
    normal_noise_layers,
    resample_contour,
)

__all__ = ["ModelSections", "NOISE_MODELS", "METHODS", "UNI_K_MAX"]

NOISE_MODELS = ("angles", "edges", "normal")
METHODS = ("fft", "uni", "none")
UNI_K_MAX = 30
HEIGHT = 3.0

Progress = Optional[Callable[[float], None]]


class ModelSections:
    """Reference sections of one model plus deterministic noise patterns.

    ``seeds`` maps a noise model to the RNG seed of its pattern, so the same
    model and parameters always produce the same noisy data.
    """

    def __init__(
        self,
        verts,
        faces,
        n_layers: int = 60,
        n_angles: int = 720,
        noise_model: str = "angles",
        seeds: Optional[dict] = None,
        progress: Progress = None,
    ):
        seeds = seeds or {}
        self.noise_model = noise_model if noise_model in NOISE_MODELS else "angles"
        self.contour_step = HEIGHT / max(1, int(n_layers))
        alphas, layers, polygons = build_sections_ex(
            verts, edge_array(faces), int(n_layers), int(n_angles), progress=progress
        )
        if not layers:
            raise ValueError("модель не пересекается ни одним сечением")
        self.alphas = alphas
        self.zs = np.array([z for z, _ in layers])
        self.r_true = np.vstack([r for _, r in layers])
        self.true_by_z = {round(z, 6): r for z, r in layers}
        self.polygons = polygons
        self._designs: dict = {}

        self.angle_units = None
        self.edge_units: list = []
        self.normal_units: list = []
        if "angles" in seeds:
            rng = np.random.default_rng(seeds["angles"])
            self.angle_units = rng.uniform(-1.0, 1.0, size=self.r_true.shape)
        if self.noise_model == "edges":
            rng = np.random.default_rng(seeds.get("edges", 0))
            self.edge_units = [rng.uniform(-1.0, 1.0, size=len(poly)) for _, poly in polygons]
        elif self.noise_model == "normal":
            rng = np.random.default_rng(seeds.get("normal", 0))
            for _, poly in polygons:
                count = len(resample_contour(poly, self.contour_step)[0])
                self.normal_units.append(rng.uniform(-1.0, 1.0, size=count))

    @property
    def layer_count(self) -> int:
        return len(self.zs)

    def noisy(self, rv: float):
        """Noisy support rows for amplitude ``rv`` and, for the contour model, rings."""
        rv = float(rv)
        if self.noise_model == "normal":
            contours = normal_noise_layers(self.polygons, self.contour_step, rv, self.normal_units)
            rows = contours_support_layers(contours, self.alphas)
            return np.vstack([row for _, row in rows]), contours
        if self.noise_model == "edges":
            if rv > 0:
                layers = edge_noise_layers(self.polygons, self.alphas, rv, self.edge_units)
                return np.vstack([row for _, row in layers]), None
            return self.r_true.copy(), None
        if rv > 0:
            if self.angle_units is None:
                raise RuntimeError("для модели шума по углам не задан seed")
            return self.r_true + rv * self.angle_units, None
        return self.r_true.copy(), None

    def design(self, harmonics: int):
        harmonics = int(harmonics)
        cached = self._designs.get(harmonics)
        if cached is None:
            cached = fourier_design(self.alphas, harmonics)
            self._designs[harmonics] = cached
        return cached

    def smooth(self, rows, method: str, harmonics: int = 32, window: int = 5):
        """Smooth noisy rows with ``fft`` (Fourier + LSQ), ``uni`` or ``none``."""
        if method == "fft":
            design, pinv = self.design(harmonics)
            return fourier_denoise_matrix(rows, design, pinv)
        if method == "uni":
            return uniform_denoise_adaptive_matrix(rows, self.r_true, int(window), UNI_K_MAX)
        return rows

    def points(self, rows, mode: str = "envelope", progress: Progress = None) -> np.ndarray:
        """3D points of all sections restored from smoothed support rows."""
        build = maxima_points_array if mode == "maxima" else envelope_points_array
        chunks = []
        total = len(self.zs)
        for li, z in enumerate(self.zs):
            chunks.append(build(self.alphas, rows[li], float(z)))
            if progress and li % 5 == 0:
                progress((li + 1) / total)
        if not chunks:
            return np.zeros((0, 3))
        return np.concatenate(chunks)
