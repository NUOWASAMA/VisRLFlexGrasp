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
API 文档入口为 `http://127.0.0.1:8000/docs`。请求示例、接口清单、错误码和测试方式见
[后端规划网关](../api/backend_gateway.md)。此阶段仅规划，real 模式拒绝启动。

## 第 6 章 前端环境

前端交互层包含 Node 前端网关与 Vue3 + ECharts 可视化界面，统一在 `frontend/` 内管理。
推荐 Node.js **24.21.0**、npm **11.19.0**（`frontend/package.json` 约束 Node ≥ 20.19）。
依赖版本已由 `frontend/package-lock.json` 锁定（Vue 3.5.45、vue-router 4.6.4、ECharts 6.1.0、
ws 8.22.2、Vite 8.3.8），安装时不要手工升级。

```powershell
cd frontend
npm install
```

开发模式需要两个终端，前端网关与 Vite 开发服务器分别启动：

```powershell
# 终端一：启动前端网关（HTTP 反向代理 + WebSocket 推送 + 静态托管，默认 127.0.0.1:8080）
cd frontend
npm run gateway

# 终端二：启动 Vite 开发服务器（默认 127.0.0.1:5173，/api 与 /ws 代理到网关）
cd frontend
npm run dev
```

浏览器访问 `http://127.0.0.1:5173`。开发服务器只负责页面热更新与代理，业务请求仍由前端网关
转发给后端，不直接跨域访问 `127.0.0.1:8000`。

生产模式由网关同源托管构建产物，不需要额外的静态文件服务器：

```powershell
cd frontend
npm run build     # 产物输出到 frontend/dist（已加入 .gitignore，不入库）
npm run gateway   # 网关托管 dist，浏览器访问 http://127.0.0.1:8080
```

环境切换遵循 STYLEGUIDE 6.3，通过环境变量 `VISRL_ENV`（取值 `dev` / `sim` / `real`，缺省 `sim`）
选择 `frontend/config/` 下 `base.json` 与环境覆盖文件的深度合并结果；也可以单文件配置直接指定
合并结果：在 `frontend/` 目录执行 `node gateway/main.mjs --config <单文件配置>`，或在仓库根目录执行
`node frontend/gateway/main.mjs --config <单文件配置>`（配置与日志路径按入口文件位置推导的仓库根解析，
与当前工作目录无关）。
`real` 目前只影响配置取值，后端与 C++ 运动控制服务在 real 模式下仍明确拒绝启动。

| 服务 | 默认地址 | 配置来源 |
| ---- | -------- | -------- |
| 前端网关 HTTP / WebSocket | `127.0.0.1:8080` | `frontend/config/base.json` 的 `gateway.host`、`gateway.port`、`gateway.ws_path` |
| Vite 开发服务器 | `127.0.0.1:5173` | `frontend/vite.config.js` |
| 后端 HTTP API | `127.0.0.1:8000` | `backend/config/base.json` 的 `api` |
| 内部模块 TCP | `127.0.0.1:9000` | `backend/config/base.json` 的 `server` |

网关日志默认写入 `logs/frontend/gateway.log`（按 1 MiB 轮转、保留三份），
`deploy/start_frontend.ps1` 启动时还会把标准输出与错误输出分别重定向到
`logs/frontend.stdout.log`、`logs/frontend.stderr.log`。接口与报文契约见
[前端网关接口文档](../api/frontend_gateway.md)。前端网关的 Node 单元测试：

```powershell
cd frontend
npm test
```

## 第 7 章 多环境配置切换（dev / sim / real）

待补充：各模块 `config/` 分级配置说明、`.env.example` 使用方式、`enable_hardware` 切换流程。

## 第 8 章 一键启动与故障排查

### 8.1 一键启动脚本

仿真模式按「后端 → 运动控制（C++）→ 前端网关」的依赖顺序启动，运动控制服务仍需手动构建并启动：

| 脚本 | 作用 | 启动的服务 |
| ---- | ---- | ---------- |
| `deploy/start_sim.ps1` | 仿真模式拉起后端调度服务与算法服务 | `backend.main.main`、`algorithm.algorithm_service` |
| `deploy/start_frontend.ps1` | 前端网关一键启动 | `npm run gateway`（必要时先 `npm install`，`frontend/dist` 缺失时先 `npm run build`） |

仓库根目录执行：

```powershell
powershell -File deploy/start_sim.ps1
powershell -File deploy/start_frontend.ps1
powershell -File deploy/start_frontend.ps1 -Env dev -Build
```

`deploy/start_frontend.ps1` 支持两个可选参数：`-Env`（`dev` / `sim` / `real`，缺省 `sim`，
作为 `VISRL_ENV` 传给前端网关）与 `-Build`（强制重新执行 `npm run build`）。
脚本会依次检查 Node.js 版本（≥ 20.19）、`frontend/package.json`、依赖目录与网关端口占用，
通过后以隐藏窗口启动 `npm run gateway`；标准输出与错误分别写入 `logs/frontend.stdout.log`、
`logs/frontend.stderr.log`，网关自身日志为 `logs/frontend/gateway.log`。
脚本不负责启动后端、算法与 C++ 运动控制服务，启动完成后浏览器访问 `http://127.0.0.1:8080`。
脚本会在启动后最多等待 10 秒探测端口监听，确认网关就绪才打印「启动完成」，随后立即返回、不阻塞终端；
网关在后台运行，停止时结束监听该端口的进程（端口以 `frontend/config/base.json` 为准）：

```powershell
Get-NetTCPConnection -LocalPort 8080 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess }
```

### 8.2 常见问题与排查路径

| 现象 | 可能原因 | 处理 |
| ---- | -------- | ---- |
| 启动脚本报「未找到 Node.js」 | 未安装 Node.js 或未加入 PATH | 安装 Node.js 20.19 及以上版本（推荐 24.21.0），重新打开终端 |
| `npm install` 失败 | 网络 / 代理 / npm 配置问题 | 配置可用镜像后重试 `cd frontend; npm install`；不要手工修改 `package-lock.json` |
| 页面能打开，但 `/api/*` 返回 503（`code=4000`） | 后端未启动，或后端与 motion 的连接不可用 | 先运行 `deploy/start_sim.ps1`；检查 `http://127.0.0.1:8000/health` 与 `GET /robot/status` |
| 页面提示先构建 `dist` | 生产模式未执行 `npm run build` | `cd frontend; npm run build`，或启动脚本加 `-Build` 参数 |
| WebSocket 断开后自动重连 | 网关重启或页面网络中断，属于预期行为 | 界面顶部连接状态会显示；浏览器侧按 `frontend/src/config/defaults.js` 的 1s/3s/5s 递增重连（与网关到后端的 `gateway.reconnect_intervals_sec` 是两套独立机制），无需手工干预 |
| 任务下发返回 `code=4000` | 前端网关与后端内部 TCP 未连接或未完成注册 | 查看 `/api/gateway/status` 的 `tcp_connected`、`registered` 字段和网关日志 |
| 端口 8080 被占用，脚本启动失败 | 已有其它网关实例或程序监听该端口 | `Get-NetTCPConnection -LocalPort 8080 -State Listen` 找到占用进程后停止 |
| 脚本报「10 秒内未检测到网关监听」 | 配置非法、依赖缺失或网关启动异常 | 查看 `logs/frontend.stderr.log`、`logs/frontend.stdout.log` 与 `logs/frontend/gateway.log` 末尾错误 |
| 后端日志出现错误码 `3003`（同名在线模块） | 重复启动了前端网关，后端拒绝同名模块的第二条连接 | 只保留一个网关实例；网关会退避重试，不要靠反复重启后端规避 |
| 刷新子路由页面出现 404 | 静态托管由网关提供 SPA 回退，未通过网关访问或 `dist` 未构建 | 确认 `npm run build` 后经 `http://127.0.0.1:8080` 访问，不要直接打开 `dist/index.html` |
| 前端页面数据为空但网关在线 | 后端尚无任务记录，或 motion 未启动导致 `/robot/status` 显示离线 | 查看 `GET /api/robot/status` 的 `motion_online`、`feedback_source` 字段 |
| `powershell -File deploy/start_sim.ps1` 报语法错误或中文乱码 | 该脚本为 UTF-8 无 BOM 编码，Windows PowerShell 5.1 会按 ANSI 解码中文导致解析失败（预存问题，非本轮引入） | 改用 PowerShell 7 执行 `pwsh -File deploy/start_sim.ps1`，或按第 5 章手动启动后端与算法服务；本轮未改动既有脚本 |
