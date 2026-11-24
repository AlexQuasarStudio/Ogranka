"""Огранка: локальный сервер конвейера и окно интерфейса.

Запуск:  python app.py [--port 8765] [--no-window] [--no-browser] [--self-test]
Зависимости: numpy, Qhull (встроенный ``_qhull``), fast-simplification.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import sys
import threading
import time
import traceback
import webbrowser

import jobs
import paths
from config import APP_BUILD, APP_TITLE, APP_VERSION
from platform_ui import console_print, open_linux_window, open_windows_window, setup_macos_about
from server import make_server
from versioning import build_number

WINDOW = {"width": 1440, "height": 940, "min_size": (880, 560), "maximized": True}


def remember_build() -> None:
    """Detect the first start after an update (shows the «установлено» toast)."""
    current = build_number(APP_BUILD)
    existed = os.path.isdir(paths.DATA)
    previous = 0
    try:
        with open(paths.LAST_BUILD_FILE, encoding="utf-8") as fh:
            previous = build_number(fh.read())
    except OSError:
        pass
    updated = previous > 0 and current > previous
    if not previous and paths.FROZEN and existed:
        # Версии до 1.0.1 не записывали номер сборки.
        updated = True
    try:
        os.makedirs(paths.DATA, exist_ok=True)
        with open(paths.LAST_BUILD_FILE, "w", encoding="utf-8") as fh:
            fh.write(str(current))
    except OSError:
        pass
    with jobs.LOCK:
        jobs.STATE["previous_build"] = previous
        jobs.STATE["just_updated"] = updated


# ---------------------------------------------------------------- самопроверка


def self_test(report_path: str | None = None) -> int:
    """Smoke test of a build: Qhull, decimation, a tiny pipeline and static files."""
    report = {"version": APP_VERSION, "build": APP_BUILD, "python": sys.version.split()[0]}
    started = time.time()
    try:
        import numpy as np

        from core import pipeline
        from core.simplify import HAS_FAST
        from jobs import RunParams, _run_model
        from live import live_variant
        from qhull_compat import ConvexHull

        report["numpy"] = np.__version__
        report["qhull_points"] = int(len(ConvexHull(np.random.default_rng(0).random((64, 3))).vertices))
        if not HAS_FAST:
            raise RuntimeError("fast_simplification недоступен")
        for name in ("index.html", "style.css", "app.js", "vendor/three.min.js"):
            if not os.path.isfile(os.path.join(paths.STATIC, name)):
                raise RuntimeError(f"нет файла интерфейса: {name}")
        jobs.STATE["job"] = {"state": "running", "started": time.time()}
        params = RunParams({
            "noise": [0.008], "methods": ["fft", "uni"], "layers": 12, "angles": 120,
            "harmonics": 12, "minimal": True,
        })
        title, results = _run_model(0, 1, {"kind": "demo", "name": "diamond"}, params)
        kinds = sorted({r["kind"] for r in results})
        if "hull" not in kinds or "min" not in kinds:
            raise RuntimeError(f"неполный результат: {kinds}")
        preview = live_variant(
            {"kind": "demo", "name": "octa"},
            {"noise": 0.008, "pct": 50, "layers": 12, "angles": 120, "harmonics": 12},
        )
        report.update(
            model=title,
            results=len(results),
            kinds=kinds,
            live_faces=preview["faces"],
            edges=len(pipeline.mesh_edges([[0, 1, 2, 3]])),
        )
        import updater  # noqa: F401  (проверяем, что модуль обновления собран)
        import delta

        delta_chunks = sum(1 for _ in delta.chunks(bytes(range(256)) * 512))
        report["delta_chunks"] = delta_chunks
        report["ok"] = True
    except Exception as exc:
        report["ok"] = False
        report["error"] = f"{type(exc).__name__}: {exc}"
        report["traceback"] = traceback.format_exc()
    report["seconds"] = round(time.time() - started, 2)
    text = json.dumps(report, ensure_ascii=False, indent=2)
    console_print(text)
    if report_path:
        with open(report_path, "w", encoding="utf-8") as fh:
            fh.write(text)
    return 0 if report["ok"] else 1


# ---------------------------------------------------------------- окно


def _linux_window_backend():
    try:
        import gi

        gi.require_version("Gtk", "3.0")
        for webkit in ("4.1", "4.0"):
            try:
                gi.require_version("WebKit2", webkit)
                break
            except ValueError:
                continue
        from gi.repository import Gtk, WebKit2  # noqa: F401

        return "gtk"
    except Exception:
        pass
    for module in ("PyQt5.QtWebEngineWidgets", "PySide6.QtWebEngineWidgets"):
        try:
            __import__(module)
            return "qt"
        except Exception:
            continue
    return None


def _wait_forever() -> None:
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        console_print("\nОстановлено")


def _wait_browser(proc, srv) -> None:
    try:
        proc.wait()
    except KeyboardInterrupt:
        console_print("\nОстановлено")
    finally:
        try:
            proc.terminate()
        except Exception:
            pass
        srv.shutdown()


def _open_webview(url: str, gui=None) -> None:
    import webview

    from native import Api

    webview.create_window(APP_TITLE, url, js_api=Api(), **WINDOW)
    if gui:
        webview.start(gui=gui)
    else:
        webview.start()


def open_window(url: str, srv, allow_browser: bool) -> None:
    """Native window → app-mode browser window → default browser."""
    system = platform.system()
    if system == "Windows":
        try:
            _open_webview(url, "edgechromium")
            return
        except Exception as exc:
            console_print("Встроенное окно WebView2 недоступно, запускаю Edge/Chrome:", exc)
        proc = open_windows_window(url, paths.BROWSER_PROFILE)
        if proc is not None:
            _wait_browser(proc, srv)
            return
    else:
        if system == "Linux":
            for extra in (
                "/usr/lib/python3/dist-packages",
                "/usr/lib/python3.12/dist-packages",
                "/usr/lib/python3.11/dist-packages",
                "/usr/lib/python3.10/dist-packages",
            ):
                if os.path.isdir(extra) and extra not in sys.path:
                    sys.path.append(extra)
        try:
            setup_macos_about()
            gui = _linux_window_backend() if system == "Linux" else None
            if system == "Linux" and not gui:
                raise RuntimeError("не найдены GTK/WebKit или Qt")
            _open_webview(url, gui)
            return
        except Exception as exc:
            console_print("Встроенное окно недоступно, открываю отдельное окно:", exc)
            if system == "Linux":
                proc = open_linux_window(url, paths.BROWSER_PROFILE)
                if proc is not None:
                    _wait_browser(proc, srv)
                    return
    if allow_browser:
        webbrowser.open(url)
    _wait_forever()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=APP_TITLE)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true", help="не открывать браузер")
    ap.add_argument("--no-window", action="store_true", help="без отдельного окна")
    ap.add_argument("--self-test", action="store_true", help="проверить сборку и выйти")
    ap.add_argument("--self-test-report", metavar="FILE", help="куда записать отчёт самопроверки")
    ap.add_argument("--version", action="version", version=f"Огранка {APP_VERSION} (сборка {APP_BUILD})")
    args, _unknown = ap.parse_known_args(argv)  # macOS может передать -psn_…
    if args.self_test:
        return self_test(args.self_test_report)

    remember_build()
    paths.ensure_dirs()
    models = jobs.load_all_models()
    with jobs.LOCK:
        jobs.STATE["models"] = models
    if models:
        console_print("загружены сохранённые результаты:", len(models), "модел(ей)")
    srv = make_server(args.port)
    url = f"http://127.0.0.1:{srv.server_address[1]}/"
    console_print("Огранка запущена:", url)
    console_print("Данные:", paths.DATA)
    if args.no_window:
        if not args.no_browser:
            threading.Timer(0.7, lambda: webbrowser.open(url)).start()
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            console_print("\nОстановлено")
        return 0
    threading.Thread(target=srv.serve_forever, name="ogranka-http", daemon=True).start()
    open_window(url, srv, allow_browser=not args.no_browser)
    return 0


if __name__ == "__main__":
    sys.exit(main())
