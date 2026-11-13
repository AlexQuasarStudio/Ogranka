# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=[],
    datas=[('static', 'static')],
    hiddenimports=['fast_simplification', 'webview.platforms.cocoa'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['pkg_resources', 'open3d', 'torch', 'transformers'],
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
    strip=False,
    upx=True,
    upx_exclude=[],
    name='Ogranka',
)
app = BUNDLE(
    coll,
    name='Ogranka.app',
    icon='icon.icns',
    bundle_identifier=None,
)
