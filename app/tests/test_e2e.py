import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen


APP_DIR = Path(__file__).resolve().parents[1]
API_HEADERS = {"Content-Type": "application/json", "X-Ogranka": "1"}


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def read_json(url, data=None, headers=None):
    request = Request(url)
    if data is not None:
        request = Request(
            url,
            data=json.dumps(data).encode("utf-8"),
            headers=headers if headers is not None else API_HEADERS,
        )
    with urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


class EndToEndTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data_dir = tempfile.TemporaryDirectory()
        cls.port = free_port()
        env = os.environ.copy()
        env["OGRANKA_DATA"] = cls.data_dir.name
        env["PYTHONUNBUFFERED"] = "1"
        # OGRANKA_E2E_BINARY позволяет прогнать те же проверки на собранном приложении.
        binary = os.environ.get("OGRANKA_E2E_BINARY")
        command = [binary] if binary else [sys.executable, "app.py"]
        cls.process = subprocess.Popen(
            command + ["--port", str(cls.port), "--no-window", "--no-browser"],
            cwd=APP_DIR,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        cls.base = f"http://127.0.0.1:{cls.port}"
        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                read_json(cls.base + "/api/status")
                return
            except Exception:
                time.sleep(0.2)
        cls.tearDownClass()
        raise RuntimeError("сервер не запустился за 20 секунд")

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        try:
            cls.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            cls.process.kill()
            cls.process.wait(timeout=5)
        if cls.process.stdout:
            cls.process.stdout.close()
        cls.data_dir.cleanup()

    def wait_idle(self, timeout=90):
        deadline = time.time() + timeout
        while time.time() < deadline:
            status = read_json(self.base + "/api/status")
            if status.get("state") == "error":
                self.fail("конвейер завершился ошибкой: " + str(status.get("error")))
            if status.get("state") != "running":
                return status
            time.sleep(0.2)
        self.fail("конвейер не завершился вовремя")

    def test_demo_run_mesh_and_csv_export(self):
        read_json(
            self.base + "/api/run",
            {
                "sources": [{"kind": "demo", "name": "octa"}],
                "params": {
                    "noise": [0.008],
                    "methods": ["fft", "uni"],
                    "mode": "envelope",
                    "minimal": True,
                    "layers": 8,
                    "angles": 90,
                    "harmonics": 12,
                    "window": 5,
                    "noise_model": "angles",
                },
            },
        )
        status = self.wait_idle()
        self.assertEqual(status.get("state"), "done")

        models = read_json(self.base + "/api/results")["models"]
        self.assertTrue(models)
        results = models[-1]["results"]
        self.assertGreaterEqual(len(results), 3)
        kinds = {item.get("kind") for item in results}
        self.assertTrue({"ref", "hull", "min"} <= kinds, kinds)
        self.assertTrue(all("has_mesh" in item and "mesh" not in item for item in results))

        mesh = read_json(self.base + "/api/mesh?id=" + quote(results[-1]["id"]))
        self.assertTrue(mesh["mesh"]["v"])

        with urlopen(self.base + "/api/export.csv", timeout=10) as response:
            csv_text = response.read().decode("utf-8-sig")
        self.assertIn("модель", csv_text)
        self.assertIn("MSE", csv_text)

    def test_live_preview_and_levels(self):
        live = read_json(
            self.base + "/api/live",
            {"source": {"kind": "demo", "name": "cube"}, "params": {"noise": 0.01, "pct": 60, "layers": 10, "angles": 90}},
        )["result"]
        self.assertEqual(live["kind"], "live")
        self.assertGreaterEqual(live["faces"], 4)
        levels = read_json(self.base + "/api/levels", {"source": {"kind": "demo", "name": "icosa"}})
        self.assertTrue(levels["ok"])
        models = read_json(self.base + "/api/results")["models"]
        self.assertTrue(any(m.get("uid") == levels["uid"] for m in models))

    def test_upload_keeps_cyrillic_name(self):
        payload = b"v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nf 1 2 3\n"
        request = Request(
            self.base + "/api/upload",
            data=payload,
            headers={"X-Ogranka": "1", "X-Filename": quote("модель №1.obj")},
        )
        with urlopen(request, timeout=10) as response:
            result = json.loads(response.read().decode("utf-8"))
        self.assertEqual(result["name"], "модель _1.obj")
        self.assertTrue(os.path.isfile(result["path"]))
        with open(result["path"], "rb") as fh:
            self.assertEqual(fh.read(), payload)

    def test_post_requires_api_header(self):
        with self.assertRaises(HTTPError) as ctx:
            read_json(self.base + "/api/clear-cache", {}, headers={"Content-Type": "application/json"})
        self.assertEqual(ctx.exception.code, 403)

    def test_foreign_host_is_rejected(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            conn.request("GET", "/api/status", headers={"Host": "evil.example:80"})
            self.assertEqual(conn.getresponse().status, 403)
        finally:
            conn.close()

    def test_static_assets_are_versioned(self):
        with urlopen(self.base + "/", timeout=10) as response:
            html = response.read().decode("utf-8")
            self.assertIn("no-store", response.headers.get("Cache-Control", ""))
        self.assertNotIn("{{APP_VERSION}}", html)
        with urlopen(self.base + "/style.css?v=test", timeout=10) as response:
            self.assertIn("immutable", response.headers.get("Cache-Control", ""))
        with self.assertRaises(HTTPError) as ctx:
            urlopen(self.base + "/vendor/", timeout=10)
        self.assertEqual(ctx.exception.code, 404)


if __name__ == "__main__":
    unittest.main()
