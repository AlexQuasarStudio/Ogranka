@echo off
cd /d %~dp0
python -m pip install -r requirements.txt pyinstaller
python -m PyInstaller --noconfirm --clean --onefile --windowed --name Ogranka ^
  --add-data "static;static" --exclude-module pkg_resources --exclude-module open3d --exclude-module torch --exclude-module transformers ^
  --exclude-module webview --exclude-module pythonnet --exclude-module clr_loader --exclude-module clr ^
  --hidden-import fast_simplification ^
  --version-file version_info.txt ^
  --icon icon.ico app.py
echo Готово: dist\Ogranka.exe
pause
