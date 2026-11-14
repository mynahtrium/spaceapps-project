@echo off
setlocal
cd /d "%~dp0"

set "PORT=8000"
set "URL=http://localhost:%PORT%/web/?demo=1"

where node >nul 2>nul
if %errorlevel%==0 (
  echo Starting Martian Mappers LAN Multiplayer + Static Server on port %PORT%...
  echo Demo-safe URL : %URL%
  echo Normal URL    : http://localhost:%PORT%/web/
  echo Press Ctrl+C in this window to stop the server.
  echo.
  start "" "%URL%"
  node scripts\server.mjs
  exit /b %errorlevel%
)

where python >nul 2>nul
if %errorlevel%==0 (
  set "PY=python"
) else (
  where py >nul 2>nul
  if %errorlevel%==0 (
    set "PY=py -3"
  ) else (
    echo [ERROR] Neither Node.js nor Python 3 found in PATH.
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
