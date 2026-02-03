$ErrorActionPreference = 'Stop'

# Helper for environments where Node/NPM are installed via NVM-for-Windows but not on PATH.
# If your NVM symlink differs, change this path.
$nodeDir = 'C:\nvm4w\nodejs'

if (-not (Test-Path $nodeDir)) {
  throw "Node directory not found at '$nodeDir'. Update dev.ps1 with your NVM symlink path."
}

$env:PATH = "$nodeDir;$env:PATH"
Set-Location $PSScriptRoot

& "$nodeDir\npm.cmd" run dev
