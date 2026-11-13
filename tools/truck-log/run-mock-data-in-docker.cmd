@echo off
setlocal EnableExtensions
cd /d "%~dp0\..\.."

set "ACTION=%~1"
if /I "%ACTION%"=="seed" goto action_ok
if /I "%ACTION%"=="reset" goto action_ok
if /I "%ACTION%"=="clear" goto action_ok
if /I "%ACTION%"=="status" goto action_ok

echo [FAIL] Invalid mock-data action: %ACTION%
echo        Expected seed, reset, clear, or status.
exit /b 2

:action_ok
where docker >nul 2>&1
if errorlevel 1 (
  echo [FAIL] Docker CLI was not found in PATH.
  exit /b 1
)

set "DOCKER_CONTEXT="
for /f "usebackq delims=" %%C in (`docker context show 2^>nul`) do set "DOCKER_CONTEXT=%%C"
if not defined DOCKER_CONTEXT (
  echo [FAIL] Could not determine the active Docker context.
  exit /b 1
)

echo [INFO] Docker context: %DOCKER_CONTEXT%

set "SERVER_RUNNING="
for /f "usebackq delims=" %%S in (`docker inspect -f "{{.State.Running}}" truck-log-server 2^>nul`) do set "SERVER_RUNNING=%%S"
if /I not "%SERVER_RUNNING%"=="true" (
  echo [FAIL] truck-log-server is not running on Docker context %DOCKER_CONTEXT%.
  echo        Start/rebuild Truck Log first, then retry.
  exit /b 1
)

docker exec truck-log-server node -e "require('fs').accessSync('/app/tools/truck-log/mock-data.mjs')" >nul 2>&1
if errorlevel 1 (
  echo [FAIL] The running truck-log-server image does not contain the mock-data runtime tool.
  echo        Rebuild only the server once:
  echo        docker compose -p truck-log up -d --no-deps --build truck-log-server
  echo        Then run this command again.
  exit /b 1
)

echo [INFO] Running mock-data action "%ACTION%" inside truck-log-server.
echo        Database and document paths come from the container's existing environment.
echo.
docker exec -i truck-log-server node /app/tools/truck-log/mock-data.mjs %ACTION%
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo [FAIL] Mock-data action "%ACTION%" failed inside truck-log-server. Exit code %RC%.
  exit /b %RC%
)

echo.
echo [PASS] Mock-data action "%ACTION%" completed inside truck-log-server.
exit /b 0
