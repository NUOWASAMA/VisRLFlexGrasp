# 文件功能：仿真模式一键启动脚本（Windows），依次拉起后端调度服务与算法服务
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-07-26
# 使用方式：在仓库根目录执行  powershell -File deploy/start_sim.ps1

$ErrorActionPreference = "Stop"
$repo_root = Split-Path -Parent $PSScriptRoot

# 统一环境标识：仿真模式
$env:VISRL_ENV = "sim"

Write-Host "[1/2] 启动后端调度服务..."
Start-Process python -ArgumentList "-m", "backend.main.main" -WorkingDirectory $repo_root

Start-Sleep -Seconds 2

Write-Host "[2/2] 启动算法服务..."
Start-Process python -ArgumentList "-m", "algorithm.algorithm_service" -WorkingDirectory $repo_root

Write-Host "启动完成。运动控制服务（C++）需先经 CMake 构建后手动启动：embedded/build/motion_control.exe"
