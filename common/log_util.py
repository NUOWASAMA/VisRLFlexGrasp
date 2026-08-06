# 文件功能：全局日志工具，统一四级日志（DEBUG/INFO/WARN/ERROR）输出格式与级别控制（STYLEGUIDE 3.7）
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-07-26

import logging
import sys

# 统一日志格式：时间 | 级别 | 模块名 | 内容
LOG_FORMAT = "%(asctime)s | %(levelname)-5s | %(name)s | %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

_LEVEL_MAP = {
    "DEBUG": logging.DEBUG,
    "INFO": logging.INFO,
    "WARN": logging.WARNING,
    "ERROR": logging.ERROR,
}


def get_logger(name: str, level: str = "INFO") -> logging.Logger:
    """获取统一格式的模块日志器。

    入参：name 模块名（建议使用模块标识，如 backend / algorithm）；level 日志级别字符串。
    返回：配置完成的 Logger 实例，重复调用不会叠加 handler。
    """
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter(LOG_FORMAT, DATE_FORMAT))
        logger.addHandler(handler)
    logger.setLevel(_LEVEL_MAP.get(level.upper(), logging.INFO))
    logger.propagate = False
    return logger
