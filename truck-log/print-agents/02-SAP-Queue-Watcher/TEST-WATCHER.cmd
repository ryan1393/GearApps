@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "PY=%~dp0.venv\Scripts\python.exe"
if exist "%PY%" goto run
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -m unittest discover -s tests -v
  goto done
)
set "PY=python"
:run
"%PY%" -m unittest discover -s tests -v
:done
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%
