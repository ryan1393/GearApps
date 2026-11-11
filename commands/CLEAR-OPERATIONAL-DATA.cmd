@echo off
cd /d "%~dp0.."
echo.
echo ============================================================
echo  MESHFORGE - CLEAR OPERATIONAL DATA (KEEP USERS + BASE DATA)
echo ============================================================
echo.
echo This EMPTIES blades, trays, containers, cutter builds, cutter events and
echo history, coater shipments and Greenshed counts in the PostgreSQL
echo database named in .env, and any older table that points at them.
echo.
echo KEPT: users, departments, models, parts, part summaries, blade
echo requirements, cutter body definitions, cutter bodies, roll masters,
echo gearsets, machines, settings, label printers and all Lapper data.
echo.
echo Locations:
echo   1) KEEP the shelf/layer/bin locations (CGDR-A1A etc.) and COATER-STAGING,
echo      empty; delete every other location   [default]
echo   2) DELETE ALL locations (make shelves again afterwards)
set LOCCHOICE=1
set /p LOCCHOICE=Choose 1 or 2 [1]: 
set LOCATIONS=
if "%LOCCHOICE%"=="1" set LOCATIONS=keep-shelves
if "%LOCCHOICE%"=="2" set LOCATIONS=delete-all
if not defined LOCATIONS (
  echo.
  echo Cancelled. Nothing was deleted.
  pause
  exit /b 1
)
echo.
echo Locations: %LOCATIONS%
echo.
set MESHFORGE_CLEAR_FROM_LAUNCHER=1
node tools\manufacturing\data-import\clear-operational-data.mjs --locations=%LOCATIONS%
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
node tools\manufacturing\data-import\clear-operational-data.mjs --locations=%LOCATIONS% --apply --yes-delete-operational-data
if errorlevel 1 (
  echo.
  echo Clear failed. Review the error above.
  pause
  exit /b 1
)

echo.
echo Operational data cleared. Start MeshForge, then make trays and
echo containers in Admin ^> Launch Setup.
if "%LOCATIONS%"=="delete-all" echo Make shelves first in Admin ^> Locations ^> Bulk shelf locations.
pause
