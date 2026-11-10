# Build the Chemical Modelling Windows installer (NSIS .exe) from PowerShell.
# Requires Node.js 20+ on Windows. The installed app runs its scientific backend in WSL2.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot

Write-Host "==> Building frontend"
Push-Location "$repo\frontend"
if (-not (Test-Path node_modules)) { npm ci; if ($LASTEXITCODE) { throw "npm ci failed" } }
npm run build; if ($LASTEXITCODE) { throw "frontend build failed" }
Pop-Location

Write-Host "==> Packaging desktop app"
Push-Location "$repo\desktop"
if (-not (Test-Path node_modules)) { npm ci; if ($LASTEXITCODE) { throw "npm ci failed" } }
npm test; if ($LASTEXITCODE) { throw "desktop tests failed" }
npx electron-builder --win nsis; if ($LASTEXITCODE) { throw "electron-builder failed" }
Pop-Location
Write-Host "==> Installer written to $repo\desktop\dist"
