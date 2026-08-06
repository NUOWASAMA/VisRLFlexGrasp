# 文件功能：抓取策略推理，封装 RL 策略输出抓取参数；推理超时或模型未就绪时降级至几何默认策略（异常降级设计）
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-07-26

from typing import Any, Dict, List

from common.log_util import get_logger

logger = get_logger("algorithm.grasp_policy")

# 几何默认策略参数：垂直向下抓取姿态与保守夹持力（牛顿）
DEFAULT_ORIENTATION = [0.0, 0.0, 0.0, 1.0]
DEFAULT_FORCE_LIMIT = 4.0


class GraspPolicy:
    """抓取策略推理器。

    正常路径：加载 Stable-Baselines3 训练产出的 RL 策略，根据检测目标输出最优抓取位姿与力控参数；
    降级路径：RL 模型未就绪或推理超时（错误码 2001）时，使用几何默认策略保证任务不中断。
    """

    def __init__(self, policy_path: str, use_mock: bool):
        """入参：policy_path RL 策略权重路径；use_mock 是否强制使用几何默认策略"""
        self._policy = None
        self._use_default = use_mock
        if not use_mock:
            self._policy = self._try_load_policy(policy_path)
            if self._policy is None:
                logger.warning("RL 策略未就绪，使用几何默认抓取策略")
                self._use_default = True

    def refine_grasp(self, objects: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """对检测目标列表补全 / 优化抓取参数。

        入参：objects 检测结果列表（可能缺少 force_limit 或姿态未优化）。
        返回：补全 grasp_pose 与 force_limit 后的目标列表。
        """
        refined = []
        for obj in objects:
            if self._use_default:
                refined.append(self._apply_default_strategy(obj))
            else:
                # TODO(算法组)：构建观测向量 -> RL 策略推理 -> 输出抓取位姿修正量与夹持力
                refined.append(self._apply_default_strategy(obj))
        return refined

    @staticmethod
    def _apply_default_strategy(obj: Dict[str, Any]) -> Dict[str, Any]:
        """几何默认策略：保持检测位置，姿态垂直向下，夹持力取保守值"""
        result = dict(obj)
        grasp_pose = dict(result.get("grasp_pose", {}))
        grasp_pose.setdefault("orientation", list(DEFAULT_ORIENTATION))
        result["grasp_pose"] = grasp_pose
        result.setdefault("force_limit", DEFAULT_FORCE_LIMIT)
        return result

    @staticmethod
    def _try_load_policy(policy_path: str):
        """尝试加载 SB3 策略，依赖缺失或权重不存在时返回 None"""
        try:
            from stable_baselines3 import PPO  # 延迟导入：地基阶段允许未安装
        except ImportError:
            return None
        import os
        if not os.path.isfile(policy_path):
            return None
        return PPO.load(policy_path)
