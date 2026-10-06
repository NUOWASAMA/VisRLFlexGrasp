# 文件功能：单进程启动 HTTP 规划网关及其生命周期管理的内部 TCP 调度服务
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-10-06
# 启动方式（仓库根目录执行）：python -m backend.main.main
import uvicorn

from backend.app.api.application import create_app
from backend.config.settings import REPO_ROOT
from common.config_loader import load_config


def main():
    """按分级配置启动，禁止多 worker、reload 或未接入的硬件执行模式。"""
    config = load_config(str(REPO_ROOT / "backend/config"))
    uvicorn.run(create_app(config), host=config["api"]["host"], port=config["api"]["port"], workers=1,
                log_level=config.get("log_level", "INFO").lower())


if __name__ == "__main__":
    main()
