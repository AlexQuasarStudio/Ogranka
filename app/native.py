"""Мост pywebview: системные диалоги, снимки окна и экрана."""
from __future__ import annotations

import base64
import os
import platform
import shutil
import subprocess
import tempfile
import threading
import webbrowser

import jobs


def _window():
    import webview

    return webview.windows[0] if webview.windows else None


def _png_data_url(data: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(data).decode("ascii")


def _ps_quote(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


class Api:
    """Methods exposed to JavaScript as ``window.pywebview.api``."""

    def open_url(self, url):
        if not isinstance(url, str) or not url.startswith(("https://", "http://")):
            return False
        webbrowser.open(url)
        return True

    def window_rect(self):
        try:
            win = _window()
            if win is None:
                return {}
            return {
                "x": int(getattr(win, "x", 0) or 0),
                "y": int(getattr(win, "y", 0) or 0),
                "width": int(getattr(win, "width", 0) or 0),
                "height": int(getattr(win, "height", 0) or 0),
            }
        except Exception:
            return {}

    def capture_app(self):
        """Native snapshot of the WebView on macOS (no screen-recording permission)."""
        if platform.system() != "Darwin":
            return {"unsupported": True}
        try:
            from AppKit import NSBitmapImageRep, NSPNGFileType
            from PyObjCTools import AppHelper
            from webview.platforms.cocoa import BrowserView
            from WebKit import WKSnapshotConfiguration

            win = _window()
            if win is None:
                return {"error": "нет окна"}
            browser = BrowserView.instances.get(getattr(win, "uid", None))
            if browser is None or browser.webview is None:
                return {"error": "окно ещё не готово"}
            result = {}
            done = threading.Event()

            def snapshot():
                try:
                    config = WKSnapshotConfiguration.alloc().init()
                    try:
                        config.setAfterScreenUpdates_(True)
                    except Exception:
                        pass

                    def completion(image, error):
                        try:
                            if error is not None or image is None:
                                result["error"] = "не удалось снять окно"
                                return
                            rep = NSBitmapImageRep.imageRepWithData_(image.TIFFRepresentation())
                            png = rep.representationUsingType_properties_(NSPNGFileType, None)
                            if png is None:
                                result["error"] = "не удалось сохранить снимок"
                                return
                            result["data"] = _png_data_url(bytes(png))
                        except Exception as exc:
                            result["error"] = str(exc)
                        finally:
                            done.set()

                    browser.webview.takeSnapshotWithConfiguration_completionHandler_(config, completion)
                except Exception as exc:
                    result["error"] = str(exc)
                    done.set()

            AppHelper.callAfter(snapshot)
            if not done.wait(12):
                return {"error": "окно не ответило"}
            return result
        except Exception as exc:
            return {"error": str(exc)}

    def capture_screen(self):
        temp = ""
        try:
            fd, temp = tempfile.mkstemp(prefix="ogranka-shot-", suffix=".png")
            os.close(fd)
            quiet = {"check": True, "timeout": 30, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
            system = platform.system()
            if system == "Darwin":
                subprocess.run(["screencapture", "-x", "-t", "png", temp], **quiet)
            elif system == "Windows":
                script = (
                    "Add-Type -AssemblyName System.Windows.Forms;"
                    "Add-Type -AssemblyName System.Drawing;"
                    "$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds;"
                    "$img=New-Object System.Drawing.Bitmap $b.Width,$b.Height;"
                    "$g=[System.Drawing.Graphics]::FromImage($img);"
                    "$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size);"
                    f"$img.Save({_ps_quote(temp)},[System.Drawing.Imaging.ImageFormat]::Png);"
                    "$g.Dispose();$img.Dispose()"
                )
                subprocess.run(["powershell.exe", "-NoProfile", "-Command", script], **quiet)
            else:
                commands = (
                    ("gnome-screenshot", ["gnome-screenshot", "-f", temp]),
                    ("spectacle", ["spectacle", "-b", "-n", "-o", temp]),
                    ("grim", ["grim", temp]),
                    ("import", ["import", "-window", "root", temp]),
                )
                for command, args in commands:
                    if shutil.which(command):
                        subprocess.run(args, **quiet)
                        break
                else:
                    raise RuntimeError("Не найден инструмент для скриншота.")
            with open(temp, "rb") as fh:
                data = fh.read()
            if not data:
                raise RuntimeError("Скриншот получился пустым.")
            return {"data": _png_data_url(data)}
        except Exception as exc:
            return {"error": str(exc)}
        finally:
            if temp:
                try:
                    os.remove(temp)
                except OSError:
                    pass

    def toggle_fullscreen(self):
        win = _window()
        if win is not None:
            win.toggle_fullscreen()
        return True

    def _save_dialog(self, filename, file_types):
        try:
            import webview

            win = _window()
            if win is None:
                return None, {"error": "нет окна"}
            dialog = getattr(webview, "FileDialog", None)
            kind = getattr(dialog, "SAVE", None) if dialog else None
            path = win.create_file_dialog(
                kind if kind is not None else webview.SAVE_DIALOG,
                save_filename=filename,
                file_types=file_types,
            )
        except Exception as exc:
            return None, {"error": str(exc)}
        if not path:
            return None, {"cancelled": True}
        if isinstance(path, (list, tuple)):
            path = path[0]
        return path, None

    def _write(self, filename, file_types, data, mode="w", encoding="utf-8", newline=None):
        path, error = self._save_dialog(filename, file_types)
        if error:
            return error
        try:
            if "b" in mode:
                with open(path, mode) as fh:
                    fh.write(data)
            else:
                with open(path, mode, encoding=encoding, newline=newline) as fh:
                    fh.write(data)
            return {"path": path}
        except Exception as exc:
            return {"error": str(exc)}

    def pick_folder(self):
        try:
            import webview

            win = _window()
            if win is None:
                return {"error": "нет окна"}
            dialog = getattr(webview, "FileDialog", None)
            kind = getattr(dialog, "FOLDER", None) if dialog else None
            result = win.create_file_dialog(kind if kind is not None else webview.FOLDER_DIALOG)
        except Exception as exc:
            return {"error": str(exc)}
        if not result:
            return {"cancelled": True}
        if isinstance(result, (list, tuple)):
            result = result[0]
        return {"path": result}

    def save_csv(self):
        return self._write("metrics.csv", ("CSV (*.csv)",), jobs.csv_text(), encoding="utf-8-sig", newline="")

    def save_png(self, data_url, filename="ogranka-view.png"):
        try:
            data = base64.b64decode(str(data_url).split(",", 1)[-1])
        except Exception as exc:
            return {"error": "не удалось прочитать PNG: " + str(exc)}
        return self._write(filename or "ogranka-view.png", ("PNG (*.png)",), data, mode="wb")

    def save_obj(self, text, filename="ogranka-model.obj"):
        return self._write(filename or "ogranka-model.obj", ("OBJ (*.obj)",), text)
