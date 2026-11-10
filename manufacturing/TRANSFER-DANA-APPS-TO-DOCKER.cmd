@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0.."

title Dana Apps - Transfer Source To Remote Docker Host

set "SSH_USER=image"
set "SSH_HOST=usftwvmdocker"
set "REMOTE_DIR=/tmp/dana-apps.v0.1"

if not "%~1"=="" set "SSH_USER=%~1"
if not "%~2"=="" set "SSH_HOST=%~2"
if not "%~3"=="" set "REMOTE_DIR=%~3"

set "REMOTE=%SSH_USER%@%SSH_HOST%"
set "REMOTE_UPLOAD_DIR="
set "REMOTE_ARCHIVE="
set "LOCAL_ARCHIVE=%TEMP%\dana-apps-transfer-%RANDOM%%RANDOM%.tar.gz"

echo ============================================================
echo   DANA APPS - TRANSFER SOURCE TO REMOTE DOCKER HOST
echo ============================================================
echo.
echo Local root:
echo   %CD%
echo.
echo Remote:
echo   %REMOTE%
echo.
echo Destination:
echo   %REMOTE_DIR%
echo.

if not exist "package.json" (
    echo [FAIL] package.json was not found.
    echo        Run this CMD from the project root.
    goto :fail
)

where tar.exe >nul 2>&1
if errorlevel 1 (
    echo [FAIL] Windows tar.exe was not found.
    goto :fail
)

where ssh.exe >nul 2>&1
if errorlevel 1 (
    echo [FAIL] Windows ssh.exe was not found.
    goto :fail
)

where scp.exe >nul 2>&1
if errorlevel 1 (
    echo [FAIL] Windows scp.exe was not found.
    goto :fail
)

echo [1/6] Checking SSH connection...
ssh.exe -o ConnectTimeout=15 "%REMOTE%" "echo SSH_OK"
if errorlevel 1 (
    echo [FAIL] Could not connect to %REMOTE%.
    goto :fail
)
echo [PASS] SSH connection is working.
echo.

echo [2/6] Creating compressed source archive...
if exist "%LOCAL_ARCHIVE%" del /q "%LOCAL_ARCHIVE%" >nul 2>&1

tar.exe -czf "%LOCAL_ARCHIVE%" ^
  --exclude="./node_modules" ^
  --exclude="./.nx" ^
  --exclude="./.git" ^
  --exclude="./dist" ^
  --exclude="./build" ^
  --exclude="./coverage" ^
  --exclude="./_patch_backups" ^
  --exclude="./_archive" ^
  --exclude="./.angular" ^
  --exclude="./.cache" ^
  --exclude="./runtime-data" ^
  --exclude=".env" ^
  --exclude=".env.*" ^
  --exclude=".npmrc" ^
  --exclude=".ssh" ^
  --exclude="*.pem" ^
  --exclude="*.key" ^
  --exclude="./.env" ^
  --exclude="./.env.local" ^
  --exclude="./manufacturing/node_modules" ^
  --exclude="./manufacturing/dist" ^
  --exclude="./manufacturing/.nx" ^
  --exclude="./*.zip" ^
  --exclude="./*.tar.gz" ^
  --exclude="./*.log" ^
  .

if errorlevel 1 (
    echo [FAIL] tar.exe could not create the archive.
    goto :fail
)

for %%F in ("%LOCAL_ARCHIVE%") do set "ARCHIVE_SIZE=%%~zF"
echo [PASS] Archive created: %LOCAL_ARCHIVE%
echo        Size: !ARCHIVE_SIZE! bytes
echo.

echo [3/6] Creating a private remote transfer directory...
for /f "usebackq delims=" %%D in (`ssh.exe "%REMOTE%" "umask 077; mktemp -d /tmp/dana-apps-transfer.XXXXXXXXXX"`) do set "REMOTE_UPLOAD_CANDIDATE=%%D"
echo !REMOTE_UPLOAD_CANDIDATE! | findstr /r /x "/tmp/dana-apps-transfer\.[A-Za-z0-9][A-Za-z0-9]*" >nul
if errorlevel 1 (
    echo [FAIL] Could not create a private remote transfer location.
    goto :fail
)
set "REMOTE_UPLOAD_DIR=!REMOTE_UPLOAD_CANDIDATE!"
set "REMOTE_ARCHIVE=!REMOTE_UPLOAD_DIR!/source.tar.gz"
echo [PASS] Private remote transfer location is ready.
echo.

echo [4/6] Copying archive with SCP compression...
scp.exe -C "%LOCAL_ARCHIVE%" "%REMOTE%:%REMOTE_ARCHIVE%"
if errorlevel 1 (
    echo [FAIL] SCP transfer failed.
    goto :fail
)
echo [PASS] Transfer completed.
echo.

echo [5/6] Replacing remote source tree and extracting...
ssh.exe "%REMOTE%" "set -e; rm -rf '%REMOTE_DIR%.incoming'; mkdir -p '%REMOTE_DIR%.incoming'; tar -xzf '%REMOTE_ARCHIVE%' -C '%REMOTE_DIR%.incoming'; test -f '%REMOTE_DIR%.incoming/package.json'; test -f '%REMOTE_DIR%.incoming/compose.yml'; if [ ! -f '%REMOTE_DIR%/compose.yml' ] && [ -f '%REMOTE_DIR%/manufacturing/compose.yml' ]; then test -f '%REMOTE_DIR%/manufacturing/.env'; cp -p '%REMOTE_DIR%/manufacturing/.env' '%REMOTE_DIR%.incoming/.env'; elif [ -f '%REMOTE_DIR%/.env' ]; then cp -p '%REMOTE_DIR%/.env' '%REMOTE_DIR%.incoming/.env'; fi; rm -rf '%REMOTE_DIR%.previous'; if [ -d '%REMOTE_DIR%' ]; then mv '%REMOTE_DIR%' '%REMOTE_DIR%.previous'; fi; mv '%REMOTE_DIR%.incoming' '%REMOTE_DIR%'; rm -rf '%REMOTE_UPLOAD_DIR%'; echo REMOTE_EXTRACT_OK"
if errorlevel 1 (
    echo [FAIL] Remote extraction or verification failed.
    goto :fail
)
echo [PASS] Remote source extracted and package.json verified.
echo.

echo [6/6] Cleaning local temporary archive...
del /q "%LOCAL_ARCHIVE%" >nul 2>&1
if exist "%LOCAL_ARCHIVE%" (
    echo [WARN] Could not remove local temp archive:
    echo        %LOCAL_ARCHIVE%
) else (
    echo [PASS] Local temporary archive removed.
)

echo.
echo ============================================================
echo   TRANSFER COMPLETE
echo ============================================================
echo.
echo Remote source is now at:
echo   %REMOTE%:%REMOTE_DIR%
echo.
echo Next:
echo   ssh %REMOTE%
echo   cd %REMOTE_DIR%
echo   docker compose --env-file .env -f compose.yml config
echo   docker compose --env-file .env -f compose.yml build --progress=plain
echo   docker compose --env-file .env -f compose.yml up -d --no-build
echo   docker compose --env-file .env -f compose.yml ps
echo.
pause
exit /b 0

:fail
echo.
if defined REMOTE_UPLOAD_DIR ssh.exe "%REMOTE%" "rm -rf '%REMOTE_UPLOAD_DIR%'" >nul 2>&1
if exist "%LOCAL_ARCHIVE%" del /q "%LOCAL_ARCHIVE%" >nul 2>&1
echo ============================================================
echo   TRANSFER FAILED
echo ============================================================
echo.
echo No local project source was modified.
pause
exit /b 1
