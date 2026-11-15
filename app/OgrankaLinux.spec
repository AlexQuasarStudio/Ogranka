# -*- mode: python ; coding: utf-8 -*-

import glob
import os
import sys

import scipy

_ext = ".so"
_sp = os.path.dirname(scipy.__file__)


def _find(subdir, pattern):
    files = sorted(glob.glob(os.path.join(_sp, subdir, pattern + "*" + _ext)))
    if not files:
        raise SystemExit("Qhull dependency not found: " + pattern)
    return files[0]


_QHULL = _find("spatial", "_qhull")
_MSG = _find("_lib", "messagestream")
_LAPACK = _find("linalg", "cython_lapack")
_CYU = glob.glob(os.path.join(_sp, "_cyutility*" + _ext))
_binaries = [
    (_QHULL, "scipy/spatial"),
    (_MSG, "scipy/_lib"),
    (_LAPACK, "scipy/linalg"),
]
if _CYU:
    _binaries.append((_CYU[0], "scipy"))

a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=_binaries,
    datas=[('static', 'static'), ('qhull_stub/scipy', 'scipy')],
    hiddenimports=['fast_simplification'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'pkg_resources', 'open3d', 'torch', 'transformers', 'webview',
        'pythonnet', 'clr_loader', 'clr', 'matplotlib', 'PIL',
        'cryptography', 'pytest', 'setuptools', 'jinja2', 'mako',
        'markupsafe', 'yaml', 'contourpy', 'kiwisolver', 'dateutil',
        'pygments', 'pyparsing', 'scipy', 'curses', '_curses', 'readline',
    ],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Ogranka',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='Ogranka',
)
