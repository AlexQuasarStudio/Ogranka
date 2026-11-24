# -*- mode: python ; coding: utf-8 -*-
"""Единый PyInstaller-спек Огранки для macOS, Windows и Linux.

macOS — бандл Ogranka.app, Windows — один файл Ogranka.exe,
Linux — папка Ogranka/ (из неё build_linux.sh собирает AppImage).

Вместо полного SciPy в сборку попадает только расширение Qhull с
заглушками LAPACK и array-API (см. qhull_bundle.py): это экономит около
30 МБ OpenBLAS/gfortran на Windows и Linux.
"""
import os
import sys

SPEC_DIR = os.path.abspath(globals().get("SPECPATH") or os.getcwd())
sys.path.insert(0, SPEC_DIR)

from config import APP_BUILD, APP_VERSION  # noqa: E402
import qhull_bundle  # noqa: E402

IS_MAC = sys.platform == "darwin"
IS_WIN = sys.platform == "win32"
IS_LINUX = not (IS_MAC or IS_WIN)

qhull_binaries, qhull_datas = qhull_bundle.prepare(os.path.join(workpath, "qhull"))  # noqa: F821

hiddenimports = ["fast_simplification"]
if IS_MAC:
    hiddenimports += ["webview.platforms.cocoa"]
if IS_WIN:
    hiddenimports += [
        "webview.platforms.edgechromium",
        "webview.platforms.winforms",
        "clr_loader",
        "pythonnet",
    ]

excludes = [
    # Тяжёлые пакеты, которые могут оказаться в окружении сборки.
    "scipy", "open3d", "torch", "transformers", "matplotlib", "PIL", "IPython",
    "contourpy", "kiwisolver", "dateutil", "pygments", "pyparsing", "yaml",
    "jinja2", "mako", "markupsafe", "cryptography", "psutil", "charset_normalizer",
    "pkg_resources", "setuptools", "pytest",
    # Части NumPy и стандартной библиотеки, не нужные приложению.
    "numpy.f2py", "numpy.testing", "numpy.distutils", "unittest", "doctest",
    "pydoc_data", "lib2to3", "sqlite3", "tkinter", "_tkinter", "test",
    "curses", "_curses", "readline",
]
if IS_LINUX:
    # На Linux окно открывает системный WebKit или браузер в режиме приложения.
    excludes += ["webview", "pythonnet", "clr_loader", "clr", "gi"]

a = Analysis(
    ["app.py"],
    pathex=[SPEC_DIR],
    binaries=qhull_binaries,
    datas=[("static", "static")] + qhull_datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

if IS_WIN:
    exe = EXE(
        pyz,
        a.scripts,
        a.binaries,
        a.datas,
        [],
        name="Ogranka",
        debug=False,
        bootloader_ignore_signals=False,
        strip=False,
        upx=True,
        upx_exclude=["vcruntime140.dll", "python3*.dll"],
        runtime_tmpdir=None,
        console=False,
        disable_windowed_traceback=False,
        icon=["icon.ico"],
        version="version_info.txt",
    )
else:
    exe = EXE(
        pyz,
        a.scripts,
        [],
        exclude_binaries=True,
        name="Ogranka",
        debug=False,
        bootloader_ignore_signals=False,
        strip=IS_MAC,
        upx=IS_MAC,
        console=IS_LINUX,
        disable_windowed_traceback=False,
        argv_emulation=False,
        target_arch=None,
        codesign_identity=None,
        entitlements_file=None,
        icon=["icon.icns"] if IS_MAC else None,
    )
    coll = COLLECT(
        exe,
        a.binaries,
        a.datas,
        strip=IS_MAC,
        upx=IS_MAC,
        upx_exclude=[],
        name="Ogranka",
    )

if IS_MAC:
    app = BUNDLE(
        coll,
        name="Ogranka.app",
        icon="icon.icns",
        bundle_identifier="ru.msu.reconstruct-z.ogranka",
        version=APP_BUILD,
        info_plist={
            "CFBundleDisplayName": "Огранка",
            "CFBundleName": "Огранка",
            "CFBundleGetInfoString": f"Огранка {APP_VERSION} — восстановление формы",
            "CFBundleShortVersionString": APP_VERSION,
            "CFBundleVersion": APP_BUILD,
            "LSMinimumSystemVersion": "11.0",
            "NSHighResolutionCapable": True,
            "NSRequiresAquaSystemAppearance": False,
            "NSHumanReadableCopyright": "© 2026 Дьяченко Алексей",
        },
    )
