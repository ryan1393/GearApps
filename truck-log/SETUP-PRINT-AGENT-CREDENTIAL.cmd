@echo off
setlocal
cd /d "%~dp0"
title Truck Log Print Agent Credential
if "%~1"=="" goto USAGE
if /I "%~1"=="--help" goto USAGE
where docker.exe >nul 2>&1
if errorlevel 1 (
    echo FAIL: Docker CLI was not found.
    exit /b 1
)
echo.
echo Creates (or with --rotate, replaces) the credential a Print Agent PC uses.
echo Docker context:
docker context show
echo.
docker compose exec truck-log-server node tools/truck-log/provision-print-agent.mjs %*
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" echo Copy the token above into the Print Agent configuration now. It is not shown again.
pause
exit /b %RC%
:USAGE
echo Usage: SETUP-PRINT-AGENT-CREDENTIAL.cmd --agent-id ^<id^> --name "^<display name^>" [--rotate]
echo Example: SETUP-PRINT-AGENT-CREDENTIAL.cmd --agent-id trucklog-print-pc-01 --name "Guard shack printer PC"
exit /b 2
