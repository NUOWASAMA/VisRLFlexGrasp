# 技术选型调研记录

版本：V1.0 ｜ 日期：2026-07-26 ｜ 结论已在地基代码中落地

## 第 1 章 选型结论

| 方向 | 选型 | 理由 |
| ---- | ---- | ---- |
| 仿真接口 | CoppeliaSim **ZMQ Remote API**（Python 端 `coppeliasim-zmqremoteapi-client`，C++ 端 cppzmq） | 官方自 CoppeliaSim 4.4 起弃用旧版 Legacy Remote API，ZMQ 方案为当前唯一推荐路线；最新稳定版为 4.10（2025-05） |
| 视觉检测 | **YOLOv8**（ultralytics） | 果蔬检测领域论文与工程项目主流方案，有农业软体夹爪抓取系统实测 95.83% 抓取成功率的先例；与 OpenCV/PyTorch 生态兼容 |
| 强化学习 | **Gymnasium + Stable-Baselines3**（PPO 起步） | SB3 为 PyTorch 生态最成熟的 RL 算法库，标准 Gym 接口便于自定义仿真环境接入；社区有 CoppeliaSim + RL 抓取项目可参考 |
| 跨模块通信 | TCP + **NDJSON**（换行分隔 JSON） | 跨 Python/C++ 实现成本最低，分帧简单可靠，符合 STYLEGUIDE 第 4 章 JSON 报文规约 |

## 第 2 章 参考资料

* [CoppeliaSim 官方手册：ZeroMQ remote API](https://manual.coppeliarobotics.com/en/zmqRemoteApiOverview.htm)
* [CoppeliaSim 官方手册：Legacy remote API（已弃用说明）](https://manual.coppeliarobotics.com/en/legacyRemoteApiOverview.htm)
* [coppeliasim-projects-with-zmqRemoteApi：ZMQ API 机器人控制示例集](https://github.com/yudarw/coppeliasim-projects-with-zmqRemoteApi)
* [Stable-Baselines3 官方仓库](https://github.com/DLR-RM/stable-baselines3)
* [SB3 + Gymnasium 入门教程（Antonin Raffin）](https://araffin.github.io/talk/sb3-gym-quickstart/)
* [果蔬采摘机器人深度学习综述（PMC）](https://pmc.ncbi.nlm.nih.gov/articles/PMC12197199/)
* [FMDS-YOLOv8 农业软体夹爪抓取系统（PMC）](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12568638/)
* [改进 YOLOv8 的小米辣检测与位姿估计（PMC）](https://pmc.ncbi.nlm.nih.gov/articles/PMC11188358/)
* [CoppeliaSim 双臂颜色分拣示例项目](https://github.com/MayooranT/Robot-arm-simulation-in-CoppeliaSim-EDU-Software)
* [基于视觉的抓取放置机械臂（ROS + CoppeliaSim）](https://github.com/munn33b/my-robotic-arm)

## 第 3 章 后续验证事项

* CoppeliaSim 版本锁定：建议 4.7+（ZMQ API 稳定），由嵌入式组安装验证后写入 README 版本兼容表。
* YOLOv8 果蔬数据集：优先评估公开数据集（Fruits-360、自建仿真渲染数据），确认外部存储分发方式。
* RL 训练算力：PPO 在 CPU 可训练小规模策略，GPU 需求随观测维度升级评估。
