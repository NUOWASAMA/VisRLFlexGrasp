# 文件功能：前端交互层一键启动脚本（Windows），拉起前端网关（HTTP 反向代理 + WebSocket 推送 + 静态托管）
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-11-11
# 使用方式：在仓库根目录执行  powershell -File deploy/start_frontend.ps1 [-Env dev|sim|real] [-Build]

param(
    [ValidateSet("dev", "sim", "real")][string]$Env = "sim",
    [switch]$Build
)

$ErrorActionPreference = "Stop"
$repo_root = Split-Path -Parent $PSScriptRoot
$task_frontend_dir = Join-Path $repo_root "frontend"
$task_log_dir = Join-Path $repo_root "logs"
New-Item -ItemType Directory -Path $task_log_dir -Force | Out-Null

# 校验 Node.js 与前端工程；依赖只通过 package.json / package-lock.json 安装，不写死版本路径
$task_node_cmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $task_node_cmd) {
    throw "未找到 Node.js，请先安装 Node.js 20.19 及以上版本并加入 PATH，然后重试"
}
$task_node_path = $task_node_cmd.Source
$task_node_version = (& $task_node_path --version).Trim()
$task_node_parts = ($task_node_version -replace '^v', '').Split('.')
$task_node_major = [int]$task_node_parts[0]
$task_node_minor = 0
if ($task_node_parts.Count -gt 1) { $task_node_minor = [int]$task_node_parts[1] }
if (($task_node_major -lt 20) -or (($task_node_major -eq 20) -and ($task_node_minor -lt 19))) {
    throw "当前 Node.js 版本为 $task_node_version，低于 frontend/package.json 要求的 20.19，请升级后重试"
}

$task_npm_cmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $task_npm_cmd) { $task_npm_cmd = Get-Command npm -ErrorAction SilentlyContinue }
if (-not $task_npm_cmd) { throw "未找到 npm，请检查 Node.js 安装是否完整" }
$task_npm_path = $task_npm_cmd.Source

$task_package_file = Join-Path $task_frontend_dir "package.json"
if (-not (Test-Path -LiteralPath $task_package_file)) {
    throw "未找到 frontend/package.json，请确认在完整仓库中执行本脚本"
}

# 读取网关监听地址，端口统一由 frontend/config/base.json 管理，脚本内不硬编码端口
$task_base_config = Get-Content -LiteralPath (Join-Path $task_frontend_dir "config/base.json") -Raw |
    ConvertFrom-Json
$task_gateway_host = [string]$task_base_config.gateway.host
$task_gateway_port = [int]$task_base_config.gateway.port
$task_dist_dir = Join-Path $task_frontend_dir "dist"

# 统一环境标识：dev / sim / real，未显式指定时默认仿真环境
$env:VISRL_ENV = $Env

# 1. 安装依赖：node_modules 缺失时按已锁定版本安装
if (-not (Test-Path -LiteralPath (Join-Path $task_frontend_dir "node_modules"))) {
    Write-Host "[1/3] 未检测到 frontend/node_modules，执行 npm install..."
    Push-Location $task_frontend_dir
    try {
        & $task_npm_path install
        if ($LASTEXITCODE -ne 0) { throw "npm install 失败，请检查网络与 npm 配置" }
    }
    finally {
        Pop-Location
    }
}
else {
    Write-Host "[1/3] 前端依赖已安装，跳过 npm install。"
}

# 2. 静态资源：dist 缺失或显式传入 -Build 时执行 npm run build，供网关同源托管
if ($Build -or (-not (Test-Path -LiteralPath $task_dist_dir))) {
    Write-Host "[2/3] 构建前端静态资源（npm run build）..."
    Push-Location $task_frontend_dir
    try {
        & $task_npm_path run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build 失败，请查看构建日志" }
    }
    finally {
        Pop-Location
    }
}
else {
    Write-Host "[2/3] 已存在 frontend/dist，跳过 npm run build（如需重建请加 -Build）。"
}

# 端口占用检查：网关需要独占监听端口
try {
    $task_listener = Get-NetTCPConnection -LocalPort $task_gateway_port -State Listen -ErrorAction SilentlyContinue
}
catch {
    $task_listener = $null
}
if ($task_listener) {
    throw ("端口 $task_gateway_port 已被占用，请先停止占用进程（" +
        "Get-NetTCPConnection -LocalPort $task_gateway_port -State Listen）后重试")
}

# 3. 启动前端网关；标准输出与错误输出写入 logs/，网关自身日志写入 logs/frontend/gateway.log
Write-Host "[3/3] 启动前端网关（环境：$Env，监听：$($task_gateway_host):$($task_gateway_port)）..."
Start-Process -FilePath $task_npm_path -ArgumentList "run", "gateway" -WorkingDirectory $task_frontend_dir `
    -WindowStyle Hidden -RedirectStandardOutput (Join-Path $task_log_dir "frontend.stdout.log") `
    -RedirectStandardError (Join-Path $task_log_dir "frontend.stderr.log")

# 等待端口监听就绪，避免脚本过早返回造成「启动成功」误判；最多等待 10 秒
$task_tcp_cmdlet = Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue
if ($task_tcp_cmdlet) {
    $task_listening = $null
    for ($task_index = 0; $task_index -lt 10; $task_index++) {
        Start-Sleep -Seconds 1
        try {
            $task_listening = Get-NetTCPConnection -LocalPort $task_gateway_port `
                -State Listen -ErrorAction SilentlyContinue
        }
        catch {
            $task_listening = $null
        }
        if ($task_listening) { break }
    }
    if (-not $task_listening) {
        Write-Host ("[失败] 10 秒内未检测到网关监听 $task_gateway_port 端口，" +
            "请查看 logs/frontend.stderr.log 与 logs/frontend.stdout.log")
        exit 1
    }
}
else {
    # 无 Get-NetTCPConnection 时退化为固定等待，不做端口探测
    Start-Sleep -Seconds 3
}

Write-Host ("启动完成。浏览器访问 http://$($task_gateway_host):$($task_gateway_port) ，" +
    "网关状态接口 /api/gateway/status；日志见 logs/frontend/gateway.log。")
Write-Host ("停止方式：Get-NetTCPConnection -LocalPort $task_gateway_port -State Listen | " +
    "ForEach-Object { Stop-Process -Id `$_.OwningProcess }")
