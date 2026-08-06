# 文件功能：TCP 通信协议公共定义（报文构建、解析、校验、错误码），与 docs/api/tcp_communication_spec.md 保持一致
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-07-26

import json
import time
from typing import Any, Dict, Optional


class ModuleId:
    """模块标识常量，对应协议规范 3.1 节"""

    BACKEND = "backend"
    ALGORITHM = "algorithm"
    MOTION = "motion"
    FRONTEND = "frontend"

    ALL = (BACKEND, ALGORITHM, MOTION, FRONTEND)


class MsgType:
    """报文类型常量，对应协议规范 3.2 节"""

    REGISTER = "register"
    REGISTER_ACK = "register_ack"
    HEARTBEAT = "heartbeat"
    HEARTBEAT_ACK = "heartbeat_ack"
    TASK_START = "task_start"
    CAPTURE_CMD = "capture_cmd"
    DETECTION_RESULT = "detection_result"
    GRASP_COMMAND = "grasp_command"
    MOTION_STATUS = "motion_status"
    TASK_RESULT = "task_result"
    ERROR_REPORT = "error_report"


class ErrorCode:
    """全局错误码字典，对应协议规范第 4 章"""

    SUCCESS = 0
    # 通用错误 1000-1999
    INVALID_PARAM = 1000
    INVALID_MESSAGE = 1001
    REQUEST_TIMEOUT = 1002
    NOT_REGISTERED = 1003
    # 算法模块错误 2000-2999
    MODEL_LOAD_FAILED = 2000
    INFERENCE_TIMEOUT = 2001
    DETECTION_EMPTY = 2002
    # 硬件 / 仿真模块错误 3000-3999
    SIM_CONNECT_FAILED = 3000
    MOTION_EXEC_FAILED = 3001
    EMERGENCY_STOP = 3002
    # 通信模块错误 4000-4999
    TARGET_OFFLINE = 4000
    HEARTBEAT_TIMEOUT = 4001


# 报文必填字段清单，缺失任意字段判定为非法报文
REQUIRED_FIELDS = ("msg_type", "source", "target", "code", "msg", "data", "timestamp")

# 通信机制常量（协议规范第 1 章），全模块统一引用，禁止各自定义
REQUEST_TIMEOUT_SEC = 3.0
MAX_RETRY_COUNT = 3
RETRY_INTERVAL_SEC = 1.0
RECONNECT_INTERVALS_SEC = (1.0, 3.0, 5.0)
HEARTBEAT_INTERVAL_SEC = 3.0
HEARTBEAT_OFFLINE_SEC = 10.0


def build_message(
    msg_type: str,
    source: str,
    target: str,
    data: Optional[Dict[str, Any]] = None,
    code: int = ErrorCode.SUCCESS,
    msg: str = "success",
) -> Dict[str, Any]:
    """构建标准报文字典。

    入参：msg_type 报文类型；source 发送方；target 接收方；data 业务数据体；code 错误码；msg 状态说明。
    返回：符合协议规范第 2 章结构的报文字典。
    异常：msg_type / source / target 为空时抛出 ValueError。
    """
    if not msg_type or not source or not target:
        raise ValueError("msg_type / source / target 不允许为空")
    return {
        "msg_type": msg_type,
        "source": source,
        "target": target,
        "code": code,
        "msg": msg,
        "data": data if data is not None else {},
        "timestamp": int(time.time() * 1000),
    }


def encode_message(message: Dict[str, Any]) -> bytes:
    """将报文字典编码为一行 NDJSON 字节流（含结尾换行符）。

    入参：message 报文字典。
    返回：UTF-8 编码的字节流。
    """
    return (json.dumps(message, ensure_ascii=False) + "\n").encode("utf-8")


def decode_message(line: bytes) -> Optional[Dict[str, Any]]:
    """将一行字节流解析并校验为报文字典。

    入参：line 单行报文字节流（可含结尾换行符）。
    返回：合法报文返回字典；JSON 解析失败或缺少必填字段返回 None（由调用方按 INVALID_MESSAGE 处理）。
    """
    try:
        message = json.loads(line.decode("utf-8").strip())
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(message, dict):
        return None
    for field in REQUIRED_FIELDS:
        if field not in message:
            return None
    return message
