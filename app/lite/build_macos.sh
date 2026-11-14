#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$ROOT/../Огранка Lite.app"
rm -rf "$TARGET"
mkdir -p "$TARGET/Contents/MacOS" "$TARGET/Contents/Resources/app"

cp "$ROOT/lite/launcher_macos.sh" "$TARGET/Contents/MacOS/OgrankaLite"
chmod +x "$TARGET/Contents/MacOS/OgrankaLite"
cp "$ROOT/icon.icns" "$TARGET/Contents/Resources/icon.icns"

for file in app.py config.py sources.py live.py platform_ui.py requirements.txt; do
  cp "$ROOT/$file" "$TARGET/Contents/Resources/app/$file"
done
cp -R "$ROOT/core" "$TARGET/Contents/Resources/app/core"
cp -R "$ROOT/static" "$TARGET/Contents/Resources/app/static"
find "$TARGET/Contents/Resources/app" -type d -name __pycache__ -prune -exec rm -rf {} +

cat > "$TARGET/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>ru</string>
  <key>CFBundleDisplayName</key><string>Огранка Lite</string>
  <key>CFBundleExecutable</key><string>OgrankaLite</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>CFBundleIdentifier</key><string>ru.msu.reconstruct-z.ogranka.lite</string>
  <key>CFBundleName</key><string>Огранка Lite</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>CFBundleVersion</key><string>1.0.0</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

codesign --force --deep --sign - "$TARGET" >/dev/null 2>&1 || true
du -sh "$TARGET"
