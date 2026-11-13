@echo off
setlocal
cd /d "%~dp0"
title Change Truck Log Passwords
if not "%~2"=="" goto USAGE
if /I "%~1"=="--admin" goto ADMIN
if /I "%~1"=="--rxo" goto RXO
if /I "%~1"=="--rxo-expedite" goto EXPEDITE
if /I "%~1"=="--database" goto GENERATED
if /I "%~1"=="--print-secret" goto GENERATED
if /I "%~1"=="--all-generated" goto GENERATED
goto USAGE
:ADMIN
call "%~dp0SETUP-TRUCK-LOG-ADMIN.cmd" --recover
exit /b %errorlevel%
:RXO
call "%~dp0SETUP-RXO-INTEGRATION-CREDENTIALS.cmd"
exit /b %errorlevel%
:EXPEDITE
call "%~dp0SETUP-RXO-EXPEDITE-CREDENTIALS.cmd"
exit /b %errorlevel%
:GENERATED
set "ACTION=%~1"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\tools\truck-log\change-passwords.ps1" -Action %ACTION:~2%
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo Password change FAILED with exit code %RC%.
pause
exit /b %RC%
:USAGE
echo Change Truck Log passwords and secrets. No password is typed on the command line.
echo.
echo   CHANGE-TRUCK-LOG-PASSWORDS.cmd --admin           reset an administrator's sign-in password (prompts)
echo   CHANGE-TRUCK-LOG-PASSWORDS.cmd --database        new database password: PostgreSQL + .env, then restart
echo   CHANGE-TRUCK-LOG-PASSWORDS.cmd --print-secret    new Print Agent claim-token signing secret, then restart
echo   CHANGE-TRUCK-LOG-PASSWORDS.cmd --rxo             change the standard RXO login
echo   CHANGE-TRUCK-LOG-PASSWORDS.cmd --rxo-expedite    change the RXO Expedite login
echo   CHANGE-TRUCK-LOG-PASSWORDS.cmd --all-generated   --database and --print-secret together (one restart)
echo.
echo Print PC token: SETUP-PRINT-AGENT-CREDENTIAL.cmd --agent-id ^<id^> --name "<name>" --rotate
echo --database also repairs a .env whose database password no longer matches PostgreSQL.
exit /b 2
