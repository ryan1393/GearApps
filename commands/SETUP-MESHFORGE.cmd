@echo off
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\tools\manufacturing\setup-meshforge.ps1"
if errorlevel 1 (
    echo.
    echo MeshForge setup failed.
    pause
    exit /b 1
)
echo.
echo MeshForge setup completed successfully.
pause

