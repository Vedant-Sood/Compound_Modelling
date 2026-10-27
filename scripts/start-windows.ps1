# Chemical Modelling launcher for Windows 11 (PowerShell).
# PySCF has no native Windows wheels, so the scientific backend runs in WSL2 Ubuntu;
# the browser UI is served by the same backend at http://localhost:8000.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$wslRepo = (wsl wslpath -a ($repo -replace '\\', '/')).Trim()

Write-Host "Building frontend..."
Push-Location "$repo\frontend"
if (-not (Test-Path node_modules)) { npm ci }
npm run build
Pop-Location

Write-Host "Starting backend in WSL2 (first run installs Python dependencies)..."
Start-Process wsl -ArgumentList "bash", "-lc", "'cd $wslRepo && ./scripts/start-backend.sh'"
Start-Sleep -Seconds 6
Start-Process "http://localhost:8000"
