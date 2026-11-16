import os
import random
import tempfile
import unittest

import delta


class DeltaTest(unittest.TestCase):
    def test_manifest_round_trip_and_reuse(self):
        source = random.Random(1)
        old = bytes(source.randrange(256) for _ in range(600 * 1024))
        new = old[:210_000] + b"changed middle block" + old[210_000:]
        with tempfile.TemporaryDirectory() as root:
            old_path = os.path.join(root, "old.bin")
            new_path = os.path.join(root, "new.bin")
            out_path = os.path.join(root, "out.bin")
            manifest_path = os.path.join(root, "new.bin.delta.json")
            with open(old_path, "wb") as fh:
                fh.write(old)
            with open(new_path, "wb") as fh:
                fh.write(new)
            delta.write_manifest(new_path, manifest_path)
            manifest = delta.load_manifest(manifest_path)
            ranges = []

            def fetch(offset, length):
                ranges.append((offset, length))
                return new[offset:offset + length]

            stats = delta.reconstruct(old_path, manifest, fetch, out_path)
            with open(out_path, "rb") as fh:
                self.assertEqual(fh.read(), new)
            self.assertGreater(stats["reused"], 0)
            self.assertGreater(stats["downloaded"], 0)
            self.assertLess(stats["downloaded"], len(new))
            self.assertTrue(ranges)

    def test_manifest_rejects_unknown_algorithm(self):
        manifest = {
            "format": delta.FORMAT,
            "algorithm": "other",
            "chunks": [],
        }
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(ValueError):
                delta.reconstruct("", manifest, lambda offset, length: b"", os.path.join(root, "out"))
