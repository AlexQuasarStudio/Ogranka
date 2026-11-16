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
        self.assertTrue(app._is_newer_release("1.0.1", "45", "1.0.1", "44"))
        self.assertFalse(app._is_newer_release("1.0.1", "44", "1.0.1", "44"))
        self.assertTrue(app._is_newer_release("1.0.2", "", "1.0.1", "44"))

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

    def test_release_asset_metadata_for_auto_update(self):
        digest = "a" * 64
        payload = {
            "tag_name": "v1.0.2",
            "name": "Огранка 1.0.2 · сборка 49",
            "html_url": "https://example.com/release",
            "body": "## Обновление",
            "assets": [
                {
                    "name": "Ogranka-macos-1.0.2.zip",
                    "browser_download_url": "https://example.com/Ogranka-macos-1.0.2.zip",
                    "digest": "sha256:" + digest,
                    "size": 123,
                },
                {
                    "name": "Ogranka-macos-1.0.2.zip.delta.json",
                    "browser_download_url": "https://example.com/Ogranka-macos-1.0.2.zip.delta.json",
                    "size": 456,
                },
                {
                    "name": "SHA256SUMS.txt",
                    "browser_download_url": "https://example.com/SHA256SUMS.txt",
                },
            ],
        }
        with patch("app.platform.system", return_value="Darwin"):
            with patch("app.urlopen", return_value=FakeResponse(payload)):
                info = app._update_info(True)
        self.assertEqual(info["asset_name"], "Ogranka-macos-1.0.2.zip")
        self.assertEqual(info["asset_sha256"], digest)
        self.assertEqual(info["asset_size"], 123)
        self.assertEqual(
            info["delta_url"],
            "https://example.com/Ogranka-macos-1.0.2.zip.delta.json",
        )
        self.assertEqual(info["delta_name"], "Ogranka-macos-1.0.2.zip.delta.json")
        self.assertEqual(info["checksums_url"], "https://example.com/SHA256SUMS.txt")
        self.assertFalse(info["installable"])
        self.assertEqual(info["install_reason"], "dev")
        self.assertEqual(info["update_kind"], "version")

    def test_release_asset_prefers_appimage_when_running_appimage(self):
        release = {
            "assets": [
                {
                    "name": "Ogranka-linux-1.0.2.tar.gz",
                    "browser_download_url": "https://example.com/Ogranka-linux-1.0.2.tar.gz",
                },
                {
                    "name": "Ogranka-linux-1.0.2.AppImage",
                    "browser_download_url": "https://example.com/Ogranka-linux-1.0.2.AppImage",
                },
            ]
        }
        with patch("app.platform.system", return_value="Linux"):
            with patch("app.updater.is_appimage", return_value=True):
                asset = app._release_asset(release)
        self.assertEqual(asset["name"], "Ogranka-linux-1.0.2.AppImage")

    def test_same_version_newer_build_is_a_build_update(self):
        payload = {
            "tag_name": "v1.0.1",
            "name": "Огранка 1.0.1 · сборка 49",
            "html_url": "https://example.com/release",
            "body": "## Новая сборка",
            "assets": [],
        }
        with patch("app.urlopen", return_value=FakeResponse(payload)):
            info = app._update_info(True)
        self.assertTrue(info["available"])
        self.assertEqual(info["update_kind"], "build")

    def test_changelog_returns_published_releases(self):
        payload = [
            {
                "tag_name": "v1.0.2",
                "name": "Огранка 1.0.2 · сборка 45",
                "html_url": "https://example.com/v1.0.2",
                "published_at": "2026-11-16T10:00:00Z",
                "body": "## Новое\n- История",
                "draft": False,
                "prerelease": False,
            },
            {
                "tag_name": "v1.0.1",
                "name": "Огранка 1.0.1",
                "html_url": "https://example.com/v1.0.1",
                "published_at": "2026-11-15T10:00:00Z",
                "body": "",
                "draft": False,
                "prerelease": False,
            },
            {
                "tag_name": "v1.0.0",
                "name": "Черновик",
                "draft": True,
            },
        ]
        with patch("app.urlopen", return_value=FakeResponse(payload)):
            info = app._changelog_info(True)
        self.assertTrue(info["checked"])
        self.assertEqual(len(info["releases"]), 2)
        self.assertEqual(info["releases"][0]["version"], "1.0.2")
        self.assertEqual(info["releases"][0]["build"], "45")
        self.assertEqual(info["releases"][0]["notes"], "## Новое\n- История")
        self.assertFalse(info["releases"][1]["notes"])
