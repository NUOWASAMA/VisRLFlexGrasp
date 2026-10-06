# 文件功能：分拣任务调度服务，实现「task_start -> capture_cmd -> detection_result -> grasp_command -> motion_status -> task_result」业务编排
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-07-26

import asyncio
from typing import Any, Dict, Optional

from common import protocol
from common.log_util import get_logger

logger = get_logger("backend.dispatch")


class TaskState:
    """单个分拣任务的运行时状态"""

    def __init__(self, task_id: str, category: str):
        self.task_id = task_id
        self.category = category  # 目标分拣品类，空串表示全品类
        self.sorted_count = 0
        self.is_finished = False


class DispatchService:
    """业务编排服务：消费发往 backend 的业务报文，驱动分拣状态机流转。

    通信细节（注册、心跳、转发）由 TcpDispatchServer 负责，本类只处理业务逻辑。
    """

    def __init__(self, robot_service=None):
        self._server = None  # 由 main 注入，避免相互构造的循环依赖
        self._tasks: Dict[str, TaskState] = {}
        self._robot_service = robot_service
        self._background = set()

    def _schedule(self, coroutine):
        """跟踪调度协程，消费异常并在服务退出时清理。"""
        task = asyncio.create_task(coroutine)
        self._background.add(task)

        def completed(future):
            self._background.discard(future)
            if not future.cancelled() and future.exception() is not None:
                logger.error("异步调度失败：%s", future.exception())

        task.add_done_callback(completed)

    async def close(self):
        """取消后台调度操作并等待退出。"""
        tasks = list(self._background)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    def on_disconnect(self, module_id):
        """算法连接中断时结束尚在等待感知的任务；已提交的规划由 RobotService 收尾。"""
        if self._robot_service is not None and module_id == protocol.ModuleId.ALGORITHM:
            for task in self._tasks.values():
                if not task.is_finished and not getattr(task, "awaiting_plan", False):
                    task.is_finished = True
                    task.phase = "failed"
                    task.error = {"code": protocol.ErrorCode.TARGET_OFFLINE, "msg": "算法模块断开"}
                    self._push_task_result(task)

    def bind_server(self, server) -> None:
        """注入 TCP 服务端实例，用于主动下发指令"""
        self._server = server

    def on_message(self, message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """业务报文入口（TcpDispatchServer 回调）。

        入参：message 目标为 backend 的业务报文。
        返回：需要同步回发给发送方的报文，无需回发时返回 None。
        """
        msg_type = message["msg_type"]
        handler_map = {
            protocol.MsgType.TASK_START: self._on_task_start,
            protocol.MsgType.DETECTION_RESULT: self._on_detection_result,
            protocol.MsgType.MOTION_STATUS: self._on_motion_status,
            protocol.MsgType.ERROR_REPORT: self._on_error_report,
        }
        handler = handler_map.get(msg_type)
        if handler is None:
            logger.warning("收到未支持的业务报文类型：%s", msg_type)
            return protocol.build_message(
                protocol.MsgType.ERROR_REPORT, protocol.ModuleId.BACKEND, message["source"],
                code=protocol.ErrorCode.INVALID_PARAM, msg="未支持的报文类型 %s" % msg_type)
        return handler(message)

    def _on_task_start(self, message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """前端下发任务：登记任务状态并向算法层下发采集指令"""
        data = message["data"]
        task_id = data.get("task_id", "")
        if not isinstance(task_id, str) or not task_id or len(task_id) > 256:
            return protocol.build_message(
                protocol.MsgType.ERROR_REPORT, protocol.ModuleId.BACKEND, message["source"],
                code=protocol.ErrorCode.INVALID_PARAM, msg="task_id 不允许为空")
        if self._robot_service is not None and (
                self._robot_service.status()["busy"] or any(not task.is_finished for task in self._tasks.values())):
            return protocol.build_message(protocol.MsgType.ERROR_REPORT, protocol.ModuleId.BACKEND, message["source"],
                                          code=protocol.ErrorCode.ROBOT_BUSY, msg="已有任务正在运行")
        if self._robot_service is not None and not self._server.is_online(protocol.ModuleId.ALGORITHM):
            return protocol.build_message(protocol.MsgType.ERROR_REPORT, protocol.ModuleId.BACKEND, message["source"],
                                          code=protocol.ErrorCode.TARGET_OFFLINE, msg="算法模块离线")
        self._tasks[task_id] = TaskState(task_id, data.get("category", ""))
        logger.info("任务启动：%s（品类：%s）", task_id, data.get("category", "全品类"))
        self._send_async(protocol.ModuleId.ALGORITHM, protocol.build_message(
            protocol.MsgType.CAPTURE_CMD, protocol.ModuleId.BACKEND,
            protocol.ModuleId.ALGORITHM, {"task_id": task_id}))
        return None

    def _on_detection_result(self, message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """算法层上报检测结果：取首个目标下发抓取指令；无目标则判定任务完成"""
        data = message["data"]
        task_id = data.get("task_id", "")
        task = self._tasks.get(task_id)
        if task is None or task.is_finished:
            logger.warning("收到未知任务的检测结果：%s", task_id)
            return None
        if self._robot_service is not None and getattr(task, "awaiting_plan", False):
            return None
        objects = data.get("objects", [])
        if not objects:
            # 场景内已无可抓取目标，任务收尾
            task.is_finished = True
            logger.info("任务 %s 完成，共分拣 %d 个目标", task_id, task.sorted_count)
            self._push_task_result(task)
            return None
        target_object = objects[0]
        if self._robot_service is not None:
            task.awaiting_plan = True
            self._schedule(self._plan_target(task, target_object))
            return None
        self._send_async(protocol.ModuleId.MOTION, protocol.build_message(
            protocol.MsgType.GRASP_COMMAND, protocol.ModuleId.BACKEND, protocol.ModuleId.MOTION,
            {
                "task_id": task_id,
                "label": target_object.get("label", ""),
                "grasp_pose": target_object.get("grasp_pose", {}),
                "force_limit": target_object.get("force_limit", 0.0),
            }))
        return None

    async def _plan_target(self, task, target_object):
        """算法检测目标复用唯一 RobotService；第一阶段规划完成即结束本次任务。"""
        from backend.app.schema.robot_request import PlanRequest
        from backend.app.service.robot_service import GatewayError

        def finished(record):
            task.is_finished = True
            task.phase = record["status"]
            task.error = record["error"]
            task.planning_task_id = record["task_id"]
            self._push_task_result(task)

        try:
            request = PlanRequest.model_validate({"grasp_pose": target_object.get("grasp_pose", {}),
                                                  "force_limit": target_object.get("force_limit", 5.0)})
            task.planning_task_id = await self._robot_service.submit(request, on_finished=finished)
        except Exception as error:
            logger.warning("算法目标规划提交失败：%s，%s", task.task_id, error)
            task.is_finished = True
            task.phase = "failed"
            task.error = {"code": error.code if isinstance(error, GatewayError) else 1000, "msg": str(error)}
            self._push_task_result(task)

    def _on_motion_status(self, message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """控制层回传执行状态：放置完成后计数并进入下一轮感知"""
        data = message["data"]
        if self._robot_service is not None:
            # 生产网关的反馈由 KinematicsAdapter 消费；拒绝未关联的 placed 状态推进分拣。
            logger.warning("忽略未关联的运动执行状态")
            return None
        task_id = data.get("task_id", "")
        task = self._tasks.get(task_id)
        if task is None:
            return None
        phase = data.get("phase", "")
        if phase == "placed":
            if data.get("is_success", False):
                task.sorted_count += 1
            self._push_task_result(task)
            # 继续下一轮「感知 - 决策 - 执行」循环
            self._send_async(protocol.ModuleId.ALGORITHM, protocol.build_message(
                protocol.MsgType.CAPTURE_CMD, protocol.ModuleId.BACKEND,
                protocol.ModuleId.ALGORITHM, {"task_id": task_id}))
        return None

    def _on_error_report(self, message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """模块异常上报：记录日志，紧急停止类错误标记所有任务终止"""
        code = message["code"]
        logger.error("模块 %s 上报异常，错误码 %d：%s", message["source"], code, message["msg"])
        if code == protocol.ErrorCode.EMERGENCY_STOP:
            for task in self._tasks.values():
                task.is_finished = True
        return None

    def _push_task_result(self, task: TaskState) -> None:
        """向前端推送任务进度"""
        self._send_async(protocol.ModuleId.FRONTEND, protocol.build_message(
            protocol.MsgType.TASK_RESULT, protocol.ModuleId.BACKEND, protocol.ModuleId.FRONTEND,
            {
                "task_id": task.task_id,
                "sorted_count": task.sorted_count,
                "is_finished": task.is_finished,
                "phase": getattr(task, "phase", "sorting"),
                "executed": False if self._robot_service is not None else None,
                "planning_task_id": getattr(task, "planning_task_id", None),
                "error": getattr(task, "error", None),
            }))

    def _send_async(self, module_id: str, message: Dict[str, Any]) -> None:
        """异步下发报文（回调上下文内不可 await，转为事件循环任务）"""
        if self._server is None:
            logger.error("TCP 服务端未绑定，无法下发报文")
            return
        self._schedule(self._server.send_to(module_id, message))
