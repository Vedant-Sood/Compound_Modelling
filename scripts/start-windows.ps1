# Chemical Modelling launcher for Windows 11 (PowerShell).
# PySCF has no native Windows wheels, so the scientific backend runs in WSL2 Ubuntu;
# the browser UI is served by the same backend at http://localhost:8000.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$url = "http://localhost:8000"

function Fail($msg) {
    Write-Host ""
    Write-Host "ERROR: $msg" -ForegroundColor Red
    exit 1
}

function Test-Backend {
    try {
        $r = Invoke-WebRequest -Uri "$url/api/health" -UseBasicParsing -TimeoutSec 2
        return $r.StatusCode -eq 200
    } catch { return $false }
}

# --- Prerequisites ---------------------------------------------------------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail "Node.js was not found. Install Node.js 20 or newer from https://nodejs.org and reopen PowerShell."
}
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) {
    Fail "Node.js $(node --version) is too old; the frontend needs Node.js 20 or newer."
}

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    Fail "WSL is not installed. Run 'wsl --install -d Ubuntu' in an administrator PowerShell, reboot, open Ubuntu once to create a user, then run this script again."
}
wsl.exe -e true 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Fail "WSL has no working Linux distribution. Run 'wsl --install -d Ubuntu', open Ubuntu once to create a user, then run this script again."
}

# --- Frontend --------------------------------------------------------------
Write-Host "Building frontend..."
Push-Location "$repo\frontend"
try {
    # Reinstall when node_modules is missing or older than the lockfile, so a stale
    # install (e.g. an old TypeScript) cannot break the build.
    $stamp = "node_modules\.package-lock.json"
    if (-not (Test-Path $stamp) -or
        (Get-Item "package-lock.json").LastWriteTime -gt (Get-Item $stamp).LastWriteTime) {
        npm ci
        if ($LASTEXITCODE -ne 0) { Fail "npm ci failed (see output above)." }
    }
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Fail "Frontend build failed (see output above). Try deleting frontend\node_modules and running this script again."
    }
} finally {
    Pop-Location
}

# --- Backend ---------------------------------------------------------------
if (Test-Backend) {
    Write-Host "Backend is already running."
} else {
    Write-Host "Starting backend in WSL2 in a new window (first run installs Python dependencies and can take several minutes)..."
    # --cd takes the Windows path directly; -e runs bash without another shell re-parsing
    # the command. The window stays open if the backend exits, so its error stays readable.
    $cmd = "./scripts/start-backend.sh; echo; echo 'Backend stopped. Press Enter to close.'; read"
    Start-Process wsl.exe -ArgumentList "--cd", "`"$repo`"", "-e", "bash", "-lc", "`"$cmd`""

    Write-Host -NoNewline "Waiting for $url "
    $deadline = (Get-Date).AddMinutes(20)
    while (-not (Test-Backend)) {
        if ((Get-Date) -gt $deadline) {
            Fail "The backend did not start within 20 minutes. Check the WSL window for errors."
        }
        Write-Host -NoNewline "."
        Start-Sleep -Seconds 3
    }
    Write-Host " ready."
}

Start-Process $url
Write-Host "Chemical Modelling is open at $url. Close the WSL window to stop the backend."
