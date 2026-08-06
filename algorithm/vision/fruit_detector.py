# 文件功能：果蔬目标检测器，封装 YOLOv8 推理接口；模型未就绪时提供模拟检测器保障全链路可联调
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-07-26

from typing import Any, Dict, List

from common.log_util import get_logger

logger = get_logger("algorithm.detector")

# 模拟检测器默认目标数量：模拟场景中待分拣果蔬逐个减少直至清空
MOCK_OBJECT_TOTAL = 3
# 模拟目标的默认置信度与夹持力（牛顿）
MOCK_CONFIDENCE = 0.95
MOCK_FORCE_LIMIT = 5.0


class FruitDetector:
    """YOLOv8 果蔬检测器封装。

    真实推理依赖 ultralytics 与模型权重（algorithm/assets/，>10MB 外部分发）；
    依赖未就绪时自动降级为 MockDetector 行为，保障通信链路与调度逻辑可先行联调。
    """

    def __init__(self, model_path: str, use_mock: bool):
        """入参：model_path 模型权重路径；use_mock 是否强制使用模拟检测"""
        self._model = None
        self._mock_remaining = MOCK_OBJECT_TOTAL
        self._use_mock = use_mock
        if not use_mock:
            self._model = self._try_load_model(model_path)
            if self._model is None:
                logger.warning("YOLOv8 模型未就绪，自动降级为模拟检测器")
                self._use_mock = True

    def detect(self, task_id: str) -> List[Dict[str, Any]]:
        """执行一次场景检测。

        入参：task_id 当前任务标识（预留，用于日志与数据落盘关联）。
        返回：objects 列表，结构见 docs/api/tcp_communication_spec.md 3.3 节；场景无目标时返回空列表。
        """
        if self._use_mock:
            return self._mock_detect()
        # TODO(算法组)：接入深度相机图像获取 -> YOLOv8 推理 -> 位姿解算，输出 World Frame 坐标
        raise NotImplementedError("真实检测流程待接入深度相机与位姿解算后实现")

    def _mock_detect(self) -> List[Dict[str, Any]]:
        """模拟检测：每次返回一个目标，目标总数递减至零后返回空列表（模拟场景被逐渐清空）"""
        if self._mock_remaining <= 0:
            logger.info("模拟场景已清空，无剩余目标")
            self._mock_remaining = MOCK_OBJECT_TOTAL  # 重置，供下一个任务使用
            return []
        self._mock_remaining -= 1
        # 模拟目标位置随剩余数量偏移，便于联调时区分
        offset = 0.05 * self._mock_remaining
        return [{
            "label": "apple",
            "confidence": MOCK_CONFIDENCE,
            "grasp_pose": {
                "position": [0.35 + offset, -0.12, 0.08],
                "orientation": [0.0, 0.0, 0.0, 1.0],
            },
            "force_limit": MOCK_FORCE_LIMIT,
        }]

    @staticmethod
    def _try_load_model(model_path: str):
        """尝试加载 YOLOv8 模型，依赖缺失或权重不存在时返回 None"""
        try:
            from ultralytics import YOLO  # 延迟导入：地基阶段允许未安装
        except ImportError:
            return None
        import os
        if not os.path.isfile(model_path):
            return None
        return YOLO(model_path)
