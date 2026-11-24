"""Сравнение версий и номеров сборок (общая логика сервера и апдейтера)."""
from __future__ import annotations

import re

_LEADING_VERSION = re.compile(r"(\d+(?:\.\d+)*)")
_BUILD_IN_TEXT = re.compile(r"\b(?:build|сборка)\s*[:#]?\s*(\d+)\b", re.IGNORECASE)


def version_key(value) -> tuple:
    """``"v1.2.10-beta"`` → ``(1, 2, 10)``; short versions are padded to three parts."""
    text = str(value or "").strip().lstrip("vV")
    match = _LEADING_VERSION.match(text)
    if not match:
        return ()
    parts = [int(part) for part in match.group(1).split(".")]
    return tuple(parts + [0] * (3 - len(parts)))


def is_newer_version(latest, current) -> bool:
    latest_key = version_key(latest)
    return bool(latest_key) and latest_key > version_key(current)


def build_number(value) -> int:
    """First integer in ``value`` (``"сборка 58"`` → 58), otherwise 0."""
    match = re.search(r"\d+", str(value or ""))
    return int(match.group(0)) if match else 0


def release_build(release: dict) -> str:
    """Build number mentioned in a GitHub release name or body."""
    text = "\n".join(str(release.get(key) or "") for key in ("name", "body"))
    match = _BUILD_IN_TEXT.search(text)
    return match.group(1) if match else ""


def is_newer_release(version, build, current_version, current_build) -> bool:
    """A release is newer by version, or by build when versions are equal."""
    if is_newer_version(version, current_version):
        return True
    if version_key(version) == version_key(current_version):
        return build_number(build) > build_number(current_build)
    return False
