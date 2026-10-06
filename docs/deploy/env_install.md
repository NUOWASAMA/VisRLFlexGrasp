# 环境安装与部署指南

> 🚧 本文档为占位框架，各章节内容将随对应模块开发落地后补充，补充时须遵循 [STYLEGUIDE](../STYLEGUIDE.md) 第 6、7 章规范。

## 第 1 章 环境总览与版本清单

| 组件 | 版本 | 用途 | 负责人 |
| ---- | ---- | ---- | ------ |
| CoppeliaSim | 待定 | 机械臂仿真环境 | 嵌入式 |
| VS2022 + MSVC | C++17 | 嵌入式控制层编译 | 嵌入式 |
| CMake | ≥ 3.20 | C++ 构建系统 | 嵌入式 |
| Python | 3.9 | 算法层 / 后端服务 | 算法 / 后端 |
| Node.js | 待定 | 前端构建 | 前端 |

## 第 2 章 仿真环境安装（CoppeliaSim）

待补充：下载地址、版本锁定、场景文件加载、远程 API 配置。

## 第 3 章 嵌入式控制层环境（C++）

运动控制模块使用 C++17。Windows 开发环境需要 Visual Studio 2022 的“使用 C++ 的桌面开发”、
MSVC v143、Windows SDK 及 CMake >= 3.20；仅安装 MSVC 编译器而缺少 SDK 时会出现
`kernel32.lib`、UCRT 头文件或 `rc.exe` 缺失。

依赖统一为 Eigen 3.4.0 和 jsoncons 1.10.0。已下载源码放在
`embedded/third_party/eigen3/`、`embedded/third_party/jsoncons/`，缺失时 CMake 按固定
URL 与 SHA256 自动获取；源码缓存不入库。离线目录及覆盖选项见
[第三方依赖说明](../../embedded/third_party/README.md)。

仓库根目录执行：

```powershell
cmake -S embedded -B embedded/build -G "Visual Studio 17 2022" -A x64
cmake --build embedded/build --config Release --parallel
ctest --test-dir embedded/build -C Release --output-on-failure
$env:VISRL_ENV = "sim"
./embedded/build/Release/motion_control.exe --config embedded/config/base.json
```

运行服务前启动 Python 后端：`python -m backend.main.main`。服务自动注册、心跳和重连，
输出求解与轨迹规划结果，不执行抓取。`VISRL_ENV=real` 会明确拒绝启动，直到执行驱动实现。
使用单配置文件时可传 `--config path/to/service.json`；模型文件路径相对该配置文件的目录。
编译后的数学、协议和 TCP 集成测试随 CTest 运行；完整后端网关测试需 Python 3.10+。

若 SDK 安装不完整，可在 Developer PowerShell 中使用已有的完整 SDK，或临时提供
SDK 头文件、x64 导入库和 rc/mt 工具后用 Ninja 构建；不要把本机绝对路径写入仓库 CMake。

若源码所在移动盘拒绝启动新编译的 EXE，可把构建目录放到本机用户目录，源码仍保留原位置：

```powershell
$task_build_dir = Join-Path $env:LOCALAPPDATA "VisRLFlexGrasp/build"
cmake -S embedded -B $task_build_dir -G "Visual Studio 17 2022" -A x64
cmake --build $task_build_dir --config Release --parallel
ctest --test-dir $task_build_dir -C Release --output-on-failure
& "$task_build_dir/Release/motion_control.exe" --config embedded/config/base.json
```

## 第 4 章 算法层环境（Python）

待补充：虚拟环境创建、`requirements.txt` 安装、模型权重获取方式（外部存储链路）、GPU/CUDA 说明。

## 第 5 章 后端服务环境

第一阶段网关需要 Python 3.10+。仓库根目录执行：

```powershell
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r backend/main/requirements.txt
$env:VISRL_ENV = "sim"
./.venv/Scripts/python.exe -m backend.main.main
```

HTTP 默认端口 8000，内部模块 TCP 端口 9000，均由 `backend/config/base.json` 管理。
SQLite 默认文件 `database/visrl_grasp.db` 相对仓库定位，启动自动建表，历史任务重启后可查。
同一数据库仅支持一个后端进程；不要启动多 worker。遗留运行任务标为 interrupted，不自动重发。
API 文档入口为 `http://127.0.0.1:8000/docs`。请求示例、四个接口、错误码和测试方式见
[后端规划网关](../api/backend_gateway.md)。此阶段仅规划，real 模式拒绝启动。

## 第 6 章 前端环境

待补充：Node 版本、依赖安装、开发服务器启动、生产构建。

## 第 7 章 多环境配置切换（dev / sim / real）

待补充：各模块 `config/` 分级配置说明、`.env.example` 使用方式、`enable_hardware` 切换流程。

## 第 8 章 一键启动与故障排查

待补充：`deploy/` 一键启动脚本使用说明、常见问题与排查路径。
