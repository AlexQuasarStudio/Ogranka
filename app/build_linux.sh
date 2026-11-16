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

APPDIR="$ROOT/dist_linux/AppDir"
APPIMAGE="$ROOT/../Ogranka-linux-${VERSION}.AppImage"
UPDATE_URL="https://github.com/AlexQuasarStudio/Ogranka/releases/download/v${VERSION}/Ogranka-linux-${VERSION}.AppImage.zsync"
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
  "$APPIMAGETOOL" -u "zsync|$UPDATE_URL" "$APPDIR" "$APPIMAGE"
chmod +x "$APPIMAGE"
if command -v zsyncmake >/dev/null 2>&1; then
  zsyncmake -u "$UPDATE_URL" -o "$APPIMAGE.zsync" "$APPIMAGE"
else
  echo "zsyncmake не найден: установите пакет zsync" >&2
  exit 1
fi
python3 build_delta.py "$APPIMAGE"
echo "Готово: Ogranka-linux-${VERSION}.AppImage, .AppImage.zsync и .delta.json (сборка ${BUILD})"
