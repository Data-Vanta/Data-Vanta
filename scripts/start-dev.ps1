# Start all Vanta dev services, each in its own labeled PowerShell window.
# Differs from `npm run dev` (scripts/dev.mjs) in that you get per-service
# logs in separate terminals, easy to focus on or close one without taking
# the others down.
#
# Usage:
#   .\scripts\start-dev.ps1                # start docker postgres + 3 native services
#   .\scripts\start-dev.ps1 -NoDocker      # skip docker postgres (already up)
#
# To stop everything fast:  .\scripts\stop-dev.ps1
#
# If PowerShell refuses to run this script, either:
#   1) enable scripts once for your user:  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
#   2) or invoke with bypass:              powershell -ExecutionPolicy Bypass -File .\scripts\start-dev.ps1

[CmdletBinding()]
param(
    [switch]$NoDocker
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

# --- Pre-flight: warn about ports already in use ----------------------------
$ports = @(3000, 5000, 8000)
$inUse = @()
foreach ($p in $ports) {
    if (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) {
        $inUse += $p
    }
}
if ($inUse.Count -gt 0) {
    Write-Warning ("Ports already in use: {0}. Run .\scripts\stop-dev.ps1 first or expect EADDRINUSE." -f ($inUse -join ', '))
}

# --- Docker: auth Postgres --------------------------------------------------
if (-not $NoDocker) {
    Write-Host "Starting auth Postgres container..." -ForegroundColor Cyan
    docker compose -f (Join-Path $repo 'back_end/user-auth-main/docker-compose.yml') up -d
    Write-Host ""
}

# --- Helper: open a labeled PS window in a working directory ----------------
function Start-ServiceWindow {
    param(
        [Parameter(Mandatory)] [string]$Title,
        [Parameter(Mandatory)] [string]$WorkDir,
        [Parameter(Mandatory)] [string]$Command
    )
    $escWorkDir = $WorkDir.Replace("'", "''")
    $escCommand = $Command.Replace("'", "''")
    $escTitle   = $Title.Replace("'", "''")
    $inner = "`$Host.UI.RawUI.WindowTitle = '$escTitle'; Set-Location -LiteralPath '$escWorkDir'; Write-Host '>>> $escTitle' -ForegroundColor Cyan; $escCommand"
    Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit', '-Command', $inner) | Out-Null
}

# --- Engine (8000): Python FastAPI + DuckDB ---------------------------------
$enginePython = Join-Path $repo 'back_end/Chart-API-main/venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $enginePython)) {
    Write-Error "Engine venv python not found at: $enginePython. Recreate the venv: cd back_end/Chart-API-main; python -m venv venv; .\venv\Scripts\pip install -r requirements.txt"
    exit 1
}

Write-Host "Opening service windows..." -ForegroundColor Cyan

Start-ServiceWindow `
    -Title 'Vanta - auth (5000)' `
    -WorkDir (Join-Path $repo 'back_end/user-auth-main') `
    -Command 'npm start'

Start-ServiceWindow `
    -Title 'Vanta - engine (8000)' `
    -WorkDir (Join-Path $repo 'back_end/Chart-API-main') `
    -Command './venv/Scripts/python.exe main.py'

Start-ServiceWindow `
    -Title 'Vanta - front (3000)' `
    -WorkDir (Join-Path $repo 'Front_end/vanta-auth-ui') `
    -Command 'npm run dev'

Write-Host ""
Write-Host "Three windows opened. Wait ~10s, then visit http://localhost:3000" -ForegroundColor Green
Write-Host "To stop everything fast:  .\scripts\stop-dev.ps1" -ForegroundColor Cyan
Write-Host ""
