# 文件功能：唯一规划入口，单任务互斥、输入/结果限位校验、超时与 SQLite 终态管理
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-10-06
import asyncio
import math
import uuid

from backend.app.schema.robot_request import PlanResult
from backend.comm.kinematics_adapter import MotionError
from common import protocol
from common.log_util import get_logger

logger = get_logger("backend.robot")


class GatewayError(Exception):
    """对外 HTTP 状态及统一业务错误码。"""

    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code


class RobotService:
    """HTTP 与算法入口共享一个服务实例，只有本类能提交规划。"""

    def __init__(self, adapter, repository, settings):
        self.adapter = adapter
        self.repository = repository
        self.settings = settings
        self._submission_lock = asyncio.Lock()
        self._active_id = None
        self._worker = None
        self._closing = False

    def status(self):
        """返回网关状态；初始角是规划参考值，不伪装成控制柜反馈。"""
        return {"motion_online": self.adapter.is_online(), "controller_connected": False,
                "execution_mode": "plan_only", "busy": self._active_id is not None,
                "active_task_id": self._active_id, "current_joint_angles": None,
                "feedback_source": "unavailable", "planning_reference": self.settings.initial_joints}

    def _validate_limits(self, angles):
        if any(not math.isfinite(value) or value < minimum - 1e-9 or value > maximum + 1e-9
               for value, minimum, maximum in zip(angles, self.settings.joint_min, self.settings.joint_max)):
            raise ValueError("关节角超过模型限位")

    async def submit(self, request, on_finished=None):
        """登记请求并启动后台规划，返回任务 ID；忙碌/离线/参数非法时拒绝。"""
        try:
            if request.force_limit > self.settings.maximum_force:
                raise ValueError("夹持力超过配置上限")
            if request.current_joint_angles is not None:
                self._validate_limits(request.current_joint_angles)
        except ValueError as error:
            raise GatewayError(422, protocol.ErrorCode.INVALID_PARAM, str(error)) from error
        async with self._submission_lock:
            if self._closing:
                raise GatewayError(503, protocol.ErrorCode.TARGET_OFFLINE, "网关正在关闭")
            if self._active_id is not None:
                raise GatewayError(409, protocol.ErrorCode.ROBOT_BUSY, "已有规划任务正在运行")
            if not self.adapter.is_online():
                raise GatewayError(503, protocol.ErrorCode.TARGET_OFFLINE, "运动规划服务未连接")
            task_id = uuid.uuid4().hex
            self._active_id = task_id
            payload = request.model_dump(exclude_none=True)
            try:
                # shield 使 HTTP 客户端取消请求时不会留下只有数据库记录、没有 worker 的任务。
                operation = asyncio.create_task(asyncio.to_thread(self.repository.create, task_id, payload))
                try:
                    await asyncio.shield(operation)
                except asyncio.CancelledError:
                    await operation
                    await asyncio.to_thread(self.repository.finish, task_id, "interrupted",
                                            error={"code": 3001, "msg": "提交请求已取消，未下发规划"})
                    raise
            except BaseException:
                self._active_id = None
                raise
            self._worker = asyncio.create_task(self._run(task_id, payload, on_finished))
            logger.info("规划任务登记：%s", task_id)
            return task_id

    def _validate_result(self, data, payload):
        result = PlanResult.model_validate(data)
        expected_source = "request" if "current_joint_angles" in payload else "config"
        if result.reference_source != expected_source:
            raise ValueError("规划参考角来源不一致")
        reference = payload.get("current_joint_angles", self.settings.initial_joints)
        for point in [result.joint_target] + result.joint_trajectory:
            self._validate_limits(point)
        if any(abs(first - expected) > 1e-7 for first, expected in zip(result.joint_trajectory[0], reference)):
            raise ValueError("轨迹起点与请求参考角不一致")
        if any(abs(last - target) > 1e-7
               for last, target in zip(result.joint_trajectory[-1], result.joint_target)):
            raise ValueError("轨迹终点与关节目标不一致")
        expected_period = result.duration_sec / (len(result.joint_trajectory) - 1)
        if not math.isclose(expected_period, result.sample_period_sec, rel_tol=1e-7, abs_tol=1e-9):
            raise ValueError("轨迹采样周期不一致")
        if result.force_limit != payload["force_limit"]:
            raise ValueError("规划返回的夹持力与请求不一致")
        return result.model_dump()

    async def _run(self, task_id, payload, on_finished):
        state, result, error = "planned", None, None
        try:
            data = await asyncio.wait_for(self.adapter.plan(task_id, payload), self.settings.plan_timeout)
            result = self._validate_result(data, payload)
        except asyncio.CancelledError:
            state, error = "interrupted", {"code": 3001, "msg": "网关关闭，规划中断；未重新下发"}
        except asyncio.TimeoutError:
            state, error = "failed", {"code": protocol.ErrorCode.REQUEST_TIMEOUT, "msg": "等待规划结果超时"}
        except MotionError as failure:
            state, error = "failed", {"code": failure.code, "msg": str(failure)}
        except Exception:
            logger.exception("规划结果非法或适配器异常：%s", task_id)
            state, error = "failed", {"code": 3001, "msg": "规划结果校验失败或内部异常"}
        try:
            await asyncio.to_thread(self.repository.finish, task_id, state, result, error)
            logger.info("规划任务结束：%s，状态 %s", task_id, state)
            if on_finished is not None:
                record = await asyncio.to_thread(self.repository.get, task_id)
                on_finished(record)
        except Exception:
            logger.exception("保存规划终态或通知调用方失败：%s", task_id)
        finally:
            self._active_id = None

    async def get_task(self, task_id):
        """异步查询持久化任务，不存在时返回明确的 404。"""
        record = await asyncio.to_thread(self.repository.get, task_id)
        if record is None:
            raise GatewayError(404, protocol.ErrorCode.TASK_NOT_FOUND, "任务不存在")
        return record

    async def close(self):
        """停止接受新任务，等待正在运行任务保存中断终态。"""
        self._closing = True
        async with self._submission_lock:
            if self._worker is not None and not self._worker.done():
                self._worker.cancel()
                await asyncio.gather(self._worker, return_exceptions=True)
            if self._active_id is not None:
                # worker 尚未获得首次调度便被取消时，协程内部的 finally 不会执行。
                await asyncio.to_thread(self.repository.finish, self._active_id, "interrupted",
                                        error={"code": 3001, "msg": "网关关闭，任务中断；未重新下发"})
                self._active_id = None
