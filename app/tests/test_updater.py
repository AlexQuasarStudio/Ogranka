import hashlib
import io
import os
import shutil
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import updater


class UpdaterTest(unittest.TestCase):
    def test_safe_extract_rejects_path_traversal(self):
        with tempfile.TemporaryDirectory() as root:
            archive = os.path.join(root, "bad.tar.gz")
            with tarfile.open(archive, "w:gz") as tar:
                info = tarfile.TarInfo("../evil.txt")
                payload = b"x"
                info.size = len(payload)
                tar.addfile(info, io.BytesIO(payload))
            with self.assertRaises(RuntimeError):
                updater._safe_extract_tar(archive, os.path.join(root, "out"))

    def test_safe_extract_extracts_regular_file(self):
        with tempfile.TemporaryDirectory() as root:
            archive = os.path.join(root, "ok.tar.gz")
            with tarfile.open(archive, "w:gz") as tar:
                info = tarfile.TarInfo("Ogranka")
                payload = b"binary"
                info.size = len(payload)
                tar.addfile(info, io.BytesIO(payload))
            out = os.path.join(root, "out")
            updater._safe_extract_tar(archive, out)
            with open(os.path.join(out, "Ogranka"), "rb") as fh:
                self.assertEqual(fh.read(), b"binary")

    def test_update_temp_dir_is_next_to_application(self):
        with tempfile.TemporaryDirectory() as root:
            path = updater._update_temp_dir({"parent": root})
            try:
                self.assertEqual(os.path.dirname(path), root)
                self.assertTrue(os.path.isdir(path))
            finally:
                shutil.rmtree(path, ignore_errors=True)

    def test_can_install_is_disabled_for_source_checkout(self):
        with patch.object(updater.sys, "frozen", False, create=True):
            ok, reason = updater.can_install("Ogranka-macos-1.0.1.zip", True)
        self.assertFalse(ok)
        self.assertEqual(reason, "dev")

    def test_can_install_accepts_writable_mac_bundle(self):
        with tempfile.TemporaryDirectory() as root:
            app = os.path.join(root, "Огранка.app")
            exe = os.path.join(app, "Contents", "MacOS", "Ogranka")
            os.makedirs(os.path.dirname(exe))
            open(exe, "wb").close()
            with patch.object(updater.sys, "frozen", True, create=True):
                with patch.object(updater.sys, "executable", exe):
                    with patch.object(updater.platform, "system", return_value="Darwin"):
                        ok, reason = updater.can_install("Ogranka-macos-1.0.1.zip", True)
        self.assertTrue(ok, reason)

    def test_can_install_accepts_running_appimage(self):
        with tempfile.TemporaryDirectory() as root:
            image = os.path.join(root, "Ogranka-linux-1.0.1.AppImage")
            open(image, "wb").close()
            with patch.object(updater.sys, "frozen", True, create=True):
                with patch.object(updater.sys, "executable", image):
                    with patch.object(updater.platform, "system", return_value="Linux"):
                        with patch.dict(os.environ, {"APPIMAGE": image}):
                            ok, reason = updater.can_install(
                                "Ogranka-linux-1.0.1.AppImage", True
                            )
        self.assertTrue(ok, reason)

    def test_verify_checksum_and_size(self):
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, "Ogranka-macos-1.0.1.zip")
            with open(path, "wb") as fh:
                fh.write(b"release payload")
            digest = hashlib.sha256(b"release payload").hexdigest()
            updater._verify(
                path,
                {
                    "asset_name": "Ogranka-macos-1.0.1.zip",
                    "asset_sha256": digest,
                    "asset_size": os.path.getsize(path),
                },
            )
        self.assertEqual(updater.status()["state"], "installing")

    def test_start_install_rejects_source_checkout(self):
        with patch.object(updater.sys, "frozen", False, create=True):
            with self.assertRaisesRegex(RuntimeError, "собранной"):
                updater.start_install(
                    {
                        "available": True,
                        "asset_name": "Ogranka-macos-1.0.1.zip",
                        "asset_sha256": "a" * 64,
                    }
                )


if __name__ == "__main__":
    unittest.main()
