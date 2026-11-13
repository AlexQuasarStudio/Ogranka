@echo off
cd /d %~dp0
python -m pip install -r requirements.txt pyinstaller open3d
python -m PyInstaller --noconfirm --clean --onefile --windowed --name Ogranka ^
  --add-data "static;static" --exclude-module pkg_resources --collect-all open3d ^
  --hidden-import webview.platforms.winforms --hidden-import webview.platforms.edgechromium ^
  --icon icon.ico app.py
echo Готово: dist\Ogranka.exe
pause
