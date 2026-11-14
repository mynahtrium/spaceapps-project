@echo off
setlocal
cd /d "%~dp0"

set "PORT=8000"
set "URL=http://localhost:%PORT%/web/?demo=1"

where python >nul 2>nul
if %errorlevel%==0 (
  set "PY=python"
) else (
  where py >nul 2>nul
  if %errorlevel%==0 (
    set "PY=py -3"
  ) else (
    echo [ERROR] Python 3 not found in PATH. Please install Python 3.
    pause
    exit /b 1
  )
)

echo Starting Martian Mappers local server on port %PORT%...
echo Demo-safe URL : %URL%
echo Normal URL    : http://localhost:%PORT%/web/
echo Press Ctrl+C in this window to stop the server.
echo.

start "" "%URL%"
%PY% -m http.server %PORT%
