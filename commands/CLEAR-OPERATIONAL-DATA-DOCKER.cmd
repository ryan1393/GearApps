@echo off
cd /d "%~dp0.."
echo.
echo ============================================================
echo  MESHFORGE - CLEAR OPERATIONAL DATA, DATABASE IN DOCKER
echo ============================================================
echo.
echo For a MeshForge PostgreSQL that runs in a Docker container. Needs only
echo Docker on this computer: no Node.js and no installed packages.
echo.
echo EMPTIES blades, trays, containers, ALL locations, cutter builds, cutter
echo events and history, coater shipments and Greenshed counts.
echo KEEPS users, departments, models, parts, part summaries, blade
echo requirements, cutter bodies, machines, settings and all Lapper data.
echo.
echo It lists every table first, asks for CLEAR DATA, and takes a backup
echo before clearing anything.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\tools\manufacturing\data-import\Clear-OperationalData-Docker.ps1" -Apply %*
if errorlevel 1 (
  echo.
  echo Stopped. Review the message above.
  pause
  exit /b 1
)
echo.
pause
