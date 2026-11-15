"""Convex hull backend: bundled Qhull without the SciPy package.

PyInstaller ships the small SciPy Qhull extension plus its two tiny runtime
dependencies.  The rest of SciPy is not needed by the application.
"""
from scipy.spatial._qhull import ConvexHull, QhullError

__all__ = ["ConvexHull", "QhullError"]
