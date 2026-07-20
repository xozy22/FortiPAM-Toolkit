@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Bitte zuerst start.bat ausfuehren, damit die virtuelle Umgebung existiert.
  pause
  exit /b 1
)

".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q pyinstaller
".venv\Scripts\python.exe" -m PyInstaller --onefile --name FortiPAM-Toolkit ^
  --add-data "app\static;app\static" ^
  --hidden-import uvicorn.logging --hidden-import uvicorn.loops.auto ^
  --hidden-import uvicorn.protocols.http.auto --hidden-import uvicorn.lifespan.on ^
  run.py

echo.
echo Fertig: dist\FortiPAM-Toolkit.exe
pause
