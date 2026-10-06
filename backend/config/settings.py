# 文件功能：校验网关配置并复用嵌入式模型的关节限位和初始规划参考角
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-10-06
import json
import math
from dataclasses import dataclass
from pathlib import Path

from common.config_loader import load_config

REPO_ROOT = Path(__file__).resolve().parents[2]


@dataclass
class GatewaySettings:
    database_path: Path
    log_path: Path
    plan_timeout: float
    maximum_force: float
    initial_joints: list
    joint_min: list
    joint_max: list

    @classmethod
    def from_config(cls, config, root=REPO_ROOT):
        """从相对仓库路径读取配置；未实现的执行模式或非法参数拒绝启动。"""
        gateway = config["gateway"]
        if config.get("enable_hardware") is not False or gateway["execution_mode"] != "plan_only":
            raise ValueError("第一阶段仅支持 plan_only，控制柜执行驱动未接入")
        timeout = gateway["plan_timeout_sec"]
        if isinstance(timeout, bool) or not isinstance(timeout, (float, int)) or not 0 < timeout <= 600:
            raise ValueError("规划超时需为 0 到 600 秒之间的正有限数")
        motion_path = root / gateway["motion_config_file"]
        motion = load_config(str(motion_path.parent), config.get("env", "sim"))
        if motion.get("enable_hardware") is not False or motion.get("execution_mode") != "plan_only":
            raise ValueError("嵌入式配置需为 plan_only")
        model_path = motion_path.parent / motion["model_file"]
        model = json.loads(model_path.read_text(encoding="utf-8"))
        vectors = [motion["initial_joint_angles"], model["joint_min"], model["joint_max"]]
        for vector in vectors:
            if not isinstance(vector, list) or len(vector) != 6 or any(
                    isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
                    for value in vector):
                raise ValueError("模型限位及初始角需为六个有限数")
        initial, minimum, maximum = vectors
        if any(low >= high or not low <= angle <= high for angle, low, high in zip(initial, minimum, maximum)):
            raise ValueError("模型限位或初始规划角非法")
        force = motion["max_force_limit"]
        if isinstance(force, bool) or not isinstance(force, (int, float)) or not math.isfinite(force) or force <= 0:
            raise ValueError("夹持力上限需为正有限数")
        for name in ("server", "api"):
            value = config[name]
            if not isinstance(value["host"], str) or not value["host"]:
                raise ValueError("监听地址不得为空")
            if type(value["port"]) is not int or not 0 <= value["port"] <= 65535:
                raise ValueError("监听端口需为 0 到 65535 的整数")
        database = config["database"]["path"]
        if not isinstance(database, str) or not database:
            raise ValueError("数据库文件路径不得为空")
        log_file = config["log_file"]
        if not isinstance(log_file, str) or not log_file:
            raise ValueError("日志文件路径不得为空")
        return cls(root / database, root / log_file, float(timeout), float(force), initial, minimum, maximum)
