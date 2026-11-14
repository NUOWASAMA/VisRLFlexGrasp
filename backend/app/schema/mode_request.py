# 文件功能：校验运行环境模式切换请求，只接受 sim / real 且拒绝额外字段
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-11-14
from typing import Literal

from pydantic import BaseModel, ConfigDict


class ModeSwitchRequest(BaseModel):
    """切换运行环境模式；真实环境的硬件降级语义由 ModeService 统一标注。"""

    model_config = ConfigDict(extra="forbid", strict=True)
    mode: Literal["sim", "real"]
