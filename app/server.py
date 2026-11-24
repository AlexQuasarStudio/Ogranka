"""Локальный HTTP-сервер: статика интерфейса и JSON API."""
from __future__ import annotations

import json
import os
import re
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

import jobs
import live
import paths
import releases
import updater
from config import APP_BUILD, APP_VERSION
from platform_ui import console_print
from sources import DEMO_NAMES, scan_folder

API_HEADER = "X-Ogranka"
"""POST-запросы API обязаны нести этот заголовок: чужая страница в браузере
не может добавить его без CORS-предзапроса, поэтому CSRF на локальный сервер
невозможен."""

MAX_UPLOAD = 120 * 1024 * 1024
MAX_JSON = 4 * 1024 * 1024
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "[::1]"}
SAFE_NAME = re.compile(r"[^\w.\- ()\[\]+@,]+", re.UNICODE)


class ApiError(Exception):
    def __init__(self, message: str, code: int = 400):
        super().__init__(message)
        self.code = code


def _flag(query: dict, name: str) -> bool:
    return query.get(name, ["0"])[0].lower() in ("1", "true", "yes")


def safe_filename(raw: str, default: str = "upload.obj") -> str:
    """Basename of a client file name without path or control characters."""
    name = os.path.basename(unquote(raw or "").replace("\\", "/"))
    name = SAFE_NAME.sub("_", name).strip(" .")
    return name[:180] or default


class Handler(SimpleHTTPRequestHandler):
    server_version = "Ogranka"
    sys_version = ""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=paths.STATIC, **kwargs)

    def log_message(self, fmt, *args):  # noqa: D401 - тихий сервер
        pass

    # ------------------------------------------------------------ общие ответы

    def end_headers(self):
        if getattr(self, "_immutable", False):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def _send(self, data: bytes, content_type: str, code: int = 200, headers=None):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def _json(self, obj, code: int = 200):
        data = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self._send(data, "application/json; charset=utf-8", code)

    def _host_ok(self) -> bool:
        """Reject foreign Host headers (защита от DNS rebinding)."""
        host = (self.headers.get("Host") or "").strip().lower()
        if not host:
            return False
        name = host.rsplit(":", 1)[0] if not host.endswith("]") else host
        return name in LOOPBACK_HOSTS

    def _body(self, limit: int = MAX_JSON) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        if length > limit:
            raise ApiError("слишком большой запрос", 413)
        return self.rfile.read(length) if length > 0 else b""

    def _json_body(self) -> dict:
        raw = self._body()
        if not raw:
            return {}
        try:
            body = json.loads(raw)
        except ValueError as exc:
            raise ApiError("некорректный JSON") from exc
        if not isinstance(body, dict):
            raise ApiError("ожидался JSON-объект")
        return body

    # ------------------------------------------------------------ статика

    def list_directory(self, path):  # без листинга каталогов
        self.send_error(404)
        return None

    def _serve_index(self):
        try:
            with open(os.path.join(paths.STATIC, "index.html"), encoding="utf-8") as fh:
                html = fh.read()
        except OSError:
            self.send_error(404)
            return
        with jobs.LOCK:
            updated = "1" if jobs.STATE.get("just_updated") else "0"
            jobs.STATE["just_updated"] = False
        html = (
            html.replace("{{APP_VERSION}}", APP_VERSION)
            .replace("{{APP_BUILD}}", APP_BUILD)
            .replace("{{JUST_UPDATED}}", updated)
        )
        self._send(html.encode("utf-8"), "text/html; charset=utf-8")

    # ------------------------------------------------------------ маршрутизация

    def do_GET(self):
        if not self._host_ok():
            self.send_error(403)
            return
        url = urlparse(self.path)
        self._immutable = False
        route = GET_ROUTES.get(url.path)
        if route is None:
            if url.path in ("/", "/index.html"):
                return self._serve_index()
            if url.path.startswith("/api/"):
                return self._json({"error": "неизвестный запрос"}, 404)
            # Ресурсы с ?v=версия неизменны: браузер может держать их в кэше.
            self._immutable = "v=" in url.query
            return super().do_GET()
        try:
            return route(self, parse_qs(url.query))
        except ApiError as exc:
            return self._json({"error": str(exc)}, exc.code)
        except Exception as exc:  # pragma: no cover - защитная ветка
            console_print("Ошибка API:", exc)
            return self._json({"error": str(exc)}, 500)

    def do_HEAD(self):
        if not self._host_ok():
            self.send_error(403)
            return
        super().do_HEAD()

    def do_POST(self):
        self._immutable = False
        if not self._host_ok() or self.headers.get(API_HEADER) != "1":
            self.send_error(403)
            return
        url = urlparse(self.path)
        route = POST_ROUTES.get(url.path)
        if route is None:
            return self._json({"error": "неизвестный запрос"}, 404)
        try:
            return route(self)
        except ApiError as exc:
            return self._json({"error": str(exc)}, exc.code)
        except Exception as exc:
            console_print("Ошибка API:", exc)
            return self._json({"error": str(exc)}, 500)

    # ------------------------------------------------------------ GET

    def api_version(self, _q):
        self._json({"version": APP_VERSION, "build": APP_BUILD})

    def api_welcome_get(self, _q):
        self._json({"seen": os.path.exists(paths.WELCOME_FILE)})

    def api_status(self, _q):
        with jobs.LOCK:
            job = dict(jobs.STATE["job"] or {"state": "idle"})
        self._json(job)

    def api_results(self, _q):
        self._json({"models": jobs.public_models()})

    def api_changelog(self, q):
        self._json(releases.changelog_info(_flag(q, "force")))

    def api_update(self, q):
        self._json(releases.update_info(_flag(q, "force")))

    def api_update_status(self, _q):
        self._json(updater.status())

    def api_issues(self, q):
        self._json(releases.github_issues(_flag(q, "force")))

    def api_mesh(self, q):
        result = jobs.find_result(q.get("id", [""])[0])
        if result is None:
            raise ApiError("нет результата", 404)
        self._json(result)

    def api_csv(self, _q):
        data = jobs.csv_text().encode("utf-8-sig")
        self._send(
            data,
            "text/csv; charset=utf-8",
            headers={"Content-Disposition": "attachment; filename=metrics.csv"},
        )

    def api_demo(self, _q):
        self._json(DEMO_NAMES)

    # ------------------------------------------------------------ POST

    def api_update_install(self):
        self._body()
        if jobs.is_running():
            raise ApiError("Дождитесь завершения расчёта.", 409)
        try:
            state = updater.start_install(releases.update_info(False))
        except RuntimeError as exc:
            raise ApiError(str(exc), 409) from exc
        self._json({"ok": True, **state})

    def api_welcome_post(self):
        self._body()
        with open(paths.WELCOME_FILE, "w", encoding="utf-8") as fh:
            fh.write("1")
        self._json({"ok": True})

    def api_clear_cache(self):
        self._body()
        if not jobs.clear_all():
            raise ApiError("Идёт расчёт — очистка недоступна.", 409)
        live.clear_live()
        self._json({"ok": True})

    def api_folder(self):
        body = self._json_body()
        folder = body.get("path")
        if not folder or not isinstance(folder, str):
            raise ApiError("не выбрана папка")
        try:
            sources = scan_folder(folder)
        except ValueError as exc:
            raise ApiError(str(exc)) from exc
        if not sources:
            raise ApiError("в папке нет файлов .obj или .txt")
        self._json({"sources": sources, "folder": os.path.abspath(os.path.expanduser(folder))})

    def api_upload(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_UPLOAD:
            raise ApiError("файл больше 120 МБ", 413)
        name = safe_filename(self.headers.get("X-Filename", ""))
        os.makedirs(paths.UPLOADS, exist_ok=True)
        path = os.path.join(paths.UPLOADS, uuid.uuid4().hex[:10] + "_" + name)
        remaining = length
        with open(path, "wb") as fh:
            while remaining > 0:
                chunk = self.rfile.read(min(1 << 20, remaining))
                if not chunk:
                    break
                fh.write(chunk)
                remaining -= len(chunk)
        if remaining:
            os.remove(path)
            raise ApiError("загрузка оборвалась")
        self._json({"path": path, "name": name})

    def api_levels(self):
        body = self._json_body()
        source = body.get("source")
        if not source:
            raise ApiError("не выбрана модель")
        if jobs.is_running():
            raise ApiError("уже выполняется", 409)
        model = jobs.build_levels(source)
        self._json({"ok": True, "name": model["name"], "id": model["id"], "uid": model["uid"]})

    def api_live(self):
        body = self._json_body()
        source = body.get("source")
        if not source:
            raise ApiError("не выбрана модель")
        if jobs.is_running():
            raise ApiError("конвейер уже выполняется", 409)
        params = body.get("params") or {}
        self._json({"result": live.live_variant(source, params if isinstance(params, dict) else {})})

    def api_run(self):
        body = self._json_body()
        sources = body.get("sources") or [body.get("source")]
        sources = [s for s in sources if isinstance(s, dict)]
        if not sources:
            raise ApiError("не выбрана модель")
        if not jobs.start_run(sources, body.get("params") or {}):
            raise ApiError("уже выполняется", 409)
        self._json({"ok": True})


GET_ROUTES = {
    "/api/version": Handler.api_version,
    "/api/welcome": Handler.api_welcome_get,
    "/api/status": Handler.api_status,
    "/api/results": Handler.api_results,
    "/api/changelog": Handler.api_changelog,
    "/api/update": Handler.api_update,
    "/api/update/status": Handler.api_update_status,
    "/api/github/issues": Handler.api_issues,
    "/api/mesh": Handler.api_mesh,
    "/api/export.csv": Handler.api_csv,
    "/api/demo": Handler.api_demo,
}

POST_ROUTES = {
    "/api/update/install": Handler.api_update_install,
    "/api/welcome": Handler.api_welcome_post,
    "/api/clear-cache": Handler.api_clear_cache,
    "/api/folder": Handler.api_folder,
    "/api/upload": Handler.api_upload,
    "/api/levels": Handler.api_levels,
    "/api/live": Handler.api_live,
    "/api/run": Handler.api_run,
}


def make_server(port: int) -> ThreadingHTTPServer:
    """Bind to loopback; fall back to a free port when ``port`` is busy."""
    try:
        return ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError as exc:
        console_print("Порт", port, "занят, выбираю свободный:", exc)
        return ThreadingHTTPServer(("127.0.0.1", 0), Handler)
