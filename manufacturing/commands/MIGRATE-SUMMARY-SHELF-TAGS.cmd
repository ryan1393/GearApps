@echo off
setlocal
cd /d "%~dp0.."

echo ============================================================
echo  Gear Apps - Summary Shelf Tag Migration
echo  Current tags: GSR- / GSP- / CGDR- / CGDP- / CGFR- / CGFP-
echo.
echo  First pass is DRY RUN only. Ambiguous shelves are NEVER guessed.
echo  Obsolete CGE-/CGER-/CGEP- empty-tray shelves are REVIEW only.
echo ============================================================
echo.
node tools\data-import\migrate-summary-shelf-tags.mjs
if errorlevel 1 (
  echo.
  echo [FAIL] Dry-run migration scan failed.
  pause
  exit /b 1
)

echo.
set /p CONFIRM=Type APPLY SUMMARY SHELF TAG MIGRATION to apply SAFE rows, or press Enter to stop: 
if /I not "%CONFIRM%"=="APPLY SUMMARY SHELF TAG MIGRATION" (
  echo No database changes were made by this launcher.
  pause
  exit /b 0
)

echo.
node tools\data-import\migrate-summary-shelf-tags.mjs --apply
set EXITCODE=%ERRORLEVEL%
echo.
if not "%EXITCODE%"=="0" echo [FAIL] Migration apply returned exit code %EXITCODE%.
if "%EXITCODE%"=="0" echo [PASS] Safe Summary shelf tag migration completed. Review any rows marked REVIEW.
pause
exit /b %EXITCODE%

