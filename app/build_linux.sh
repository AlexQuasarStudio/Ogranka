#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
VERSION="$(python3 -c 'import config; print(config.APP_VERSION)')"
BUILD="$(python3 -c 'import config; print(config.APP_BUILD)')"

python3 -m PyInstaller \
  --noconfirm --clean \
  --distpath dist_linux --workpath build_linux \
  OgrankaLinux.spec

PACKAGE="dist_linux/package"
rm -rf "$PACKAGE"
mkdir -p "$PACKAGE"
cp -a dist_linux/Ogranka/. "$PACKAGE"/
cp run-ogranka.sh "$PACKAGE"/
chmod +x "$PACKAGE/run-ogranka.sh" "$PACKAGE/Ogranka"
tar -czf "../Ogranka-linux-${VERSION}.tar.gz" -C "$PACKAGE" .
echo "Готово: Ogranka-linux-${VERSION}.tar.gz (build ${BUILD})"
