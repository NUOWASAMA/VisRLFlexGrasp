# 文件功能：校验世界坐标系 TCP 规划请求与控制服务返回的规划结果
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-10-06
import math
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class GraspPose(BaseModel):
    """世界坐标系位置（米）与四元数 [qx, qy, qz, qw]。"""

    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    position: list[float] = Field(min_length=3, max_length=3)
    orientation: list[float] = Field(min_length=4, max_length=4)

    @field_validator("orientation")
    @classmethod
    def validate_orientation(cls, value):
        norm = math.hypot(*value)
        if not math.isfinite(norm) or norm < 1e-12:
            raise ValueError("四元数范数必须为正有限数")
        return [component / norm for component in value]


class PlanRequest(BaseModel):
    """提交规划，不包含机器人执行或硬件模式开关。"""

    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    grasp_pose: GraspPose
    current_joint_angles: Optional[list[float]] = Field(default=None, min_length=6, max_length=6)
    force_limit: float = Field(default=5.0, gt=0)


class PlanResult(BaseModel):
    """只接受已规划、未执行的终态；轨迹限位由 RobotService 进一步检查。"""

    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    task_id: str
    phase: Literal["planned"]
    is_success: Literal[True]
    executed: Literal[False]
    execution_mode: Literal["plan_only"]
    reference_source: Literal["request", "config"]
    joint_target: list[float] = Field(min_length=6, max_length=6)
    joint_trajectory: list[list[float]] = Field(min_length=2, max_length=4096)
    duration_sec: float = Field(gt=0)
    sample_period_sec: float = Field(gt=0)
    solution_count: int = Field(gt=0)
    force_limit: float = Field(gt=0)

    @field_validator("is_success", "executed", mode="before")
    @classmethod
    def validate_flags(cls, value):
        if type(value) is not bool:
            raise ValueError("规划状态必须使用 JSON 布尔值")
        return value

    @field_validator("joint_trajectory")
    @classmethod
    def validate_trajectory(cls, value):
        if any(len(point) != 6 for point in value):
            raise ValueError("每个轨迹点必须有六个关节角")
        return value
