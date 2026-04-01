@echo off
REM Helper for environments where Node/NPM are installed via NVM-for-Windows but not on PATH.
REM If your NVM symlink differs, edit nodeDir below.
set "nodeDir=C:\nvm4w\nodejs"
if not exist "%nodeDir%\node.exe" (
  echo Node directory not found at "%nodeDir%". Edit dev.cmd with your NVM symlink path.
  exit /b 1
)
set "PATH=%nodeDir%;%PATH%"
cd /d "%~dp0"
"%nodeDir%\npm.cmd" run dev
