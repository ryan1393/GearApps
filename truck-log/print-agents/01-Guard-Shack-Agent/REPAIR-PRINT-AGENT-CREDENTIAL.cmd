@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "NODE_OPTIONS="
set "NODE_PATH="
set "NODE_TLS_REJECT_UNAUTHORIZED="
set "AGENT_ROOT=%ProgramData%\Dana\TruckLogPrintAgent"
if not exist "%AGENT_ROOT%\node.exe" (
  echo [FAIL] Installed guard Print Agent runtime was not found. This helper repairs an existing installation only.
  pause
  exit /b 1
)
"%AGENT_ROOT%\node.exe" --use-system-ca "%~dp0original-source\repair-credential.cjs"
set "REPAIR_RESULT=%ERRORLEVEL%"
echo.
pause
exit /b %REPAIR_RESULT%
