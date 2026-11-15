import json
import unittest
from unittest.mock import patch

import app


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class UpdateTest(unittest.TestCase):
    def test_version_key(self):
        self.assertEqual(app._version_key("v1.2.10"), (1, 2, 10))
        self.assertTrue(app._is_newer_version("1.2.10", "1.2.9"))
        self.assertFalse(app._is_newer_version("1.2.9", "1.2.10"))

    def test_release_notes_are_returned(self):
        payload = {
            "tag_name": "v1.0.1",
            "name": "Огранка 1.0.1",
            "html_url": "https://example.com/release",
            "body": "## Исправления\n- Патчноуты",
            "assets": [],
        }
        with patch("app.urlopen", return_value=FakeResponse(payload)):
            info = app._update_info(True)
        self.assertEqual(info["notes"], "## Исправления\n- Патчноуты")
        self.assertFalse(info["notes_truncated"])

    def test_release_notes_are_truncated(self):
        body = "я" * (app.UPDATE_NOTES_LIMIT + 50)
        payload = {
            "tag_name": "v1.0.1",
            "html_url": "https://example.com/release",
            "body": body,
            "assets": [],
        }
        with patch("app.urlopen", return_value=FakeResponse(payload)):
            info = app._update_info(True)
        self.assertEqual(len(info["notes"]), app.UPDATE_NOTES_LIMIT)
        self.assertTrue(info["notes_truncated"])
