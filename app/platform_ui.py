"""Platform-specific window and About helpers."""
import os
import platform
import shutil
import subprocess
import threading
import time

from config import APP_ADVISOR, APP_AFFILIATION, APP_AUTHOR, APP_VERSION


def console_print(*args, **kwargs):
    try:
        print(*args, **kwargs, flush=True)
    except Exception:
        pass


def _browser_executable():
    if platform.system() == "Linux":
        for name in (
            "google-chrome",
            "google-chrome-stable",
            "chromium",
            "chromium-browser",
            "microsoft-edge",
            "microsoft-edge-stable",
            "brave-browser",
            "vivaldi",
        ):
            path = shutil.which(name)
            if path:
                return path
        return None
    if platform.system() != "Windows":
        return None
    roots = [
        os.environ.get("ProgramFiles(x86)"),
        os.environ.get("ProgramFiles"),
        os.environ.get("LOCALAPPDATA"),
    ]
    relative = (
        ("Microsoft", "Edge", "Application", "msedge.exe"),
        ("Google", "Chrome", "Application", "chrome.exe"),
    )
    seen = set()
    for root in roots:
        if not root:
            continue
        for rel in relative:
            path = os.path.join(root, *rel)
            if path in seen:
                continue
            seen.add(path)
            if os.path.isfile(path):
                return path
    for name in ("msedge.exe", "chrome.exe"):
        path = shutil.which(name)
        if path:
            return path
    try:
        import winreg
    except Exception:
        return None
    for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        for name in ("msedge.exe", "chrome.exe"):
            try:
                key_name = r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths" + "\\" + name
                with winreg.OpenKey(hive, key_name) as key:
                    path, _ = winreg.QueryValueEx(key, "")
                if path and os.path.isfile(path):
                    return path
            except Exception:
                pass
    return None


_MAC_ABOUT_HANDLER = None


def setup_macos_about():
    global _MAC_ABOUT_HANDLER
    if platform.system() != "Darwin":
        return
    try:
        from AppKit import (
            NSAboutPanelOptionApplicationName,
            NSAboutPanelOptionApplicationVersion,
            NSAboutPanelOptionCredits,
            NSAboutPanelOptionVersion,
            NSApplication,
            NSAttributedString,
            NSObject,
        )
        from PyObjCTools import AppHelper
    except Exception as exc:
        console_print("Не удалось настроить окно «О программе»:", exc)
        return

    class AboutHandler(NSObject):
        def showAbout_(self, sender):
            credits = NSAttributedString.alloc().initWithString_(
                f"Создатель: {APP_AUTHOR}\n{APP_AFFILIATION}\nНаучный руководитель: {APP_ADVISOR}"
            )
            NSApplication.sharedApplication().orderFrontStandardAboutPanelWithOptions_(
                {
                    NSAboutPanelOptionApplicationName: "Огранка",
                    NSAboutPanelOptionApplicationVersion: APP_VERSION,
                    NSAboutPanelOptionVersion: APP_VERSION,
                    NSAboutPanelOptionCredits: credits,
                }
            )

    _MAC_ABOUT_HANDLER = AboutHandler.alloc().init()

    def install():
        try:
            menu = NSApplication.sharedApplication().mainMenu()
            if not menu:
                return False
            app_menu = menu.itemAtIndex_(0).submenu()
            if not app_menu:
                return False
            for item in app_menu.itemArray():
                action = item.action()
                if action and "orderFrontStandardAboutPanel" in str(action):
                    item.setTarget_(_MAC_ABOUT_HANDLER)
                    item.setAction_("showAbout:")
                    return True
        except Exception:
            pass
        return False

    def attempt(n=0):
        if install() or n >= 30:
            return
        AppHelper.callLater(0.15, attempt, n + 1)

    def start():
        time.sleep(0.4)
        AppHelper.callAfter(attempt)

    threading.Thread(target=start, daemon=True).start()


def open_linux_window(url, profile):
    for name in (
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
        "microsoft-edge",
        "microsoft-edge-stable",
        "brave-browser",
        "vivaldi",
    ):
        exe = shutil.which(name)
        if not exe:
            continue
        try:
            os.makedirs(profile, exist_ok=True)
            return subprocess.Popen(
                [
                    exe,
                    f"--app={url}",
                    "--window-size=1440,940",
                    f"--user-data-dir={profile}",
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--disable-features=Translate",
                ]
            )
        except Exception:
            continue
    exe = shutil.which("firefox")
    if exe:
        try:
            return subprocess.Popen([exe, "--new-window", url])
        except Exception:
            return None
    return None


def open_windows_window(url, profile):
    exe = _browser_executable()
    if not exe:
        return None
    try:
        os.makedirs(profile, exist_ok=True)
        return subprocess.Popen(
            [
                exe,
                f"--app={url}",
                "--window-size=1440,940",
                f"--user-data-dir={profile}",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-features=Translate",
            ]
        )
    except Exception as exc:
        console_print("Не удалось открыть окно:", exc)
        return None
