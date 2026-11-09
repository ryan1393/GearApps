@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo Install dependencies for reconstructed SAP queue watcher.
echo Does not change Truck Log, printers, the original V3 watcher, or Docker.
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -m venv .venv
) else (
  where python >nul 2>nul
  if errorlevel 1 (
    echo [FAIL] Python 3.10+ not found. Install Python with venv and pip.
    pause
    exit /b 2
  )
  python -m venv .venv
)
if errorlevel 1 goto fail
"%~dp0.venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r "%~dp0requirements.txt"
if errorlevel 1 goto fail
echo [PASS] Local venv installed. Now run CHECK-WATCHER.cmd.
pause
exit /b 0
:fail
echo [FAIL] Dependency install did not complete.
pause
exit /b 1
