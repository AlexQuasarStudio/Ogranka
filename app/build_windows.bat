@echo off
cd /d %~dp0
python -m pip install -r requirements.txt pyinstaller
python -m PyInstaller --noconfirm --clean --onefile --windowed --name Ogranka ^
  --add-data "static;static" --exclude-module pkg_resources --exclude-module open3d --exclude-module torch --exclude-module transformers ^
  --hidden-import fast_simplification ^
  --hidden-import webview.platforms.winforms --hidden-import webview.platforms.edgechromium ^
  --icon icon.ico app.py
echo Готово: dist\Ogranka.exe
pause
