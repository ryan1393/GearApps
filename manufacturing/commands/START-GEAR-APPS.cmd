@echo off
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\tools\start-gear-apps.ps1"
if errorlevel 1 pause

