@echo off
cd /d "%~dp0.."
echo.
echo ============================================================
echo  GEAR APPS - DELETE OLD DATA + FULL FRESH REFRESH
echo ============================================================
echo.
echo This DELETES all existing Gear Apps application rows from the
echo PostgreSQL target in .env, then reloads fresh SQL Server/Excel data.
echo.
echo SQL Server is READ-ONLY and will NOT be modified.
echo.
echo IMPORTANT: Close all Gear Apps API/server windows before continuing.
echo.
set /p CONFIRM=Type DELETE OLD DATA to continue: 
if /I not "%CONFIRM%"=="DELETE OLD DATA" (
  echo.
  echo Cancelled. Nothing was deleted.
  pause
  exit /b 1
)

echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\tools\data-import\reset-and-import-all-fresh.ps1" -Apply -YesReallyDeleteOldData
if errorlevel 1 (
  echo.
  echo Refresh failed. Review the error above.
  pause
  exit /b 1
)

echo.
echo Full refresh complete.
pause

