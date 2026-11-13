@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo Truck Log SAP Queue Watcher - store the Truck Log Print Agent token
echo.
echo The token (tlpa_...) is printed ONCE by SETUP-PRINT-AGENT-CREDENTIAL.cmd on the Truck Log host.
echo Use a SEPARATE agent id from the guard shack agent (see README.txt).
echo The watcher uses it to read its route settings from Truck Log and to upload slips.
echo It is sealed for THIS PC (Windows DPAPI LocalMachine) so the LocalSystem service can read it,
echo and the file is readable only by SYSTEM and Administrators. It is never written to watcher.ini.
echo Input is hidden while you paste.
echo.
net session >nul 2>&1
if errorlevel 1 (
  echo [FAIL] Right-click SETUP-TRUCK-LOG-UPLOAD.cmd and choose "Run as administrator".
  pause
  exit /b 1
)
set "INST=%ProgramFiles%\TruckLog\PackingSlipWatcher"
set "CFG=%~dp0watcher.ini"
set "SCRIPT=%~dp0sap_capture_watcher.py"
set "PY=%~dp0.venv\Scripts\python.exe"
if exist "%INST%\watcher.ini" if exist "%INST%\.venv\Scripts\python.exe" (
  set "CFG=%INST%\watcher.ini"
  set "SCRIPT=%INST%\sap_capture_watcher.py"
  set "PY=%INST%\.venv\Scripts\python.exe"
)
echo Using configuration: %CFG%
if exist "%PY%" goto run
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -I "%SCRIPT%" setup-upload --config "%CFG%"
  goto done
)
set "PY=python"
:run
"%PY%" -I "%SCRIPT%" setup-upload --config "%CFG%"
:done
set "RESULT=%ERRORLEVEL%"
echo.
echo Setup finished with exit code %RESULT%.
echo The running service picks up the new credential within about a minute.
echo Route mode and upload on/off are set in Truck Log ^> Admin ^> Printing.
pause
exit /b %RESULT%
