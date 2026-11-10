@echo off
setlocal
rem Deploys this GearApps folder to the Docker host usftwvmdocker as user "image".
rem It copies the source over SSH, backs up the database, builds, starts every service and
rem waits until the API reports this version. It never deletes the database volume.
rem
rem Run it from anywhere, or double-click it: it always works from the folder it is in.
rem Options are passed through:  --check (preflight only, changes nothing)   --rollback
cd /d "%~dp0"
set "GEAR_DEPLOY_CONTEXT=usftwvmdocker"
set "GEAR_DEPLOY_TARGET=ssh://image@usftwvmdocker"

if not exist "manufacturing\Deploy-GearApps.cmd" (
    echo [FAIL] manufacturing\Deploy-GearApps.cmd was not found. Keep this file in the GearApps root folder.
    pause
    exit /b 1
)

docker context inspect %GEAR_DEPLOY_CONTEXT% >nul 2>&1
if errorlevel 1 (
    echo Creating Docker context %GEAR_DEPLOY_CONTEXT% for %GEAR_DEPLOY_TARGET% ...
    docker context create %GEAR_DEPLOY_CONTEXT% --docker "host=%GEAR_DEPLOY_TARGET%"
    if errorlevel 1 (
        echo [FAIL] Could not create the Docker context. Is Docker installed on this PC?
        pause
        exit /b 1
    )
)

call "manufacturing\Deploy-GearApps.cmd" --context %GEAR_DEPLOY_CONTEXT% %*
exit /b %ERRORLEVEL%
