@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo Truck Log SAP Queue Watcher - FOREGROUND DEBUG RUN (reconstructed edition, NOT original V3)
echo Normal operation is the Windows service TruckLogPackingSlipWatcher (INSTALL-WATCHER-SERVICE.cmd).
echo Route modes come from Truck Log ^> Admin ^> Printing: LIVE routes PRINT verified slips, TEST never prints.
echo Stop with Ctrl+C.
sc.exe query TruckLogPackingSlipWatcher 2>nul | find "RUNNING" >nul
if not errorlevel 1 (
  echo [FAIL] The TruckLogPackingSlipWatcher service is running. Stop it first ^(as Administrator: net stop TruckLogPackingSlipWatcher^).
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
echo Reading the Truck Log credential needs an elevated prompt ^(Run as administrator^).
if exist "%PY%" goto run
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -I "%SCRIPT%" run --config "%CFG%"
  goto done
)
set "PY=python"
:run
"%PY%" -I "%SCRIPT%" run --config "%CFG%"
:done
set "RESULT=%ERRORLEVEL%"
echo.
echo Watcher stopped with exit code %RESULT%.
exit /b %RESULT%
