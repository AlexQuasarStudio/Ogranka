"""Скачивание, проверка и установка обновления с перезапуском приложения."""
import hashlib
import hmac
import json
import os
import platform
import plistlib
import re
import shlex
import shutil
import ssl
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
from urllib.request import Request, urlopen

import delta
from config import APP_BUILD, APP_VERSION

try:
    import certifi
except Exception:
    certifi = None

try:
    SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where() if certifi else None)
except Exception:
    SSL_CONTEXT = ssl.create_default_context()

_LOCK = threading.Lock()
_STATE = {
    "state": "idle",
    "progress": 0.0,
    "detail": "",
    "error": "",
}
_ACTIVE = False


class CorruptUpdateError(RuntimeError):
    """Downloaded asset failed the integrity check."""


def _set_state(state=None, progress=None, detail=None, error=None):
    with _LOCK:
        if state is not None:
            _STATE["state"] = state
        if progress is not None:
            _STATE["progress"] = max(0.0, min(1.0, float(progress)))
        if detail is not None:
            _STATE["detail"] = str(detail)
        if error is not None:
            _STATE["error"] = str(error)


def status():
    with _LOCK:
        return dict(_STATE)


def appimage_path():
    path = os.environ.get("APPIMAGE") or ""
    if not path:
        return ""
    path = os.path.realpath(path)
    return path if os.path.isfile(path) else ""


def is_appimage():
    return bool(getattr(sys, "frozen", False) and appimage_path())


def _platform_context():
    if not getattr(sys, "frozen", False):
        return None
    system = platform.system()
    exe = os.path.realpath(sys.executable)
    if system == "Darwin":
        if "AppTranslocation" in exe:
            return {"kind": "mac", "reason": "translocated", "target": exe}
        contents = os.path.dirname(os.path.dirname(exe))
        bundle = os.path.dirname(contents)
        if not bundle.endswith(".app"):
            return None
        return {
            "kind": "mac",
            "exe": exe,
            "bundle": bundle,
            "parent": os.path.dirname(bundle),
            "ext": ".zip",
        }
    if system == "Windows":
        return {
            "kind": "windows",
            "exe": exe,
            "parent": os.path.dirname(exe),
            "ext": ".exe",
        }
    image = appimage_path()
    if image:
        return {
            "kind": "appimage",
            "exe": image,
            "target": image,
            "parent": os.path.dirname(image),
            "ext": ".AppImage",
        }
    return {
        "kind": "linux",
        "exe": exe,
        "dir": os.path.dirname(exe),
        "parent": os.path.dirname(exe),
        "ext": ".tar.gz",
    }


def can_install(asset_name, has_checksum=True):
    context = _platform_context()
    if context is None:
        return False, "dev"
    if context.get("reason"):
        return False, context["reason"]
    name = str(asset_name or "").lower()
    extension = str(context["ext"] or "").lower()
    if not name or not name.endswith(extension):
        return False, "asset"
    if not has_checksum:
        return False, "checksum"
    if not os.access(context["parent"], os.W_OK):
        return False, "permissions"
    return True, ""


def _cache_dir():
    override = os.environ.get("OGRANKA_DATA")
    if override:
        root = override
    else:
        home = os.path.expanduser("~")
        if platform.system() == "Darwin":
            root = os.path.join(home, "Library", "Application Support", "ShapePipeline")
        elif platform.system() == "Windows":
            root = os.path.join(os.environ.get("APPDATA", home), "ShapePipeline")
        else:
            root = os.path.join(home, ".local", "share", "shape-pipeline")
    path = os.path.join(root, "update-cache")
    os.makedirs(path, exist_ok=True)
    return path


def _cache_path(context):
    names = {"mac": "macos.zip", "linux": "linux.tar.gz"}
    name = names.get(context["kind"])
    return os.path.join(_cache_dir(), name) if name else ""


def _old_asset(context):
    if context["kind"] in ("appimage", "windows"):
        exe = context.get("exe")
        return exe if exe and os.path.isfile(exe) else ""
    path = _cache_path(context)
    return path if path and os.path.isfile(path) else ""


def _cache_asset(archive, context):
    path = _cache_path(context)
    if not path:
        return
    temp = ""
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        temp = path + ".tmp"
        shutil.copy2(archive, temp)
        os.replace(temp, path)
    except Exception:
        if temp:
            try:
                os.remove(temp)
            except Exception:
                pass


def _fetch_range(url, start, length):
    end = start + length - 1
    request = Request(
        url,
        headers={
            "User-Agent": f"Ogranka/{APP_VERSION}",
            "Accept": "application/octet-stream",
            "Range": f"bytes={start}-{end}",
        },
    )
    with urlopen(request, timeout=60, context=SSL_CONTEXT) as response:
        status = getattr(response, "status", 206)
        if status != 206:
            raise RuntimeError("Сервер не поддерживает загрузку обновления.")
        payload = response.read()
    if len(payload) != length:
        raise RuntimeError("Сервер вернул неполное обновление.")
    return payload


def _download_delta(info, archive, context):
    manifest_url = str(info.get("delta_url") or "")
    asset_url = str(info.get("asset_url") or "")
    asset_name = str(info.get("asset_name") or "")
    if not manifest_url or not asset_url:
        return False
    old_path = _old_asset(context)
    if not old_path:
        _set_state("downloading", 0.02, "Загружаю обновление…")
        return False
    _set_state("downloading", 0.02, "Загружаю обновление…")
    manifest = json.loads(_fetch_text(manifest_url))
    if str(manifest.get("asset") or "") != asset_name:
        raise RuntimeError("Данные обновления относятся к другому файлу.")

    def fetch(offset, length):
        return _fetch_range(asset_url, offset, length)

    def progress(done, total):
        fraction = min(1.0, done / total) if total else 0.0
        _set_state(
            progress=0.02 + 0.84 * fraction,
            detail=f"Загружаю обновление… {round(fraction * 100)}%",
        )

    stats = delta.reconstruct(old_path, manifest, fetch, archive, progress=progress)
    _set_state(detail="Обновление загружено.")
    return True


def reason_text(reason):
    return {
        "dev": "Автоустановка доступна только в собранной версии приложения.",
        "translocated": (
            "Приложение запущено из временной папки macOS. "
            "Переместите его в «Программы» и повторите."
        ),
        "asset": "В релизе нет подходящего файла для этой системы.",
        "checksum": "Не удалось проверить обновление. Скачайте его вручную.",
        "permissions": "Нет прав на запись в папку приложения. Скачайте обновление вручную.",
    }.get(reason, "Автоустановка недоступна.")


def start_install(info):
    global _ACTIVE
    if not info or not info.get("available"):
        raise RuntimeError("Обновление не найдено.")
    ok, reason = can_install(
        info.get("asset_name"),
        bool(info.get("asset_sha256") or info.get("checksums_url")),
    )
    if not ok:
        raise RuntimeError(reason_text(reason))
    if not _is_newer_release_info(info):
        raise RuntimeError("В релизе нет более новой сборки.")
    with _LOCK:
        if _ACTIVE:
            raise RuntimeError("Установка уже идёт.")
        _ACTIVE = True
        _STATE.update({"state": "preparing", "progress": 0.0, "detail": "Подготовка…", "error": ""})
    thread = threading.Thread(target=_install, args=(dict(info),), daemon=True)
    thread.start()
    return status()


def _fetch_text(url):
    request = Request(
        url,
        headers={"User-Agent": f"Ogranka/{APP_VERSION}", "Accept": "text/plain,*/*"},
    )
    with urlopen(request, timeout=30, context=SSL_CONTEXT) as response:
        return response.read().decode("utf-8", errors="replace")


def _download(url, path, start=0.0, end=0.9):
    request = Request(
        url,
        headers={"User-Agent": f"Ogranka/{APP_VERSION}", "Accept": "application/octet-stream"},
    )
    _set_state("downloading", start, "Скачиваю обновление…")
    with urlopen(request, timeout=60, context=SSL_CONTEXT) as response:
        total = int(response.headers.get("Content-Length") or 0)
        done = 0
        with open(path, "wb") as fh:
            while True:
                chunk = response.read(256 * 1024)
                if not chunk:
                    break
                fh.write(chunk)
                done += len(chunk)
                if total:
                    progress = start + (end - start) * min(1.0, done / total)
                else:
                    progress = min(end, start + 0.02)
                percent = f" {round(progress * 100)}%" if total else ""
                _set_state(detail=f"Скачиваю обновление…{percent}", progress=progress)
    if total and done != total:
        raise RuntimeError("Загрузка оборвалась: получено меньше байт, чем ожидалось.")
    _set_state(progress=end, detail="Скачивание завершено.")


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _checksum_for(info, archive_name):
    expected = str(info.get("asset_sha256") or "").strip().lower()
    if expected.startswith("sha256:"):
        expected = expected[7:]
    if expected:
        return expected
    url = info.get("checksums_url")
    if not url:
        return ""
    text = _fetch_text(url)
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 2:
            name = parts[-1].lstrip("*")
            if name == archive_name:
                return parts[0].strip().lower()
    return ""


def _verify(path, info):
    _set_state("verifying", 0.92, "Проверяю обновление…")
    name = str(info.get("asset_name") or os.path.basename(path))
    expected = _checksum_for(info, name)
    if not expected:
        raise RuntimeError("Не удалось проверить обновление.")
    actual = _sha256(path)
    if not hmac.compare_digest(actual, expected):
        raise CorruptUpdateError("Обновление повреждено.")
    size = info.get("asset_size")
    if size and os.path.getsize(path) != int(size):
        raise CorruptUpdateError("Обновление повреждено.")
    _set_state("installing", 0.96, "Устанавливаю обновление…")


def _safe_extract_tar(archive, destination):
    root = os.path.realpath(destination)
    with tarfile.open(archive, "r:gz") as tar:
        for member in tar.getmembers():
            if member.issym() or member.islnk():
                raise RuntimeError("В архиве обновления есть ссылки — установка отменена.")
            target = os.path.realpath(os.path.join(root, member.name))
            if target != root and not target.startswith(root + os.sep):
                raise RuntimeError("Архив обновления содержит недопустимый путь.")
        if hasattr(tarfile, "data_filter"):
            tar.extractall(destination, filter="data")
        else:
            tar.extractall(destination)


def _launch_args():
    return [arg for arg in sys.argv[1:] if not str(arg).startswith("-psn_")]


def _ps_quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def _build_number(value):
    match = re.search(r"\d+", str(value or ""))
    return int(match.group(0)) if match else 0


def _version_key(value):
    parts = [int(x) for x in re.findall(r"\d+", str(value or ""))][:3]
    return tuple(parts + [0] * (3 - len(parts)))


def _is_newer_release_info(info):
    version = str((info or {}).get("version") or "")
    if not version:
        return True
    latest = _version_key(version)
    current = _version_key(APP_VERSION)
    if latest != current:
        return latest > current
    return _build_number((info or {}).get("build")) > _build_number(APP_BUILD)


def _install_mac(archive, info):
    context = _platform_context()
    target = context["bundle"]
    extract = os.path.join(os.path.dirname(archive), "extracted")
    os.makedirs(extract, exist_ok=True)
    ditto = shutil.which("ditto") or "/usr/bin/ditto"
    subprocess.run([ditto, "-x", "-k", archive, extract], check=True, timeout=180)
    apps = []
    for root, dirs, _ in os.walk(extract):
        for name in dirs:
            if name.endswith(".app"):
                apps.append(os.path.join(root, name))
    if not apps:
        raise RuntimeError("В архиве не найден .app-бандл.")
    new_app = sorted(apps, key=lambda p: (os.path.basename(p) != os.path.basename(target), len(p)))[0]
    if not os.path.isfile(os.path.join(new_app, "Contents", "MacOS", "Ogranka")):
        raise RuntimeError("В новом бандле нет исполняемого файла.")
    try:
        with open(os.path.join(new_app, "Contents", "Info.plist"), "rb") as fh:
            plist = plistlib.load(fh)
    except Exception as exc:
        raise RuntimeError("Не удалось прочитать версию нового бандла.") from exc
    new_build = _build_number(plist.get("CFBundleVersion"))
    if new_build <= _build_number(APP_BUILD):
        raise RuntimeError("В релизе нет более новой macOS-сборки.")
    helper = os.path.join(os.path.dirname(archive), "install.sh")
    temp = os.path.dirname(archive)
    script = f"""#!/bin/sh
set -u
old={shlex.quote(target)}
new={shlex.quote(new_app)}
backup="$old.old.$$"
launch() {{
  app="$1"
  shift
  if [ -d "$app" ] && [ -x /usr/bin/open ]; then
    if /usr/bin/open -n "$app" --args "$@" >/dev/null 2>&1; then
      return
    fi
  fi
  if [ -x "$app/Contents/MacOS/Ogranka" ]; then
    ( cd "$app/Contents/MacOS" && nohup ./Ogranka "$@" >/dev/null 2>&1 & )
  fi
}}
while kill -0 {os.getpid()} 2>/dev/null; do sleep 1; done
if ! mv "$old" "$backup" 2>/dev/null; then
  launch "$old" "$@"
  exit 1
fi
if ! mv "$new" "$old" 2>/dev/null; then
  rm -rf "$old"
  if mv "$backup" "$old" 2>/dev/null; then
    launch "$old" "$@"
  else
    launch "$backup" "$@"
  fi
  exit 1
fi
launch "$old" "$@"
sleep 2
rm -rf "$backup" {shlex.quote(temp)}
"""
    with open(helper, "w", encoding="utf-8") as fh:
        fh.write(script)
    os.chmod(helper, 0o755)
    subprocess.Popen(
        ["/bin/sh", helper, *_launch_args()],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        close_fds=True,
    )


def _install_windows(archive, info):
    context = _platform_context()
    target = context["exe"]
    temp = os.path.dirname(archive)
    helper = os.path.join(temp, "install.ps1")
    script = f"""$ErrorActionPreference = 'SilentlyContinue'
Wait-Process -Id {os.getpid()} -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800
$copied = $false
for ($i = 0; $i -lt 120; $i++) {{
  Copy-Item -LiteralPath {_ps_quote(archive)} -Destination {_ps_quote(target)} -Force -ErrorAction SilentlyContinue
  if ($?) {{ $copied = $true; break }}
  Start-Sleep -Seconds 1
}}
Start-Process -FilePath {_ps_quote(target)} -WorkingDirectory {_ps_quote(os.path.dirname(target))}
Start-Sleep -Seconds 2
Remove-Item -LiteralPath {_ps_quote(temp)} -Recurse -Force -ErrorAction SilentlyContinue
"""
    with open(helper, "w", encoding="utf-8-sig") as fh:
        fh.write(script)
    flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    subprocess.Popen(
        [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            helper,
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=flags,
        close_fds=True,
    )


def _install_linux(archive, info):
    context = _platform_context()
    target_dir = context["dir"]
    extract = os.path.join(os.path.dirname(archive), "extracted")
    _safe_extract_tar(archive, extract)
    new_exe = os.path.join(extract, "Ogranka")
    new_internal = os.path.join(extract, "_internal")
    if not os.path.isfile(new_exe) or not os.path.isdir(new_internal):
        raise RuntimeError("В архиве нет Ogranka и _internal.")
    temp = os.path.dirname(archive)
    helper = os.path.join(temp, "install.sh")
    script = f"""#!/bin/sh
set -u
pid={os.getpid()}
dir={shlex.quote(target_dir)}
new={shlex.quote(extract)}
backup="$dir/.ogranka-backup.$$"
while kill -0 "$pid" 2>/dev/null; do sleep 1; done
mkdir -p "$backup"
[ -f "$dir/Ogranka" ] && cp -p "$dir/Ogranka" "$backup/Ogranka"
[ -d "$dir/_internal" ] && cp -a "$dir/_internal" "$backup/_internal"
[ -f "$dir/run-ogranka.sh" ] && cp -p "$dir/run-ogranka.sh" "$backup/run-ogranka.sh"
ok=1
cp -f "$new/Ogranka" "$dir/Ogranka" || ok=0
if [ "$ok" -eq 1 ]; then
  rm -rf "$dir/_internal"
  cp -a "$new/_internal" "$dir/_internal" || ok=0
fi
if [ "$ok" -eq 1 ] && [ -f "$new/run-ogranka.sh" ]; then
  cp -f "$new/run-ogranka.sh" "$dir/run-ogranka.sh" || ok=0
  chmod +x "$dir/run-ogranka.sh" 2>/dev/null || true
fi
if [ "$ok" -ne 1 ]; then
  [ -f "$backup/Ogranka" ] && cp -p "$backup/Ogranka" "$dir/Ogranka"
  rm -rf "$dir/_internal"
  [ -d "$backup/_internal" ] && cp -a "$backup/_internal" "$dir/_internal"
  [ -f "$backup/run-ogranka.sh" ] && cp -p "$backup/run-ogranka.sh" "$dir/run-ogranka.sh"
fi
chmod +x "$dir/Ogranka" 2>/dev/null || true
cd "$dir" || true
nohup "$dir/Ogranka" "$@" >/dev/null 2>&1 &
sleep 2
rm -rf "$backup" {shlex.quote(temp)}
"""
    with open(helper, "w", encoding="utf-8") as fh:
        fh.write(script)
    os.chmod(helper, 0o755)
    subprocess.Popen(
        ["/bin/sh", helper, *_launch_args()],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        close_fds=True,
    )


def _install_appimage(archive, info):
    context = _platform_context()
    target = context["target"]
    temp = os.path.dirname(archive)
    helper = os.path.join(temp, "install.sh")
    script = f"""#!/bin/sh
set -u
pid={os.getpid()}
target={shlex.quote(target)}
new={shlex.quote(archive)}
backup="$target.old.$$"
while kill -0 "$pid" 2>/dev/null; do sleep 1; done
if mv "$target" "$backup" 2>/dev/null; then
  if cp -f "$new" "$target" 2>/dev/null; then
    chmod +x "$target" 2>/dev/null || true
  else
    rm -f "$target"
    mv "$backup" "$target" 2>/dev/null || true
  fi
else
  cp -f "$new" "$target" 2>/dev/null || true
  chmod +x "$target" 2>/dev/null || true
fi
if [ -x "$target" ]; then
  nohup "$target" "$@" >/dev/null 2>&1 &
fi
sleep 2
rm -f "$backup"
rm -rf {shlex.quote(temp)}
"""
    with open(helper, "w", encoding="utf-8") as fh:
        fh.write(script)
    os.chmod(helper, 0o755)
    subprocess.Popen(
        ["/bin/sh", helper, *_launch_args()],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        close_fds=True,
    )


def _update_temp_dir(context):
    parent = str((context or {}).get("parent") or "")
    if not parent or not os.path.isdir(parent):
        raise RuntimeError("Не удалось найти папку приложения для обновления.")
    return tempfile.mkdtemp(prefix=".ogranka-update-", dir=parent)


def _install(info):
    global _ACTIVE
    temp = ""
    try:
        context = _platform_context()
        temp = _update_temp_dir(context)
        name = str(info.get("asset_name") or "update.bin")
        archive = os.path.join(temp, os.path.basename(name))
        used_delta = False
        verified = False
        if info.get("delta_url"):
            try:
                used_delta = _download_delta(info, archive, context)
            except Exception:
                used_delta = False
                _set_state(
                    "downloading",
                    0.02,
                    "Продолжаю загрузку обновления.",
                )
            if used_delta:
                try:
                    _verify(archive, info)
                    verified = True
                except CorruptUpdateError:
                    used_delta = False
                    try:
                        os.remove(archive)
                    except OSError:
                        pass
                    _set_state(
                        "downloading",
                        0.02,
                        "Дельта не совпала, скачиваю полный архив.",
                    )
        if not used_delta:
            _download(info["asset_url"], archive, 0.02, 0.88)
        if not verified:
            _verify(archive, info)
        _cache_asset(archive, context)
        if context["kind"] == "mac":
            _install_mac(archive, info)
        elif context["kind"] == "windows":
            _install_windows(archive, info)
        elif context["kind"] == "appimage":
            _install_appimage(archive, info)
        else:
            _install_linux(archive, info)
        _set_state(
            "restarting",
            1.0,
            "Обновление установлено. Перезапускаю приложение…",
        )
        time.sleep(0.8)
        os._exit(0)
    except Exception as exc:
        with _LOCK:
            _ACTIVE = False
        _set_state("error", detail="Не удалось установить обновление.", error=str(exc))
        shutil.rmtree(temp, ignore_errors=True)
