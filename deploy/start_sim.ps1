# 文件功能：仿真模式一键启动脚本（Windows），依次拉起后端调度服务与算法服务
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-07-26
# 使用方式：在仓库根目录执行  powershell -File deploy/start_sim.ps1

$ErrorActionPreference = "Stop"
$repo_root = Split-Path -Parent $PSScriptRoot
$task_python = Join-Path $repo_root ".venv/Scripts/python.exe"
if (-not (Test-Path -LiteralPath $task_python)) { $task_python = "python" }
& $task_python -c "import fastapi, uvicorn, pydantic"
if ($LASTEXITCODE -ne 0) { throw "请先安装 backend/main/requirements.txt 中的后端依赖" }
$task_log_dir = Join-Path $repo_root "logs"
New-Item -ItemType Directory -Path $task_log_dir -Force | Out-Null

# 统一环境标识：仿真模式
$env:VISRL_ENV = "sim"

Write-Host "[1/2] 启动后端调度服务..."
Start-Process -FilePath $task_python -ArgumentList "-m", "backend.main.main" -WorkingDirectory $repo_root `
    -WindowStyle Hidden -RedirectStandardOutput (Join-Path $task_log_dir "backend.stdout.log") `
    -RedirectStandardError (Join-Path $task_log_dir "backend.stderr.log")

Start-Sleep -Seconds 2

Write-Host "[2/2] 启动算法服务..."
Start-Process -FilePath $task_python -ArgumentList "-m", "algorithm.algorithm_service" -WorkingDirectory $repo_root `
    -WindowStyle Hidden -RedirectStandardOutput (Join-Path $task_log_dir "algorithm.stdout.log") `
    -RedirectStandardError (Join-Path $task_log_dir "algorithm.stderr.log")

Write-Host ("启动完成。运动控制服务（C++）构建后手动启动：" +
    "embedded/build/Release/motion_control.exe --config embedded/config/base.json；当前仅规划轨迹。")
