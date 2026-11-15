import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.request import Request, urlopen


APP_DIR = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def read_json(url, data=None):
    request = Request(url)
    if data is not None:
        request = Request(
            url,
            data=json.dumps(data).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
    with urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


class EndToEndTest(unittest.TestCase):
    def test_demo_run_and_csv_export(self):
        with tempfile.TemporaryDirectory() as data_dir:
            port = free_port()
            env = os.environ.copy()
            env["OGRANKA_DATA"] = data_dir
            env["PYTHONUNBUFFERED"] = "1"
            process = subprocess.Popen(
                [
                    sys.executable,
                    "app.py",
                    "--port",
                    str(port),
                    "--no-window",
                    "--no-browser",
                ],
                cwd=APP_DIR,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            base = f"http://127.0.0.1:{port}"
            try:
                deadline = time.time() + 20
                while time.time() < deadline:
                    try:
                        read_json(base + "/api/status")
                        break
                    except Exception:
                        time.sleep(0.2)
                else:
                    self.fail("сервер не запустился за 20 секунд")

                read_json(
                    base + "/api/run",
                    {
                        "sources": [{"kind": "demo", "name": "octa"}],
                        "params": {
                            "noise": [0.008],
                            "methods": ["fft"],
                            "mode": "envelope",
                            "minimal": False,
                            "layers": 8,
                            "angles": 90,
                            "harmonics": 12,
                            "window": 5,
                            "noise_model": "angles",
                        },
                    },
                )

                deadline = time.time() + 60
                while time.time() < deadline:
                    status = read_json(base + "/api/status")
                    if status.get("state") == "error":
                        self.fail("конвейер завершился ошибкой: " + str(status.get("error")))
                    if status.get("state") != "running":
                        break
                    time.sleep(0.2)
                else:
                    self.fail("конвейер не завершился за 60 секунд")

                models = read_json(base + "/api/results")["models"]
                self.assertTrue(models)
                results = models[0]["results"]
                self.assertGreaterEqual(len(results), 2)
                self.assertTrue(any(item.get("kind") == "ref" for item in results))
                self.assertTrue(any(item.get("kind") == "hull" for item in results))
                self.assertTrue(all("has_mesh" in item for item in results))

                with urlopen(base + "/api/export.csv", timeout=10) as response:
                    csv_text = response.read().decode("utf-8-sig")
                self.assertIn("модель", csv_text)
                self.assertIn("MSE", csv_text)
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
                if process.stdout:
                    process.stdout.close()
