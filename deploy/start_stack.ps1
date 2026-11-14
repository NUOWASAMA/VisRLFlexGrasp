# Start the local plan-only stack in dependency order.
# Usage: powershell -File deploy/start_stack.ps1
param(
    [ValidateSet("dev", "sim")][string]$Env = "sim"
)

$ErrorActionPreference = "Stop"
$repo_root = Split-Path -Parent $PSScriptRoot
$log_dir = Join-Path $repo_root "logs\stack"
$python = Join-Path $repo_root ".venv\Scripts\python.exe"
$frontend = Join-Path $repo_root "frontend"
$node_cmd = Get-Command node -ErrorAction SilentlyContinue

if (-not (Test-Path -LiteralPath $python)) { throw "未找到 .venv\Scripts\python.exe，请先安装后端依赖" }
if (-not $node_cmd) { throw "未找到 Node.js，请安装 Node.js 20.19 或更高版本" }
New-Item -ItemType Directory -Path $log_dir -Force | Out-Null
$env:VISRL_ENV = $Env

function Test-TcpListener([int]$Port) {
    $listener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return $null -ne $listener
}

function Wait-Http([string]$Uri, [int]$Seconds = 20) {
    for ($attempt = 0; $attempt -lt $Seconds; $attempt++) {
        try {
            $reply = Invoke-RestMethod -Uri $Uri -TimeoutSec 2
            if ($reply.code -eq 0) { return $reply }
        }
        catch { Start-Sleep -Seconds 1 }
    }
    throw "服务未就绪：$Uri；请查看 logs\stack 下的日志"
}

function Start-LoggedProcess([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory, [string]$Name) {
    Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory `
        -WindowStyle Hidden -RedirectStandardOutput (Join-Path $log_dir "$Name.stdout.log") `
        -RedirectStandardError (Join-Path $log_dir "$Name.stderr.log") | Out-Null
}

# Backend is the dependency for both TCP clients.
if (-not (Test-TcpListener 8000) -or -not (Test-TcpListener 9000)) {
    $api_listening = Test-TcpListener 8000
    $tcp_listening = Test-TcpListener 9000
    if ($api_listening -or $tcp_listening) {
        throw "后端端口 8000/9000 状态不一致；请先检查并停止残留进程"
    }
    Start-LoggedProcess $python @("-m", "backend.main.main") $repo_root "backend"
}
$null = Wait-Http "http://127.0.0.1:8000/health"
if (-not (Test-TcpListener 9000)) { throw "后端 HTTP 已启动，但 TCP 端口 9000 未监听" }

# Start algorithm only when it is not already connected to the backend.
$tcp_status = Wait-Http "http://127.0.0.1:8000/robot/status"
$algo_process = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -match "algorithm\.algorithm_service"
} | Select-Object -First 1
if (-not $algo_process) {
    Start-LoggedProcess $python @("-m", "algorithm.algorithm_service") $repo_root "algorithm"
}

# Prefer the documented Release artifact, then use the existing native build.
$motion_candidates = @(
    (Join-Path $repo_root "embedded\build\Release\motion_control.exe"),
    (Join-Path $repo_root "embedded\build\native\motion_control.exe")
)
$motion_path = $motion_candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $motion_path) { throw "未找到 motion_control.exe；请先按 docs/deploy/env_install.md 构建 C++ 服务" }
$motion_process = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "motion_control.exe" } | Select-Object -First 1
if (-not $motion_process -and -not $tcp_status.data.motion_online) {
    Start-LoggedProcess $motion_path @("--config", "embedded\config\base.json") $repo_root "motion"
}

# Build the SPA once and start the same-origin gateway.
if (-not (Test-Path -LiteralPath (Join-Path $frontend "node_modules"))) {
    Push-Location $frontend
    try { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw "npm ci 失败" } }
    finally { Pop-Location }
}
if (-not (Test-Path -LiteralPath (Join-Path $frontend "dist\index.html"))) {
    Push-Location $frontend
    try { & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw "前端构建失败" } }
    finally { Pop-Location }
}
if (-not (Test-TcpListener 8080)) {
    Start-LoggedProcess $node_cmd.Source @("gateway\main.mjs") $frontend "frontend"
}
$null = Wait-Http "http://127.0.0.1:8080/api/gateway/status"
$robot_status = Wait-Http "http://127.0.0.1:8000/robot/status"
if (-not $robot_status.data.motion_online) { throw "运动服务尚未注册；查看 logs\stack\motion.stderr.log" }

Write-Host "仿真规划栈已就绪："
Write-Host "  前端：http://127.0.0.1:8080"
Write-Host "  后端：http://127.0.0.1:8000/docs"
Write-Host "  运动服务在线：$($robot_status.data.motion_online)（仅规划，不执行抓取）"
Write-Host "  日志：$log_dir"
