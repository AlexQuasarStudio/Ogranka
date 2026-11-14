@echo off
setlocal
set "APP=%~dp0.."
set "OGRANKA_DATA=%LOCALAPPDATA%\ShapePipeline"
if not exist "%OGRANKA_DATA%" mkdir "%OGRANKA_DATA%"

set "PY="
where py >nul 2>&1
if not errorlevel 1 (
  py -3 -c "import sys, numpy, scipy, fast_simplification; assert sys.version_info >= (3, 10)" >nul 2>&1
  if not errorlevel 1 set "PY=py -3"
)
if not defined PY (
  where python >nul 2>&1
  if not errorlevel 1 (
    python -c "import sys, numpy, scipy, fast_simplification; assert sys.version_info >= (3, 10)" >nul 2>&1
    if not errorlevel 1 set "PY=python"
  )
)
if not defined PY (
  echo Не найден Python 3.10+ с numpy, scipy и fast-simplification.
  echo Установите: python -m pip install numpy scipy fast-simplification
  pause
  exit /b 1
)

%PY% "%APP%\app.py" %*
