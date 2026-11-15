# -*- mode: python ; coding: utf-8 -*-

import glob
import os
import sys

sys.path.insert(0, os.fspath(globals().get("SPECPATH") or os.getcwd()))

from config import APP_BUILD, APP_VERSION

import scipy

_ext = ".pyd" if sys.platform == "win32" else ".so"
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
    hiddenimports=['fast_simplification', 'webview.platforms.cocoa'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'pkg_resources', 'open3d', 'torch', 'transformers',
        'matplotlib', 'PIL', 'cryptography', 'pytest', 'setuptools',
        'jinja2', 'mako', 'markupsafe', 'yaml', 'contourpy', 'kiwisolver',
        'dateutil', 'pygments', 'pyparsing', 'scipy',
        'curses', '_curses', 'readline',
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
    strip=True,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['icon.icns'],
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=True,
    upx=True,
    upx_exclude=[],
    name='Ogranka',
)
app = BUNDLE(
    coll,
    name='Ogranka.app',
    icon='icon.icns',
    bundle_identifier='ru.msu.reconstruct-z.ogranka',
    version=APP_BUILD,
    info_plist={
        'CFBundleDisplayName': 'Огранка',
        'CFBundleName': 'Огранка',
        'CFBundleGetInfoString': f'Огранка {APP_VERSION} — восстановление формы',
        'CFBundleShortVersionString': APP_VERSION,
        'CFBundleVersion': APP_BUILD,
        'NSHumanReadableCopyright': '© 2026 Дьяченко Алексей',
    },
)
