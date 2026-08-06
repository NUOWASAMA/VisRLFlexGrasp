# 文件功能：后端调度服务启动入口，加载分级配置并启动 TCP 调度服务
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-07-26
# 启动方式（仓库根目录执行）：python -m backend.main.main

import asyncio
import os

from backend.app.service.dispatch_service import DispatchService
from backend.comm.tcp_server import TcpDispatchServer
from common.config_loader import load_config
from common.log_util import get_logger

# 后端模块 config 目录（相对本文件定位，避免依赖运行目录）
CONFIG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config")


def main() -> None:
    """加载配置、组装调度服务与 TCP 服务端并启动事件循环"""
    config = load_config(CONFIG_DIR)
    logger = get_logger("backend.main", config.get("log_level", "INFO"))
    logger.info("当前运行环境：%s，硬件模式：%s", config["env"], config.get("enable_hardware", False))

    dispatch = DispatchService()
    server = TcpDispatchServer(
        host=config["server"]["host"],
        port=config["server"]["port"],
        on_business_message=dispatch.on_message,
    )
    dispatch.bind_server(server)
    try:
        asyncio.run(server.start())
    except KeyboardInterrupt:
        logger.info("收到退出信号，调度服务停止")


if __name__ == "__main__":
    main()
