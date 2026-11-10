@echo off
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\tools\manufacturing\start-gear-apps.ps1"
if errorlevel 1 pause

