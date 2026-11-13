@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0\..\.."
set "ACTION=%~1"
if /I "%ACTION%"=="import" goto action_ok
if /I "%ACTION%"=="sync-docks" goto action_ok
if /I "%ACTION%"=="clear" goto action_ok
echo [FAIL] Invalid reference-data action: %ACTION%
exit /b 2
:action_ok
where docker.exe >nul 2>&1 || (echo [FAIL] Docker CLI was not found in PATH.& exit /b 1)
set "SERVER_RUNNING="
for /f "usebackq delims=" %%S in (`docker inspect -f "{{.State.Running}}" truck-log-server 2^>nul`) do set "SERVER_RUNNING=%%S"
if /I not "%SERVER_RUNNING%"=="true" (
  echo [FAIL] truck-log-server is not running on the selected Docker context.
  echo        Start Truck Log first and retry.
  exit /b 1
)
docker exec truck-log-server node -e "require('fs').accessSync('/app/tools/truck-log/reference-csv/db-common.mjs')" >nul 2>&1
if errorlevel 1 (
  echo [FAIL] The running server image does not contain the reference-data runtime tools.
  echo        Rebuild only the server once:
  echo        docker compose -p truck-log up -d --no-deps --build truck-log-server
  exit /b 1
)
if /I "%ACTION%"=="import" (
  if not exist "%~dp0\..\..\reference-data-import\reference-data.csv" (
    echo [FAIL] reference-data-import\reference-data.csv was not found.
    echo        Copy reference-data-template.csv to reference-data.csv and replace the sample rows first.
    exit /b 1
  )
  type "%~dp0\..\..\reference-data-import\reference-data.csv" | docker exec -i truck-log-server node /app/tools/truck-log/reference-csv/import-reference-data-csv.mjs --stdin
  exit /b %ERRORLEVEL%
)
if /I "%ACTION%"=="sync-docks" (
  docker exec -i truck-log-server node /app/tools/truck-log/reference-csv/sync-authoritative-docks.mjs
  exit /b %ERRORLEVEL%
)
if /I "%ACTION%"=="clear" (
  docker exec -i truck-log-server node /app/tools/truck-log/reference-csv/clear-truck-log-data.mjs
  exit /b %ERRORLEVEL%
)
