@echo off
setlocal
cd /d "%~dp0"
title Truck Log Administrator Maintenance
if "%~1"=="" goto USAGE
if /I "%~1"=="--help" goto USAGE
if /I "%~1"=="-h" goto USAGE
if /I "%~1"=="--bootstrap" goto RUN
if /I "%~1"=="--recover" goto RUN
if /I "%~1"=="--verify" goto RUN
goto USAGE
:RUN
if not "%~2"=="" goto USAGE
where docker.exe >nul 2>&1
if errorlevel 1 (
    echo FAIL: Docker CLI was not found.
    exit /b 1
)
echo.
echo Truck Log Admin maintenance against selected Docker context:
docker context show
echo.
echo Confirm this is the intended Truck Log Docker host.
echo No passwords are accepted as command arguments.
echo.
docker exec -it truck-log-server node tools/truck-log/admin-accounts.cjs %1
exit /b %errorlevel%
:USAGE
echo Usage: SETUP-TRUCK-LOG-ADMIN.cmd --bootstrap ^| --verify ^| --recover
echo   --bootstrap  create the first administrator (prompts for a password)
echo   --recover    reset an existing administrator password
echo   --verify     check the admin tables
exit /b 2
