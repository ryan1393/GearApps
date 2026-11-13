@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo Read-only check of THIS folder's watcher.ini (before installing the service).
echo For the installed service use STATUS-WATCHER-SERVICE.cmd. Run as administrator to read the credential.
set "PY=%~dp0.venv\Scripts\python.exe"
if exist "%PY%" goto run
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -I "%~dp0sap_capture_watcher.py" check --config "%~dp0watcher.ini"
  goto done
)
set "PY=python"
:run
"%PY%" -I "%~dp0sap_capture_watcher.py" check --config "%~dp0watcher.ini"
:done
set "RESULT=%ERRORLEVEL%"
echo.
echo Read-only configuration check finished with exit code %RESULT%.
pause
exit /b %RESULT%
