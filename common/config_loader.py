# 文件功能：多环境分级配置加载器，按 base -> 环境（dev/sim/real）两级合并模块 config/ 目录下的 JSON 配置
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-07-26

import json
import os
from typing import Any, Dict

# 环境变量名，取值 dev / sim / real，未设置时默认 sim（仿真优先原则，STYLEGUIDE 6.4）
ENV_VAR_NAME = "VISRL_ENV"
DEFAULT_ENV = "sim"
VALID_ENVS = ("dev", "sim", "real")
BASE_CONFIG_NAME = "base.json"


def get_current_env() -> str:
    """读取当前运行环境标识。

    返回：dev / sim / real 之一。
    异常：环境变量取值非法时抛出 ValueError。
    """
    env = os.environ.get(ENV_VAR_NAME, DEFAULT_ENV)
    if env not in VALID_ENVS:
        raise ValueError("非法环境标识 %s，允许取值：%s" % (env, "/".join(VALID_ENVS)))
    return env


def _deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    """递归合并两个配置字典，override 优先，嵌套字典逐键覆盖"""
    merged = dict(base)
    for key, value in override.items():
        if key in merged and isinstance(merged[key], dict) and isinstance(value, dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def load_config(config_dir: str, env: str = "") -> Dict[str, Any]:
    """加载指定模块的分级配置。

    入参：config_dir 模块 config 目录路径；env 环境标识，空串表示从环境变量读取。
    返回：base 配置与环境配置深度合并后的字典。
    异常：base.json 不存在时抛出 FileNotFoundError；环境标识非法时抛出 ValueError。
    """
    if not env:
        env = get_current_env()
    if env not in VALID_ENVS:
        raise ValueError("非法环境标识 %s" % env)

    base_path = os.path.join(config_dir, BASE_CONFIG_NAME)
    if not os.path.isfile(base_path):
        raise FileNotFoundError("基础配置文件不存在：%s" % base_path)
    with open(base_path, "r", encoding="utf-8") as f:
        config = json.load(f)

    env_path = os.path.join(config_dir, "%s.json" % env)
    if os.path.isfile(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            config = _deep_merge(config, json.load(f))

    config["env"] = env
    return config
