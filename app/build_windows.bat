@echo off
cd /d %~dp0
python -m pip install -r requirements.txt pyinstaller
python build_version.py
if errorlevel 1 exit /b 1
for /f "usebackq delims=" %%i in (`python -c "import pathlib, scipy; p=pathlib.Path(scipy.__file__).parent; print(next((p/'spatial').glob('_qhull*.pyd')))"`) do set "QHULL=%%i"
for /f "usebackq delims=" %%i in (`python -c "import pathlib, scipy; p=pathlib.Path(scipy.__file__).parent; print(next((p/'_lib').glob('messagestream*.pyd')))"`) do set "MSG=%%i"
for /f "usebackq delims=" %%i in (`python -c "import pathlib, scipy; p=pathlib.Path(scipy.__file__).parent; print(next((p/'linalg').glob('cython_lapack*.pyd')))"`) do set "LAPACK=%%i"
for /f "usebackq delims=" %%i in (`python -c "import pathlib, scipy; p=pathlib.Path(scipy.__file__).parent; print(next(p.glob('_cyutility*.pyd')))"`) do set "CYU=%%i"
for /f "usebackq delims=" %%i in (`python -c "import pathlib, scipy; p=pathlib.Path(scipy.__file__).parent.parent / 'scipy.libs'; print(next(p.glob('libscipy_openblas*.dll')))"`) do set "OPENBLAS=%%i"
if not defined QHULL (echo Qhull extension not found & exit /b 1)
if not defined MSG (echo messagestream extension not found & exit /b 1)
if not defined LAPACK (echo cython_lapack extension not found & exit /b 1)
if not defined CYU (echo _cyutility extension not found & exit /b 1)
if not defined OPENBLAS (echo SciPy OpenBLAS not found & exit /b 1)
python -m PyInstaller --noconfirm --clean --onefile --windowed --name Ogranka ^
  --add-data "static;static"   --exclude-module pkg_resources --exclude-module open3d --exclude-module torch --exclude-module transformers ^
  --exclude-module scipy --add-data "qhull_stub\scipy;scipy" ^
  --add-binary "%QHULL%;scipy\spatial" ^
  --add-binary "%MSG%;scipy\_lib" ^
  --add-binary "%LAPACK%;scipy\linalg" ^
  --add-binary "%CYU%;scipy" ^
  --add-binary "%OPENBLAS%;." ^
  --hidden-import fast_simplification ^
  --hidden-import webview.platforms.edgechromium ^
  --hidden-import webview.platforms.winforms ^
  --hidden-import clr_loader ^
  --hidden-import pythonnet ^
  --version-file version_info.txt ^
  --icon icon.ico app.py
echo Готово: dist\Ogranka.exe
if not defined CI pause
