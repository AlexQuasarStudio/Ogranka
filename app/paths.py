"""Пути приложения: ресурсы сборки и пользовательские данные."""
from __future__ import annotations

import os
import platform
import sys

FROZEN = getattr(sys, "_MEIPASS", None)
"""Папка распакованной сборки PyInstaller или ``None`` при запуске из исходников."""

BASE = FROZEN or os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(BASE, "static")


def user_data_root() -> str:
    """Per-user data folder of the installed application (``OGRANKA_DATA`` wins)."""
    override = os.environ.get("OGRANKA_DATA")
    if override:
        return override
    home = os.path.expanduser("~")
    system = platform.system()
    if system == "Darwin":
        return os.path.join(home, "Library", "Application Support", "ShapePipeline")
    if system == "Windows":
        return os.path.join(os.environ.get("APPDATA", home), "ShapePipeline")
    return os.path.join(home, ".local", "share", "shape-pipeline")


def data_dir() -> str:
    """Where runs and uploads live: user folder for builds, the app folder in dev."""
    override = os.environ.get("OGRANKA_DATA")
    if override:
        return override
    if FROZEN:
        return user_data_root()
    return os.path.dirname(os.path.abspath(__file__))


DATA = data_dir()
UPLOADS = os.path.join(DATA, "uploads")
RUNS = os.path.join(DATA, "runs")
WELCOME_FILE = os.path.join(DATA, "welcome_seen")
LAST_BUILD_FILE = os.path.join(DATA, "_last_build")
BROWSER_PROFILE = os.path.join(DATA, "browser-profile")


def ensure_dirs() -> None:
    for path in (UPLOADS, RUNS):
        os.makedirs(path, exist_ok=True)
