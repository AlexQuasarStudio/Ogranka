#!/usr/bin/env bash
# Сборка AppImage для текущей архитектуры (x86_64 или arm64).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
ROOT="$(pwd)"
PYTHON="${PYTHON:-python3}"
VERSION="$("$PYTHON" -c 'import config; print(config.APP_VERSION)')"

"$PYTHON" build_version.py
BUILD="$("$PYTHON" -c 'import config; print(config.APP_BUILD)')"
"$PYTHON" -m PyInstaller \
  --noconfirm --clean --log-level WARN \
  --distpath dist_linux --workpath build_linux \
  ogranka.spec

BUNDLE="$ROOT/dist_linux/Ogranka"
chmod +x "$BUNDLE/Ogranka"
echo "Самопроверка сборки…"
"$BUNDLE/Ogranka" --self-test

case "$(uname -m)" in
  x86_64|amd64)
    APPIMAGE_ARCH="x86_64"
    APPIMAGE_SUFFIX=""
    ;;
  aarch64|arm64)
    APPIMAGE_ARCH="aarch64"
    APPIMAGE_SUFFIX="-arm64"
    ;;
  *)
    echo "Неподдерживаемая архитектура: $(uname -m)" >&2
    exit 1
    ;;
esac
NAME="Ogranka-linux-${VERSION}${APPIMAGE_SUFFIX}.AppImage"
APPIMAGE="$ROOT/../$NAME"
UPDATE_URL="https://github.com/AlexQuasarStudio/Ogranka/releases/download/v${VERSION}/${NAME}.zsync"
APPIMAGETOOL="$ROOT/dist_linux/appimagetool-${APPIMAGE_ARCH}.AppImage"
if [ ! -x "$APPIMAGETOOL" ]; then
  curl -fL --retry 3 -o "$APPIMAGETOOL" \
    "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-${APPIMAGE_ARCH}.AppImage"
  chmod +x "$APPIMAGETOOL"
fi

APPDIR="$ROOT/dist_linux/AppDir"
rm -rf "$APPDIR"
mkdir -p \
  "$APPDIR/usr/bin" \
  "$APPDIR/usr/share/applications" \
  "$APPDIR/usr/share/icons/hicolor/512x512/apps"
cp -a "$BUNDLE/Ogranka" "$BUNDLE/_internal" "$APPDIR/usr/bin/"
cp icon.png "$APPDIR/usr/share/icons/hicolor/512x512/apps/ogranka.png"
cp icon.png "$APPDIR/ogranka.png"
ln -s ogranka.png "$APPDIR/.DirIcon"
cp ogranka.desktop "$APPDIR/ogranka.desktop"
cp ogranka.desktop "$APPDIR/usr/share/applications/ogranka.desktop"
cp AppRun "$APPDIR/AppRun"
chmod +x "$APPDIR/AppRun"
ARCH="$APPIMAGE_ARCH" APPIMAGE_EXTRACT_AND_RUN=1 \
  "$APPIMAGETOOL" -u "zsync|$UPDATE_URL" "$APPDIR" "$APPIMAGE"
chmod +x "$APPIMAGE"

echo "Самопроверка AppImage…"
APPIMAGE_EXTRACT_AND_RUN=1 "$APPIMAGE" --self-test

if command -v zsyncmake >/dev/null 2>&1; then
  zsyncmake -u "$UPDATE_URL" -o "$APPIMAGE.zsync" "$APPIMAGE"
else
  echo "zsyncmake не найден: установите пакет zsync" >&2
  exit 1
fi
"$PYTHON" build_delta.py "$APPIMAGE"
echo "Готово: ${NAME}, .zsync и .delta.json (сборка ${BUILD}, $(du -h "$APPIMAGE" | cut -f1))"
