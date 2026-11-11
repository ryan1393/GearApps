@echo off
cd /d "%~dp0.."
echo.
echo ============================================================
echo  MESHFORGE - CLEAR OPERATIONAL DATA (KEEP USERS + BASE DATA)
echo ============================================================
echo.
echo This EMPTIES blades, trays, containers, ALL locations, cutter builds,
echo cutter events and history, coater shipments and Greenshed counts in the
echo PostgreSQL database named in .env.
echo.
echo KEPT: users, departments, models, parts, part summaries, blade
echo requirements, cutter body definitions, cutter bodies, roll masters,
echo gearsets, machines, settings, label printers and all Lapper data.
echo.
if not exist ".env" (
  echo There is no .env file in this folder.
  echo Run this from your working MeshForge folder, or copy its .env here first.
  echo Nothing was deleted.
  pause
  exit /b 1
)
if not exist "node_modules\pg\package.json" (
  echo The project packages are not installed in this folder.
  echo Run commands\SETUP-MESHFORGE.cmd here first, or use your working MeshForge folder.
  echo If the database runs in Docker, use commands\CLEAR-OPERATIONAL-DATA-DOCKER.cmd instead.
  echo Nothing was deleted.
  pause
  exit /b 1
)
node tools\manufacturing\data-import\clear-operational-data.mjs
if errorlevel 1 (
  echo.
  echo Preview failed. Nothing was deleted.
  pause
  exit /b 1
)
echo.
echo IMPORTANT: Close all MeshForge API/server windows before continuing.
echo.
set /p CONFIRM=Type CLEAR DATA to continue: 
if /I not "%CONFIRM%"=="CLEAR DATA" (
  echo.
  echo Cancelled. Nothing was deleted.
  pause
  exit /b 1
)

echo.
node tools\manufacturing\data-import\clear-operational-data.mjs --apply --yes-delete-operational-data
if errorlevel 1 (
  echo.
  echo Clear failed. Review the error above.
  pause
  exit /b 1
)

echo.
echo Operational data cleared. Start MeshForge, then make shelves in
echo Admin ^> Locations ^> Bulk shelf locations.
pause
