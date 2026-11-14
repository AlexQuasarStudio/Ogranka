"""Публичный фасад вычислительного ядра.

Реализация разделена по модулям:
    geometry  — разбор, сечения, оболочки, полигоны;
    denoise   — шум и сглаживание;
    simplify  — fast-simplification;
    minimal   — минимальный многогранник;
    metrics   — метрики.
"""
from .denoise import (
    add_noise,
    envelope,
    envelope_points,
    fourier_denoise,
    fourier_denoise_matrix,
    fourier_design,
    maxima_points,
    moving_average,
    uniform_denoise_adaptive,
)
from .geometry import (
    build_sections,
    hull,
    hull_compact,
    merge_coplanar,
    mesh_area,
    mesh_edges,
    normalize_mesh,
    parse_obj,
    parse_points,
    polygons_to_mesh,
    section_from_edges,
    snap_to_planes,
    support,
    triangulate_polygon,
)
from .metrics import metrics
from .minimal import SIMPLIFY_LEVELS, minimal_polyhedron
from .simplify import HAS_FAST

__all__ = [
    "parse_obj",
    "parse_points",
    "normalize_mesh",
    "hull",
    "mesh_edges",
    "section_from_edges",
    "support",
    "build_sections",
    "hull_compact",
    "mesh_area",
    "merge_coplanar",
    "snap_to_planes",
    "triangulate_polygon",
    "polygons_to_mesh",
    "add_noise",
    "fourier_denoise",
    "fourier_design",
    "fourier_denoise_matrix",
    "moving_average",
    "uniform_denoise_adaptive",
    "maxima_points",
    "envelope",
    "envelope_points",
    "minimal_polyhedron",
    "metrics",
    "SIMPLIFY_LEVELS",
    "HAS_FAST",
]
