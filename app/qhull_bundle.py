"""Сборка минимального Qhull из установленного SciPy (используется в .spec).

Приложению нужен только ``scipy.spatial._qhull``.  Он тянет за собой
``scipy.linalg.cython_lapack``, а тот — OpenBLAS, gfortran и quadmath
(около 30 МБ), хотя для построения выпуклой оболочки эти функции не нужны.
Поэтому вместо настоящего модуля в сборку кладётся заглушка с теми же
C-капсулами: Qhull успешно импортируется, а случайный вызов LAPACK аварийно
завершит процесс вместо неопределённого поведения.

Подписи капсул читаются из установленного SciPy во время сборки, поэтому
заглушка всегда совпадает с упакованным ``_qhull``.
"""
from __future__ import annotations

import ctypes
import glob
import os
import re
import shutil
import sys

STUB_DOC = '''"""Заглушка scipy.linalg.cython_lapack для встроенного Qhull (см. qhull_bundle.py)."""'''

STUB_BODY = r'''
import ctypes
import os

_SIGNATURES = {signatures!r}


def _abort_address():
    candidates = []
    if os.name == "nt":
        for name in ("ucrtbase", "msvcrt"):
            try:
                candidates.append(getattr(ctypes, "cdll").LoadLibrary(name))
            except OSError:
                pass
    else:
        try:
            candidates.append(ctypes.CDLL(None))
        except OSError:
            pass
    for lib in candidates:
        try:
            return ctypes.cast(lib.abort, ctypes.c_void_p).value
        except AttributeError:
            continue
    raise ImportError("не найдена функция abort для заглушки LAPACK")


_new_capsule = ctypes.pythonapi.PyCapsule_New
_new_capsule.restype = ctypes.py_object
_new_capsule.argtypes = (ctypes.c_void_p, ctypes.c_char_p, ctypes.c_void_p)
_ADDRESS = _abort_address()
_NAMES = {{name: sig.encode("ascii") for name, sig in _SIGNATURES.items()}}
__pyx_capi__ = {{name: _new_capsule(_ADDRESS, sig, None) for name, sig in _NAMES.items()}}
'''

INIT_TEXT = "# Minimal SciPy namespace for the bundled Qhull extension.\n"

# SciPy ≥ 1.16 помечает функции декоратором xp_capabilities из модуля
# scipy._lib._array_api, который тянет array-api-compat и половину SciPy.
# Для Qhull это лишь аннотация, поэтому достаточно тождественного декоратора.
ARRAY_API_TEXT = '''"""Заглушка scipy._lib._array_api для встроенного Qhull (см. qhull_bundle.py)."""


def xp_capabilities(*args, **kwargs):
    def decorate(func):
        return func

    return decorate
'''
DEFAULT_FUNCTIONS = ("dgetrf", "dgecon", "dgetrs")


def _ext() -> str:
    return ".pyd" if sys.platform == "win32" else ".so"


def _find(root: str, subdir: str, pattern: str, required: bool = True):
    files = sorted(glob.glob(os.path.join(root, subdir, pattern + "*" + _ext())))
    if not files:
        if required:
            raise SystemExit(f"Qhull dependency not found: {subdir}/{pattern}")
        return None
    return files[0]


def lapack_signatures(qhull_path: str) -> dict:
    """Capsule signatures of the LAPACK functions imported by ``_qhull``."""
    from scipy.linalg import cython_lapack

    get_name = ctypes.pythonapi.PyCapsule_GetName
    get_name.restype = ctypes.c_char_p
    get_name.argtypes = (ctypes.py_object,)
    capi = cython_lapack.__pyx_capi__
    with open(qhull_path, "rb") as fh:
        blob = fh.read()
    found = set(re.findall(rb"cython_lapack_([a-z0-9_]+)", blob))
    names = sorted({n.decode() for n in found if n.decode() in capi} | set(DEFAULT_FUNCTIONS))
    return {name: get_name(capi[name]).decode("ascii") for name in names if name in capi}


def _windows_dll_dependencies(paths, search_dir):
    """DLLs from SciPy's delvewheel folder that the copied ``.pyd`` files import."""
    if sys.platform != "win32" or not os.path.isdir(search_dir):
        return []
    try:
        import pefile
    except ImportError:
        return []
    available = {name.lower(): os.path.join(search_dir, name) for name in os.listdir(search_dir)}
    needed = []
    for path in paths:
        pe = pefile.PE(path, fast_load=True)
        pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_IMPORT"]])
        for entry in getattr(pe, "DIRECTORY_ENTRY_IMPORT", []):
            dll = entry.dll.decode("ascii", "ignore").lower()
            if dll in available and available[dll] not in needed:
                needed.append(available[dll])
    return needed


def prepare(dest: str):
    """Create ``dest/scipy`` and return PyInstaller ``(binaries, datas)``."""
    import scipy

    root = os.path.dirname(scipy.__file__)
    qhull = _find(root, "spatial", "_qhull")
    messages = _find(root, "_lib", "messagestream")
    cyutility = _find(root, "", "_cyutility", required=False)

    package = os.path.join(dest, "scipy")
    shutil.rmtree(package, ignore_errors=True)
    for sub in ("", "spatial", "_lib", "linalg"):
        os.makedirs(os.path.join(package, sub), exist_ok=True)
        with open(os.path.join(package, sub, "__init__.py"), "w", encoding="utf-8") as fh:
            fh.write(INIT_TEXT)
    stub = STUB_DOC + "\n" + STUB_BODY.format(signatures=lapack_signatures(qhull))
    with open(os.path.join(package, "linalg", "cython_lapack.py"), "w", encoding="utf-8") as fh:
        fh.write(stub)
    with open(os.path.join(package, "_lib", "_array_api.py"), "w", encoding="utf-8") as fh:
        fh.write(ARRAY_API_TEXT)

    binaries = [(qhull, "scipy/spatial"), (messages, "scipy/_lib")]
    if cyutility:
        binaries.append((cyutility, "scipy"))
    libs = os.path.join(os.path.dirname(root), "scipy.libs")
    for dll in _windows_dll_dependencies([b for b, _ in binaries], libs):
        binaries.append((dll, "."))
    return binaries, [(package, "scipy")]


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join("build", "qhull")
    bins, datas = prepare(out)
    for item in bins + datas:
        print(*item)
