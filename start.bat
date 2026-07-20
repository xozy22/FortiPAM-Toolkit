@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python wurde nicht gefunden. Bitte Python 3.11+ installieren: https://www.python.org/downloads/
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Erstelle virtuelle Umgebung und installiere Abhaengigkeiten ...
  python -m venv .venv
  if errorlevel 1 ( pause & exit /b 1 )
  ".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r requirements.txt
  if errorlevel 1 ( pause & exit /b 1 )
)

".venv\Scripts\python.exe" -m app
pause
