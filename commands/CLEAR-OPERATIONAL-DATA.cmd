@echo off
cd /d "%~dp0.."
echo.
echo ============================================================
echo  MESHFORGE - CLEAR OPERATIONAL DATA (KEEP USERS + BASE DATA)
echo ============================================================
echo.
echo This EMPTIES blades, trays, containers, cutter builds, cutter events and
echo history, coater shipments and Greenshed counts in the PostgreSQL
echo database named in .env. It DELETES every location except the
echo shelf/layer/bin bins (CGDR-A1A etc.) and COATER-STAGING.
echo.
echo KEPT: users, departments, models, parts, part summaries, blade
echo requirements, cutter body definitions, cutter bodies, roll masters,
echo gearsets, machines, settings, label printers, shelf/layer/bin
echo locations (now empty) and all Lapper data.
echo.
set MESHFORGE_CLEAR_FROM_LAUNCHER=1
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
echo Operational data cleared. Start MeshForge, then make trays and
echo containers in Admin ^> Launch Setup.
pause
