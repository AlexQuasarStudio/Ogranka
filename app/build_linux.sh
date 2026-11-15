#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
ROOT="$(pwd)"
VERSION="$(python3 -c 'import config; print(config.APP_VERSION)')"
BUILD="$(python3 -c 'import config; print(config.APP_BUILD)')"

python3 build_version.py
python3 -m PyInstaller \
  --noconfirm --clean \
  --distpath dist_linux --workpath build_linux \
  OgrankaLinux.spec

PACKAGE="$ROOT/dist_linux/package"
rm -rf "$PACKAGE"
mkdir -p "$PACKAGE"
cp -a dist_linux/Ogranka/. "$PACKAGE"/
cp run-ogranka.sh "$PACKAGE"/
chmod +x "$PACKAGE/run-ogranka.sh" "$PACKAGE/Ogranka"
tar -czf "$ROOT/../Ogranka-linux-${VERSION}.tar.gz" -C "$PACKAGE" .

APPDIR="$ROOT/dist_linux/AppDir"
APPIMAGE="$ROOT/../Ogranka-linux-${VERSION}.AppImage"
APPIMAGETOOL="$ROOT/dist_linux/appimagetool-x86_64.AppImage"
if [ ! -x "$APPIMAGETOOL" ]; then
  curl -fL --retry 3 -o "$APPIMAGETOOL" \
    "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage"
  chmod +x "$APPIMAGETOOL"
fi
rm -rf "$APPDIR"
mkdir -p \
  "$APPDIR/usr/bin" \
  "$APPDIR/usr/share/applications" \
  "$APPDIR/usr/share/icons/hicolor/512x512/apps"
cp -a "$PACKAGE/Ogranka" "$PACKAGE/_internal" "$APPDIR/usr/bin/"
cp icon.png "$APPDIR/usr/share/icons/hicolor/512x512/apps/ogranka.png"
cp icon.png "$APPDIR/ogranka.png"
ln -s ogranka.png "$APPDIR/.DirIcon"
cp ogranka.desktop "$APPDIR/ogranka.desktop"
cp ogranka.desktop "$APPDIR/usr/share/applications/ogranka.desktop"
cp AppRun "$APPDIR/AppRun"
chmod +x "$APPDIR/AppRun"
ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 \
  "$APPIMAGETOOL" "$APPDIR" "$APPIMAGE"
chmod +x "$APPIMAGE"
echo "Готово: Ogranka-linux-${VERSION}.tar.gz и Ogranka-linux-${VERSION}.AppImage (сборка ${BUILD})"
