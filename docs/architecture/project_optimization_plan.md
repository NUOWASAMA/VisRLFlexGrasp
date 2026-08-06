# 项目结构优化与开发推进方案

版本：V1.0 ｜ 日期：2026-07-26 ｜ 状态：结构优化部分已实施

## 第 1 章 现状分析

### 1.1 项目所处阶段

仓库当前为**架构骨架阶段**：目录树已按六层架构搭建，但所有模块目录均为空（仅 `.gitkeep` 占位），尚无任何业务代码；已有交付物为 `README.md`、`LICENSE`、`docs/STYLEGUIDE.md`。

### 1.2 本次排查发现的问题

| 问题 | 违反规约条款 | 处理状态 |
| ---- | ------------ | -------- |
| 缺少 `.gitignore`，构建产物 / 敏感配置无法自动过滤 | STYLEGUIDE 2.5 / 5.4 | ✅ 已补充 |
| `docs/` 无分类子目录（architecture / api / deploy / assets） | STYLEGUIDE 2.2 / 7.2 | ✅ 已补充 |
| `algorithm/`、`embedded/` 缺少 `assets/` 静态资源目录 | STYLEGUIDE 2.4 | ✅ 已补充 |
| `algorithm/`、`embedded/` 缺少 `config/` 分级配置目录 | STYLEGUIDE 2.4 / 6.2 | ✅ 已补充 |
| `embedded/cmake/` 在 README 目录树中声明但实际不存在 | 文档与结构不一致 | ✅ 已补充 |
| `tests/` 无单元 / 集成 / 全链路分类 | README 目录树声明 | ✅ 已拆分为 unit / integration / e2e |
| README 存在大量占位符（HHHH、失效链接、附件残留） | STYLEGUIDE 7.4 | ✅ 已重写 |
| README 引用的 `docs/env_install` 文档不存在 | 死链 | ✅ 已建 `docs/deploy/env_install.md` 框架 |
| STYLEGUIDE 第 4.5、4.6、5.1、6.1、6.2 节存在文字残缺（如 `in:`→`main:`、`ature/xxx`→`feature/xxx`、`ython`→`Python`） | 文档质量 | ✅ 已修复 |

## 第 2 章 结构优化方案（已实施）

### 2.1 新增目录

```text
docs/architecture/    # 架构设计文档（本方案存放于此）
docs/api/             # 接口与通信协议文档
docs/deploy/          # 部署与环境安装文档
docs/assets/          # 文档配图、架构图源文件
algorithm/assets/     # 视觉模型、数据集资源（>10MB 走外部存储）
algorithm/config/     # 算法模块 base/dev/sim/real 分级配置
embedded/assets/      # 仿真场景、机械臂模型文件
embedded/config/      # 控制模块分级配置
embedded/cmake/       # CMake 编译配置
tests/unit/           # 单元测试
tests/integration/    # 集成测试
tests/e2e/            # 全链路验证
```

### 2.2 新增文件

* `.gitignore`：覆盖 Python / C++ / Node 构建产物、`.env` 敏感配置、`tmp_*` 临时文件、模型权重与数据库文件。
* `docs/deploy/env_install.md`：环境安装文档框架，随模块落地补充。

### 2.3 后续结构约定（待各模块首次提交时落实）

| 模块 | 首次提交须包含 | 责任人 |
| ---- | -------------- | ------ |
| backend | `main/requirements.txt`（版本锁定）、`config/` 下 base/dev/sim/real 四级配置模板、`.env.example` | 后端 |
| algorithm | `requirements.txt`、数据集获取脚本（权重不入库） | 算法 |
| embedded | 顶层 `CMakeLists.txt`、`cmake/` 工具链配置 | 嵌入式 |
| frontend | `package.json`（锁定 Node 版本）、脚手架配置 | 前端 |
| deploy | 仿真模式一键启动脚本（含各服务启动顺序编排） | 后端 |
| common | JSON 报文结构与全局错误码字典（先于各模块联调完成） | 负责人 + 后端 |

## 第 3 章 README 更新说明（已实施）

* 移除首行附件残留链接、失效的「官网 / 文档」占位链接、不存在的图片引用（Logo 改为注释占位，指向 `docs/assets/logo.png`）。
* 「核心功能」四宫格由 `HHHH` 占位替换为实际功能描述（视觉感知 / RL 决策 / 柔性力控 / 调度可视化）。
* 「项目创新点」由占位符替换为四条实际创新点。
* 「快速开始」标注项目所处阶段，补充版本兼容性表格与源码获取命令，未落地步骤统一标注「待补充」。
* 目录树与磁盘实际结构完全对齐（含本次新增目录），修复缩进错乱。
* 修复 `docs/STYLEGUIDE`、`docs/env_install` 死链，前端成员占位信息统一为「待定」。

**README 后续维护清单**（对应内容就绪后更新）：

- [ ] Logo 与场景配图（`docs/assets/`）
- [ ] Demo 演示视频（随 v0.1.0 发布）
- [ ] CoppeliaSim / Node.js 版本锁定
- [ ] 硬件配置要求
- [ ] 快速开始第 4-9 步可执行命令

## 第 4 章 开发推进路线图（建议）

### 4.1 里程碑规划

| 里程碑 | 目标 | 核心交付物 |
| ------ | ---- | ---------- |
| M1 接口冻结 | 全局通信协议与错误码定义完成 | `common/` 协议定义、`docs/api/tcp_communication_spec.md` |
| M2 单模块跑通 | 各模块独立可运行 | 算法离线推理 demo、C++ 连通 CoppeliaSim、后端 TCP 服务、前端静态页面 |
| M3 仿真联调（v0.1.0） | 仿真环境全链路分拣闭环 | 一键启动脚本、Demo 视频、打 Tag `v0.1.0` |
| M4 策略优化 | RL 策略训练收敛、降级策略验证 | 训练脚本与评估报告 |
| M5 实物部署（v1.0.0） | `enable_hardware` 切换实体硬件验收 | 部署文档、结题材料 |

### 4.2 关键依赖与风险

* **接口先行**：M1 未冻结前各模块不得私自定义报文格式（STYLEGUIDE 4.2），否则联调返工成本高。
* **仿真先行**：所有功能先过仿真验证再上实体（STYLEGUIDE 6.4）。
* **大文件管控**：模型权重、数据集、仿真场景文件普遍超 10MB，需在 M2 前确定外部存储分发方式（网盘 / Release / Git LFS 择一），避免误提交撑爆仓库。
* **前端人员未定**：M2 前需确认前端开发成员，否则前端里程碑顺延。

### 4.3 分支与协作执行要点

* 各模块从 `dev` 切 `feature/xxx` 分支开发，PR 合入 `dev`，里程碑节点由 `dev` 合入 `main` 并打 Tag。
* 每个 PR 附带对应文档更新（STYLEGUIDE 7.4），评审时同步检查。
