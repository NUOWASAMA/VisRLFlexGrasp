# 文件功能：通过内部 TCP 调度连接调用现有 C++ 规划服务，关联响应并处理断线
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-10-06
import asyncio

from common import protocol


class MotionError(Exception):
    """携带协议错误码的运动服务失败。"""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class KinematicsAdapter:
    """只接受关联 task_id 的反馈；迟到报文不影响下一个任务。"""

    def __init__(self, server):
        self.server = server
        self._pending = {}

    def is_online(self):
        """返回内部运动服务是否在线，不表示控制柜已连接。"""
        return self.server.is_online(protocol.ModuleId.MOTION)

    async def plan(self, task_id, request):
        """下发一次规划请求并等待终态；取消时删除关联，绝不自动重试。"""
        future = asyncio.get_running_loop().create_future()
        self._pending[task_id] = future
        try:
            data = dict(request)
            data["task_id"] = task_id
            if not await self.server.send_to(protocol.ModuleId.MOTION, protocol.build_message(
                    protocol.MsgType.GRASP_COMMAND, protocol.ModuleId.BACKEND, protocol.ModuleId.MOTION, data)):
                raise MotionError(protocol.ErrorCode.TARGET_OFFLINE, "运动规划服务离线或发送失败")
            return await future
        finally:
            self._pending.pop(task_id, None)
            if not future.done():
                future.cancel()
            elif not future.cancelled():
                # 发送失败与断线同时发生时，仍取出 Future 异常，避免未消费异常。
                future.exception()

    def on_message(self, message):
        """消费运动反馈并唤醒关联任务，返回是否消费该报文。"""
        if message["source"] != protocol.ModuleId.MOTION:
            return False
        if message["msg_type"] not in (protocol.MsgType.MOTION_STATUS, protocol.MsgType.ERROR_REPORT):
            return False
        data = message["data"]
        future = self._pending.get(data.get("task_id")) if isinstance(data.get("task_id"), str) else None
        if message["code"] == protocol.ErrorCode.EMERGENCY_STOP:
            self.on_disconnect(protocol.ModuleId.MOTION)
        elif future is not None and not future.done():
            if message["code"] != 0 or message["msg_type"] == protocol.MsgType.ERROR_REPORT:
                future.set_exception(MotionError(message["code"] or protocol.ErrorCode.MOTION_EXEC_FAILED,
                                                 message["msg"]))
            else:
                future.set_result(data)
        return True

    def on_disconnect(self, module_id):
        """运动服务断开时立即失败所有待回复任务，不等待请求超时。"""
        if module_id == protocol.ModuleId.MOTION:
            for future in self._pending.values():
                if not future.done():
                    future.set_exception(MotionError(protocol.ErrorCode.TARGET_OFFLINE, "运动规划服务连接已断开"))
