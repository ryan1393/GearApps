@echo off
setlocal
cd /d "%~dp0.."
rem MeshForge remote deploy. Options: --check  --rollback  --upload-env (first install)
rem See README.md "Deploy". Never runs compose down or deletes volumes.
node tools\manufacturing\deploy\deploy-remote.mjs %*
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (echo DEPLOY FINISHED) else (echo DEPLOY STOPPED - see the [FAIL] line above)
pause
exit /b %RC%
