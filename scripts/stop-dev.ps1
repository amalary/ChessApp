$ErrorActionPreference = "Stop"

function Get-RepoRoot {
    return Split-Path -Parent $PSScriptRoot
}

function Stop-ByPid {
    param([int]$ProcessId)
    if (-not $ProcessId) {
        return
    }
    try {
        $proc = Get-Process -Id $ProcessId -ErrorAction Stop
        Stop-Process -Id $proc.Id -Force -ErrorAction Stop
        Write-Host "Stopped PID $ProcessId."
    } catch {
        Write-Host "PID $ProcessId already stopped."
    }
}

function Stop-ListenerByPort {
    param([int]$Port)

    $matches = netstat -ano | Select-String ":$Port"
    foreach ($entry in $matches) {
        $line = $entry.ToString().Trim()
        $parts = ($line -split "\s+") | Where-Object { $_ -ne "" }
        if ($parts.Count -lt 5) {
            continue
        }
        $listenerPid = [int]$parts[-1]
        if ($listenerPid -gt 0) {
            try {
                Stop-Process -Id $listenerPid -Force -ErrorAction Stop
                Write-Host "Stopped listener on port $Port (PID $listenerPid)."
            } catch {
                # ignore permission/process race conditions
            }
        }
    }
}

$repoRoot = Get-RepoRoot
$logsDir = Join-Path $repoRoot ".runlogs"
$pidsPath = Join-Path $logsDir "dev-processes.json"

if (Test-Path -LiteralPath $pidsPath) {
    $pids = Get-Content -LiteralPath $pidsPath -Raw | ConvertFrom-Json
    Stop-ByPid -ProcessId $pids.frontend_pid
    Stop-ByPid -ProcessId $pids.backend_pid
    Stop-ByPid -ProcessId $pids.proxy_pid
    Remove-Item -LiteralPath $pidsPath -Force
} else {
    Write-Host "No process file found; trying port-based cleanup."
}

# Extra cleanup for stale listeners.
Stop-ListenerByPort -Port 3000
Stop-ListenerByPort -Port 8010
Stop-ListenerByPort -Port 5432

Write-Host "Dev stack stop complete."
