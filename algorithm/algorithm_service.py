# 文件功能：算法服务启动入口，接入调度服务，消费 capture_cmd 指令并回报检测与抓取决策结果
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-07-26
# 启动方式（仓库根目录执行）：python -m algorithm.algorithm_service

import asyncio
import os
from typing import Any, Dict, Optional

from algorithm.common.tcp_client import ModuleTcpClient
from algorithm.inference.grasp_policy import GraspPolicy
from algorithm.vision.fruit_detector import FruitDetector
from common import protocol
from common.config_loader import load_config
from common.log_util import get_logger

CONFIG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config")


class AlgorithmService:
    """算法服务：串联「视觉检测 -> 抓取策略」流水线，与调度服务交互"""

    def __init__(self, config: Dict[str, Any]):
        self._logger = get_logger("algorithm.service", config.get("log_level", "INFO"))
        use_mock = bool(config.get("use_mock", True))
        self._detector = FruitDetector(config.get("detector_model_path", ""), use_mock)
        self._policy = GraspPolicy(config.get("rl_policy_path", ""), use_mock)
        self._client = ModuleTcpClient(
            protocol.ModuleId.ALGORITHM,
            config["server"]["host"],
            config["server"]["port"],
            self.on_message,
        )

    def on_message(self, message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """业务报文回调：处理采集指令，返回检测结果报文"""
        if message["msg_type"] != protocol.MsgType.CAPTURE_CMD:
            self._logger.warning("收到未支持的报文类型：%s", message["msg_type"])
            return None
        task_id = message["data"].get("task_id", "")
        self._logger.info("收到采集指令，任务：%s", task_id)
        objects = self._detector.detect(task_id)
        if objects:
            objects = self._policy.refine_grasp(objects)
            code, msg = protocol.ErrorCode.SUCCESS, "success"
        else:
            code, msg = protocol.ErrorCode.DETECTION_EMPTY, "场景内无可抓取目标"
        return protocol.build_message(
            protocol.MsgType.DETECTION_RESULT, protocol.ModuleId.ALGORITHM, protocol.ModuleId.BACKEND,
            {"task_id": task_id, "objects": objects}, code=code, msg=msg)

    async def run(self) -> None:
        """启动客户端主循环"""
        await self._client.run_forever()


def main() -> None:
    """加载配置并启动算法服务"""
    config = load_config(CONFIG_DIR)
    logger = get_logger("algorithm.main", config.get("log_level", "INFO"))
    logger.info("算法服务启动，环境：%s，模拟模式：%s", config["env"], config.get("use_mock", True))
    service = AlgorithmService(config)
    try:
        asyncio.run(service.run())
    except KeyboardInterrupt:
        logger.info("收到退出信号，算法服务停止")


if __name__ == "__main__":
    main()
