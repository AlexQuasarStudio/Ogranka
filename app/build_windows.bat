@echo off
rem Сборка Ogranka.exe (один файл) и самопроверка результата.
setlocal
cd /d %~dp0
python -m pip install -r requirements.txt -r requirements-build.txt
if errorlevel 1 exit /b 1
python build_version.py
if errorlevel 1 exit /b 1
python -m PyInstaller --noconfirm --clean --log-level WARN ogranka.spec
if errorlevel 1 exit /b 1
echo Самопроверка сборки...
start "" /wait dist\Ogranka.exe --self-test --self-test-report dist\self-test.json
if errorlevel 1 (
  type dist\self-test.json
  echo Самопроверка не пройдена
  exit /b 1
)
type dist\self-test.json
echo Готово: dist\Ogranka.exe
if not defined CI pause
endlocal
