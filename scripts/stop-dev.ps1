# Fast-stop all Vanta dev services by killing the listeners on their ports.
# Bypasses graceful shutdown drain (HMR websockets, SSE streams, DB pools)
# which is what makes Ctrl+C feel slow.
#
# Usage:
#   .\scripts\stop-dev.ps1                # kill front (3000), auth (5000), engine (8000)
#   .\scripts\stop-dev.ps1 -Docker        # also `docker compose down` the auth Postgres
#   .\scripts\stop-dev.ps1 -Ports 3000    # custom port list
#
# If PowerShell refuses to run this script, either:
#   1) enable scripts once for your user:  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
#   2) or invoke with bypass:              powershell -ExecutionPolicy Bypass -File .\scripts\stop-dev.ps1

[CmdletBinding()]
param(
    [int[]]$Ports = @(3000, 5000, 8000),
    [switch]$Docker
)

$ErrorActionPreference = 'Continue'
$killed = 0

Write-Host ""
Write-Host "Stopping Vanta dev services..." -ForegroundColor Cyan

foreach ($port in $Ports) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) {
        Write-Host ("  port {0,-5} -- no listener" -f $port) -ForegroundColor DarkGray
        continue
    }
    $procIds = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $procIds) {
        try {
            $proc = Get-Process -Id $procId -ErrorAction Stop
            Stop-Process -Id $procId -Force -ErrorAction Stop
            Write-Host ("  port {0,-5} -> killed PID {1} ({2})" -f $port, $procId, $proc.ProcessName) -ForegroundColor Green
            $killed++
        } catch {
            Write-Warning ("  port {0,-5} -> failed to kill PID {1} : {2}" -f $port, $procId, $_.Exception.Message)
        }
    }
}

if ($Docker) {
    $repo = Split-Path -Parent $PSScriptRoot
    Write-Host ""
    Write-Host "Stopping auth Postgres container..." -ForegroundColor Cyan
    docker compose -f (Join-Path $repo 'back_end/user-auth-main/docker-compose.yml') down
}

Write-Host ""
Write-Host ("Done. Stopped {0} process(es)." -f $killed) -ForegroundColor Cyan
Write-Host ""
