# 文件功能：柔性抓取强化学习环境骨架（Gymnasium 接口），后续接入 CoppeliaSim ZMQ Remote API 完成仿真闭环
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-07-26

from typing import Any, Dict, Tuple

from common.log_util import get_logger

logger = get_logger("algorithm.grasp_env")

# 观测维度：目标位置(3) + 目标尺寸(3) + 夹爪状态(2)，随感知能力扩展时同步更新本常量与文档
OBS_DIM = 8
# 动作维度：抓取点偏移(3) + 姿态修正(3) + 夹持力(1)
ACTION_DIM = 7
# 单回合最大步数
MAX_EPISODE_STEPS = 50


class FlexGraspEnv:
    """柔性抓取 RL 环境骨架。

    设计说明：
    * 遵循 Gymnasium 标准接口（reset / step），便于直接接入 Stable-Baselines3 训练；
    * 仿真后端通过 CoppeliaSim ZMQ Remote API（coppeliasim-zmqremoteapi-client）驱动，
      由适配层封装，本类不直接依赖仿真 SDK（STYLEGUIDE 3.4 分层调用边界）；
    * 奖励设计（待算法组细化）：抓取成功 + 无损（接触力低于阈值）为正奖励，
      掉落 / 挤压超限 / 超时为负奖励。
    """

    def __init__(self, sim_adapter=None):
        """入参：sim_adapter 仿真适配器实例，None 表示尚未接入仿真"""
        self._sim = sim_adapter
        self._step_count = 0
        try:
            import gymnasium as gym
            from gymnasium import spaces
            self.observation_space = spaces.Box(low=-1.0, high=1.0, shape=(OBS_DIM,), dtype=float)
            self.action_space = spaces.Box(low=-1.0, high=1.0, shape=(ACTION_DIM,), dtype=float)
        except ImportError:
            # 地基阶段允许 gymnasium 未安装，训练前必须补齐依赖
            self.observation_space = None
            self.action_space = None
            logger.warning("gymnasium 未安装，环境仅可用于接口评审，无法训练")

    def reset(self, seed=None, options=None) -> Tuple[Any, Dict[str, Any]]:
        """重置仿真场景并返回初始观测。

        返回：(observation, info) 二元组。
        异常：仿真适配器未接入时抛出 RuntimeError。
        """
        self._require_sim()
        self._step_count = 0
        # TODO(算法组)：调用适配层重置场景、随机摆放果蔬、读取初始观测
        raise NotImplementedError("待接入 CoppeliaSim 适配层后实现")

    def step(self, action) -> Tuple[Any, float, bool, bool, Dict[str, Any]]:
        """执行一步抓取动作。

        入参：action 归一化动作向量（ACTION_DIM 维）。
        返回：(observation, reward, terminated, truncated, info) 五元组。
        异常：仿真适配器未接入时抛出 RuntimeError。
        """
        self._require_sim()
        self._step_count += 1
        # TODO(算法组)：下发动作 -> 仿真步进 -> 读取接触力与目标状态 -> 计算奖励
        raise NotImplementedError("待接入 CoppeliaSim 适配层后实现")

    def _require_sim(self) -> None:
        """校验仿真适配器已注入"""
        if self._sim is None:
            raise RuntimeError("仿真适配器未接入，无法运行环境")
