#!/usr/bin/env python3
"""Build .delta.json manifests for release assets."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from delta import write_manifest


def main(argv):
    if len(argv) < 2:
        print("Использование: build_delta.py <asset> [asset ...]", file=sys.stderr)
        return 2
    for asset in argv[1:]:
        if not os.path.isfile(asset):
            print(f"Нет файла: {asset}", file=sys.stderr)
            return 1
        out = write_manifest(asset)
        print(f"Дельта-манифест: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
