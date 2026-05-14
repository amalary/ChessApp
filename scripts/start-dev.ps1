$ErrorActionPreference = "Stop"

function Get-RepoRoot {
    return Split-Path -Parent $PSScriptRoot
}

function Get-EnvMap {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $map = @{}
    if (-not (Test-Path -LiteralPath $Path)) {
        return $map
    }

    Get-Content -LiteralPath $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) {
            return
        }
        $parts = $line.Split("=", 2)
        if ($parts.Count -ne 2) {
            return
        }
        $key = $parts[0].Trim()
        $value = $parts[1].Trim().Trim("'`"")
        if ($key) {
            $map[$key] = $value
        }
    }
    return $map
}

function Test-LocalPort {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port
    )

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        $connected = $async.AsyncWaitHandle.WaitOne(350)
        if (-not $connected) {
            return $false
        }
        $client.EndConnect($async) | Out-Null
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Wait-ForPort {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port,
        [int]$TimeoutSeconds = 20
    )

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        if (Test-LocalPort -Port $Port) {
            return $true
        }
        Start-Sleep -Milliseconds 400
    }
    return $false
}

function Test-BackendHealth {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:8010/health" -Method GET -TimeoutSec 3
        return ($null -ne $health -and $health.status -eq "ok")
    } catch {
        return $false
    }
}

function Test-AgentChatRoute {
    try {
        $payload = @{
            query = "Where can I change app settings?"
            limit = 1
        } | ConvertTo-Json -Compress

        $chat = Invoke-RestMethod -Uri "http://127.0.0.1:8010/agent/chat" `
            -Method POST `
            -ContentType "application/json" `
            -Body $payload `
            -TimeoutSec 5

        return (
            $null -ne $chat -and
            $chat.PSObject.Properties.Name -contains "answer" -and
            -not [string]::IsNullOrWhiteSpace([string]$chat.answer)
        )
    } catch {
        return $false
    }
}

function Wait-ForBackendReady {
    param([int]$TimeoutSeconds = 40)

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        if (Test-BackendHealth) {
            return $true
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Test-CodexOutboundBlockRuleEnabled {
    try {
        $rule = netsh advfirewall firewall show rule name="codex_sandbox_offline_block_outbound" 2>$null
        if (-not $rule) {
            return $false
        }
        return ($rule -join "`n") -match "Enabled:\s+Yes"
    } catch {
        return $false
    }
}

$repoRoot = Get-RepoRoot
$logsDir = Join-Path $repoRoot ".runlogs"
$pidsPath = Join-Path $logsDir "dev-processes.json"

New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

if (Test-CodexOutboundBlockRuleEnabled) {
    Write-Warning "Detected enabled firewall rule 'codex_sandbox_offline_block_outbound' (global outbound block). Agent chat and external APIs may fail until this rule is disabled in an elevated Administrator shell."
}

$proxyExe = Join-Path $repoRoot "backend\tools\cloud-sql-proxy.exe"
$proxyCreds = Join-Path $repoRoot "keys\sa.json"
$backendPy = Join-Path $repoRoot "backend\.venv\Scripts\python.exe"
$backendDir = Join-Path $repoRoot "backend"
$frontendDir = Join-Path $repoRoot "frontend"
$npmCmd = "npm.cmd"

foreach ($required in @($proxyExe, $proxyCreds, $backendPy)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Missing required file: $required"
    }
}

$envMap = Get-EnvMap -Path (Join-Path $repoRoot ".env")
$dbUser = if ($envMap.ContainsKey("DB_USER")) { $envMap["DB_USER"] } else { "app_user" }
$dbPassword = if ($envMap.ContainsKey("DB_PASSWORD")) { $envMap["DB_PASSWORD"] } else { "MalaryOctober10" }
$dbName = if ($envMap.ContainsKey("DB_NAME")) { $envMap["DB_NAME"] } else { "chessapp" }
$dbHost = if ($envMap.ContainsKey("DB_HOST")) { $envMap["DB_HOST"] } else { "127.0.0.1" }
$dbPort = if ($envMap.ContainsKey("DB_PORT")) { $envMap["DB_PORT"] } else { "5432" }
$requireAgentChatReadiness = $false
if ($envMap.ContainsKey("START_DEV_REQUIRE_AGENT_CHAT")) {
    $rawRequire = [string]$envMap["START_DEV_REQUIRE_AGENT_CHAT"]
    $requireAgentChatReadiness = $rawRequire.Trim().ToLower() -in @("1", "true", "yes", "on")
}

$processes = @{
    started_at = (Get-Date).ToString("o")
    proxy_pid = $null
    backend_pid = $null
    frontend_pid = $null
}

# Start proxy if not already listening.
if (Test-LocalPort -Port 5432) {
    Write-Host "Proxy: port 5432 already in use, skipping start."
} else {
    $proxyOut = Join-Path $logsDir "proxy.out.log"
    $proxyErr = Join-Path $logsDir "proxy.err.log"
    $proxyArgs = @(
        "--credentials-file=$proxyCreds",
        "--port=5432",
        "chessapp-477519:us-west2:chess-app-project"
    )
    $proxyProc = Start-Process -FilePath $proxyExe `
        -ArgumentList $proxyArgs `
        -WorkingDirectory $repoRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $proxyOut `
        -RedirectStandardError $proxyErr `
        -PassThru
    if (-not (Wait-ForPort -Port 5432 -TimeoutSeconds 20)) {
        throw "Proxy failed to bind to 5432. See $proxyErr"
    }
    $processes.proxy_pid = $proxyProc.Id
    Write-Host "Proxy: started (PID $($proxyProc.Id))."
}

# Start backend if not already listening.
if (Test-LocalPort -Port 8010) {
    if (-not (Wait-ForBackendReady -TimeoutSeconds 8)) {
        throw "Backend port 8010 is already in use, but /health check failed. Run npm run dev:stop and then npm run dev:all."
    }
    if (-not (Test-AgentChatRoute)) {
        $msg = "Backend: /health is OK but /agent/chat check failed."
        if ($requireAgentChatReadiness) {
            throw "$msg Set START_DEV_REQUIRE_AGENT_CHAT=false (or remove it) to allow degraded startup."
        }
        Write-Warning "$msg Agent features may be unavailable until API key/retrieval issues are fixed."
    } else {
        Write-Host "Backend: already running and agent endpoint is healthy."
    }
} else {
    $backendOut = Join-Path $logsDir "backend.out.log"
    $backendErr = Join-Path $logsDir "backend.err.log"
    $backendCommand = @"
Set-Location '$backendDir'
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
`$env:DB_USER='$dbUser'
`$env:DB_PASSWORD='$dbPassword'
`$env:DB_NAME='$dbName'
`$env:DB_HOST='$dbHost'
`$env:DB_PORT='$dbPort'
& '$backendPy' -m uvicorn app.main:app --host 127.0.0.1 --port 8010
"@
    $backendProc = Start-Process -FilePath "powershell.exe" `
        -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $backendCommand) `
        -WorkingDirectory $backendDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput $backendOut `
        -RedirectStandardError $backendErr `
        -PassThru
    if (-not (Wait-ForPort -Port 8010 -TimeoutSeconds 30)) {
        throw "Backend failed to bind to 8010. See $backendErr"
    }
    if (-not (Wait-ForBackendReady -TimeoutSeconds 40)) {
        throw "Backend started but /health check failed. See $backendErr"
    }
    if (-not (Test-AgentChatRoute)) {
        $msg = "Backend: started (PID $($backendProc.Id)); /health is OK but /agent/chat check failed."
        if ($requireAgentChatReadiness) {
            throw "$msg See $backendErr"
        }
        Write-Warning "$msg Agent features may be unavailable until API key/retrieval issues are fixed."
    } else {
        Write-Host "Backend: started (PID $($backendProc.Id)) and agent endpoint is healthy."
    }
    $processes.backend_pid = $backendProc.Id
}

# Start frontend if not already listening on 3000.
if (Test-LocalPort -Port 3000) {
    Write-Host "Frontend: port 3000 already in use, skipping start."
} else {
    $frontendOut = Join-Path $logsDir "frontend.out.log"
    $frontendErr = Join-Path $logsDir "frontend.err.log"
    $frontendProc = Start-Process -FilePath $npmCmd `
        -ArgumentList @("run", "dev") `
        -WorkingDirectory $frontendDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput $frontendOut `
        -RedirectStandardError $frontendErr `
        -PassThru
    $processes.frontend_pid = $frontendProc.Id
    Write-Host "Frontend: started (PID $($frontendProc.Id))."
}

$processes | ConvertTo-Json | Set-Content -LiteralPath $pidsPath -Encoding UTF8

Write-Host ""
Write-Host "Dev stack ready."
Write-Host "  Frontend: http://localhost:3000"
Write-Host "  Solve test: http://localhost:3000/solve-test"
Write-Host "  Backend health: http://127.0.0.1:8010/health"
Write-Host ""
Write-Host "Logs: $logsDir"
Write-Host "Stop command: npm run dev:stop"
