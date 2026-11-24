"""GitHub: последний релиз, история изменений и issues (с кэшем)."""
from __future__ import annotations

import json
import platform
import re
import ssl
import threading
import time
from typing import Callable
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import updater
from config import APP_BUILD, APP_REPO, APP_VERSION
from versioning import is_newer_release, is_newer_version, release_build

try:
    import certifi
except Exception:  # pragma: no cover - certifi is optional in dev
    certifi = None

try:
    SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where() if certifi else None)
except Exception:  # pragma: no cover
    SSL_CONTEXT = ssl.create_default_context()

API = "https://api.github.com/repos/" + APP_REPO
NOTES_LIMIT = 12000
CHANGELOG_LIMIT = 20
ISSUES_LIMIT = 50


class TTLCache:
    """Single-value cache: concurrent callers share one network request."""

    def __init__(self, ttl: float):
        self.ttl = ttl
        self._value = None
        self._at = 0.0
        self._lock = threading.Lock()
        self._fetch_lock = threading.Lock()

    def _fresh(self):
        with self._lock:
            if self._value is not None and time.time() - self._at < self.ttl:
                return self._value
        return None

    def get(self, produce: Callable[[], dict], force: bool = False) -> dict:
        if not force:
            value = self._fresh()
            if value is not None:
                return value
        with self._fetch_lock:
            if not force:
                value = self._fresh()
                if value is not None:
                    return value
            value = produce()
            with self._lock:
                self._value = value
                self._at = time.time()
            return value

    def clear(self) -> None:
        with self._lock:
            self._value = None
            self._at = 0.0


UPDATE_CACHE = TTLCache(900)
CHANGELOG_CACHE = TTLCache(900)
ISSUES_CACHE = TTLCache(300)


def _get_json(url: str, timeout: float = 6):
    request = Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": f"Ogranka/{APP_VERSION}",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urlopen(request, timeout=timeout, context=SSL_CONTEXT) as response:
        return json.loads(response.read().decode("utf-8"))


def _error(exc: Exception) -> str:
    if isinstance(exc, HTTPError):
        return f"github_http_{exc.code}"
    return "network"


def _notes(release: dict) -> tuple[str, bool]:
    text = str(release.get("body") or "").strip()
    return text[:NOTES_LIMIT], len(text) > NOTES_LIMIT


# ---------------------------------------------------------------- ассеты


def release_asset(release: dict):
    """Release asset for the running platform (and CPU for AppImage)."""
    assets = release.get("assets") or []
    system = platform.system().lower()
    if system == "darwin":
        extensions = (".zip", ".dmg", ".pkg")
    elif system == "windows":
        extensions = (".exe", ".msi", ".zip")
    elif updater.is_appimage() or system == "linux":
        arm = platform.machine().lower() in ("aarch64", "arm64")
        for asset in assets:
            lower = str(asset.get("name") or "").lower()
            if lower.endswith(".appimage") and ("arm64" in lower or "aarch64" in lower) == arm:
                return asset
        return None
    else:
        return None
    for extension in extensions:
        for asset in assets:
            if str(asset.get("name") or "").lower().endswith(extension):
                return asset
    return None


def asset_sha256(asset) -> str:
    digest = str((asset or {}).get("digest") or "").strip().lower()
    if digest.startswith("sha256:"):
        digest = digest[7:]
    return digest if re.fullmatch(r"[0-9a-f]{64}", digest) else ""


def checksums_url(release: dict) -> str:
    for asset in release.get("assets") or []:
        if str(asset.get("name") or "").lower() == "sha256sums.txt":
            return asset.get("browser_download_url") or ""
    return ""


def delta_asset(release: dict, asset_name: str):
    if not asset_name:
        return None
    target = asset_name + ".delta.json"
    for asset in release.get("assets") or []:
        if str(asset.get("name") or "") == target:
            return asset
    return None


# ---------------------------------------------------------------- обновление


def _describe_release(release: dict) -> dict:
    tag = str(release.get("tag_name") or release.get("name") or "").strip()
    version = tag.lstrip("vV")
    build = release_build(release)
    asset = release_asset(release) or {}
    name = str(asset.get("name") or "")
    url = str(asset.get("browser_download_url") or "")
    sha = asset_sha256(asset)
    sums = checksums_url(release)
    delta = delta_asset(release, name) or {}
    installable, reason = updater.can_install(name, bool(sha or sums))
    available = is_newer_release(version, build, APP_VERSION, APP_BUILD)
    if available and is_newer_version(version, APP_VERSION):
        kind = "version"
    elif available:
        kind = "build"
    else:
        kind = "none"
    notes, truncated = _notes(release)
    return {
        "available": available,
        "update_kind": kind,
        "current": APP_VERSION,
        "current_build": APP_BUILD,
        "version": version,
        "build": build,
        "tag": tag,
        "title": release.get("name") or tag,
        "url": url or release.get("html_url"),
        "release_url": release.get("html_url"),
        "asset": name or None,
        "asset_url": url,
        "asset_name": name,
        "asset_size": int(asset.get("size") or 0),
        "asset_sha256": sha,
        "delta_url": str(delta.get("browser_download_url") or ""),
        "delta_name": str(delta.get("name") or ""),
        "checksums_url": sums,
        "installable": installable,
        "install_reason": reason,
        "install_hint": updater.reason_text(reason) if reason else "",
        "published_at": release.get("published_at"),
        "notes": notes,
        "notes_truncated": truncated,
        "checked": True,
    }


def _fetch_update() -> dict:
    try:
        release = _get_json(API + "/releases/latest")
    except HTTPError as exc:
        if exc.code == 404:
            return {"available": False, "current": APP_VERSION, "checked": True}
        return {"available": False, "current": APP_VERSION, "checked": False, "error": _error(exc)}
    except Exception as exc:
        return {"available": False, "current": APP_VERSION, "checked": False, "error": _error(exc)}
    if not isinstance(release, dict):
        return {"available": False, "current": APP_VERSION, "checked": False, "error": "invalid_response"}
    return _describe_release(release)


def update_info(force: bool = False) -> dict:
    """Latest release compared with the running version (cached for 15 min)."""
    return UPDATE_CACHE.get(_fetch_update, force)


# ---------------------------------------------------------------- история


def _fetch_changelog() -> dict:
    try:
        releases = _get_json(f"{API}/releases?per_page={CHANGELOG_LIMIT}")
    except Exception as exc:
        return {"current": APP_VERSION, "releases": [], "checked": False, "error": _error(exc)}
    if not isinstance(releases, list):
        return {"current": APP_VERSION, "releases": [], "checked": False, "error": "invalid_response"}
    items = []
    for release in releases:
        if not isinstance(release, dict) or release.get("draft"):
            continue
        tag = str(release.get("tag_name") or release.get("name") or "").strip()
        notes, truncated = _notes(release)
        items.append({
            "version": tag.lstrip("vV"),
            "tag": tag,
            "build": release_build(release),
            "title": release.get("name") or tag,
            "url": release.get("html_url"),
            "published_at": release.get("published_at"),
            "prerelease": bool(release.get("prerelease")),
            "notes": notes,
            "notes_truncated": truncated,
        })
    return {"current": APP_VERSION, "releases": items, "checked": True}


def changelog_info(force: bool = False) -> dict:
    return CHANGELOG_CACHE.get(_fetch_changelog, force)


# ---------------------------------------------------------------- issues


def _fetch_issues() -> dict:
    url = f"{API}/issues?state=all&per_page={ISSUES_LIMIT}&sort=updated&direction=desc"
    try:
        issues = _get_json(url, timeout=8)
    except Exception as exc:
        return {"checked": False, "issues": [], "error": _error(exc)}
    if not isinstance(issues, list):
        return {"checked": False, "issues": [], "error": "invalid_response"}
    items = []
    for issue in issues:
        if not isinstance(issue, dict) or issue.get("pull_request"):
            continue
        labels = [
            {"name": str(label.get("name") or ""), "color": str(label.get("color") or "586069")}
            for label in issue.get("labels") or []
            if isinstance(label, dict)
        ]
        items.append({
            "number": issue.get("number"),
            "title": str(issue.get("title") or ""),
            "state": str(issue.get("state") or ""),
            "url": str(issue.get("html_url") or ""),
            "comments": int(issue.get("comments") or 0),
            "created_at": issue.get("created_at"),
            "updated_at": issue.get("updated_at"),
            "user": str((issue.get("user") or {}).get("login") or ""),
            "labels": labels,
        })
    return {"checked": True, "issues": items}


def github_issues(force: bool = False) -> dict:
    return ISSUES_CACHE.get(_fetch_issues, force)
