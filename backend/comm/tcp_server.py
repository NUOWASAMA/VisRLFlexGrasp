# 文件功能：内部 TCP 调度服务，管理连接、身份、心跳和网关业务入口
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-07-26

import asyncio
import time
from typing import Any, Callable, Dict, Optional

from common import protocol
from common.log_util import get_logger

logger = get_logger("backend.tcp_server")

# 单行报文长度上限（字节），防止异常客户端撑爆内存
MAX_LINE_BYTES = 1024 * 1024
# 心跳巡检周期（秒）
HEARTBEAT_CHECK_INTERVAL_SEC = 2.0


class ClientSession:
    """单个客户端连接会话，记录模块身份与心跳时间"""

    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self.reader = reader
        self.writer = writer
        self.module_id = ""  # 注册前为空串
        self.reply_target = "unknown"
        self.last_heartbeat = time.monotonic()
        self.send_lock = asyncio.Lock()

    @property
    def peer_name(self) -> str:
        """返回客户端地址描述，用于日志输出"""
        peer = self.writer.get_extra_info("peername")
        return "%s:%s" % (peer[0], peer[1]) if peer else "unknown"


class TcpDispatchServer:
    """TCP 调度服务端。

    职责边界：注册、心跳、身份校验和内部下发；客户端业务统一交给后端网关。
    """

    def __init__(self, host: str, port: int,
                 on_business_message: Optional[Callable[[Dict[str, Any]], Optional[Dict[str, Any]]]] = None):
        """入参：host/port 监听地址；on_business_message 业务报文回调，
        入参为报文字典，返回需要回发的报文字典或 None。"""
        self._host = host
        self._port = port
        self._on_business_message = on_business_message
        self._sessions: Dict[str, ClientSession] = {}  # module_id -> 会话
        self._server: Optional[asyncio.AbstractServer] = None
        self._on_disconnect = None
        self._patrol_task = None
        self._client_tasks = set()

    def set_handlers(self, on_business_message, on_disconnect=None):
        """启动前注入业务处理和模块断线回调。"""
        self._on_business_message = on_business_message
        self._on_disconnect = on_disconnect

    async def open(self):
        """开始监听并返回，供 HTTP 应用生命周期管理。"""
        self._server = await asyncio.start_server(
            self._handle_client, self._host, self._port, limit=MAX_LINE_BYTES)
        self._patrol_task = asyncio.create_task(self._heartbeat_patrol())
        logger.info("TCP 调度服务已启动，监听 %s", self._server.sockets[0].getsockname())

    async def close(self):
        """停止巡检、监听和客户端任务，等待套接字关闭。"""
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None
        if self._patrol_task is not None:
            self._patrol_task.cancel()
            await asyncio.gather(self._patrol_task, return_exceptions=True)
            self._patrol_task = None
        for task in list(self._client_tasks):
            task.cancel()
        await asyncio.gather(*self._client_tasks, return_exceptions=True)

    async def start(self) -> None:
        """启动监听与心跳巡检任务，本方法会阻塞直至服务关闭"""
        await self.open()
        try:
            await self._server.serve_forever()
        finally:
            await self.close()

    def is_online(self, module_id: str) -> bool:
        """判断指定模块是否在线"""
        session = self._sessions.get(module_id)
        return session is not None and not session.writer.is_closing()

    async def send_to(self, module_id: str, message: Dict[str, Any]) -> bool:
        """向指定模块发送报文。

        入参：module_id 目标模块标识；message 报文字典。
        返回：目标在线且发送成功返回 True，目标离线返回 False。
        """
        session = self._sessions.get(module_id)
        if session is None or session.writer.is_closing():
            logger.warning("目标模块离线，发送失败：%s -> %s", message.get("msg_type"), module_id)
            return False
        try:
            async with session.send_lock:
                session.writer.write(protocol.encode_message(message))
                await asyncio.wait_for(session.writer.drain(), protocol.REQUEST_TIMEOUT_SEC)
            return True
        except (ConnectionError, OSError, asyncio.TimeoutError):
            logger.warning("发送失败，关闭模块连接：%s", module_id)
            session.writer.close()
            self._unregister(session)
            return False

    async def _handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        """单客户端收包循环：解析报文 -> 注册/心跳自处理 -> 其余按 target 路由"""
        session = ClientSession(reader, writer)
        task = asyncio.current_task()
        self._client_tasks.add(task)
        logger.info("客户端接入：%s", session.peer_name)
        try:
            while True:
                line = await reader.readline()
                if not line:
                    break
                message = protocol.decode_message(line)
                if message is None:
                    await self._reply_error(session, protocol.ErrorCode.INVALID_MESSAGE, "报文格式错误")
                    continue
                await self._route_message(session, message)
        except (ConnectionError, OSError, asyncio.IncompleteReadError, ValueError):
            logger.warning("客户端连接异常或帧过长：%s", session.peer_name)
        except Exception:
            logger.exception("处理客户端报文失败：%s", session.peer_name)
        finally:
            self._unregister(session)
            writer.close()
            try:
                await writer.wait_closed()
            except (ConnectionError, OSError):
                pass
            self._client_tasks.discard(task)

    async def _route_message(self, session: ClientSession, message: Dict[str, Any]) -> None:
        """按报文类型分发：注册与心跳由服务端消费，业务报文校验注册身份后路由"""
        msg_type = message["msg_type"]
        if not session.module_id:
            session.reply_target = message["source"]
        if msg_type == protocol.MsgType.REGISTER:
            await self._handle_register(session, message)
            return
        if not session.module_id:
            await self._reply_error(session, protocol.ErrorCode.NOT_REGISTERED, "请先完成注册")
            return
        if message["source"] != session.module_id:
            await self._reply_error(session, protocol.ErrorCode.INVALID_MESSAGE, "报文 source 与注册身份不一致")
            return
        if msg_type == protocol.MsgType.HEARTBEAT and message["target"] == protocol.ModuleId.BACKEND:
            session.last_heartbeat = time.monotonic()
            await self._reply(session, protocol.build_message(
                protocol.MsgType.HEARTBEAT_ACK, protocol.ModuleId.BACKEND, session.module_id))
            return

        allowed_sources = {
            protocol.MsgType.TASK_START: protocol.ModuleId.FRONTEND,
            protocol.MsgType.DETECTION_RESULT: protocol.ModuleId.ALGORITHM,
            protocol.MsgType.MOTION_STATUS: protocol.ModuleId.MOTION,
        }
        if msg_type != protocol.MsgType.ERROR_REPORT and allowed_sources.get(msg_type) != session.module_id:
            await self._reply_error(session, protocol.ErrorCode.INVALID_PARAM, "该模块无权发送此业务类型")
            return
        if message["target"] != protocol.ModuleId.BACKEND:
            await self._reply_error(session, protocol.ErrorCode.INVALID_PARAM, "业务请求必须经过后端网关")
            return

        target = message["target"]
        if target == protocol.ModuleId.BACKEND:
            # 后端自行消费的业务报文，交由调度服务处理
            if self._on_business_message is not None:
                reply = self._on_business_message(message)
                if reply is not None:
                    await self._reply(session, reply)
            return

    async def _handle_register(self, session: ClientSession, message: Dict[str, Any]) -> None:
        """处理注册报文：校验模块标识合法性并登记会话"""
        module_id = message["data"].get("module", "")
        if module_id not in (protocol.ModuleId.FRONTEND, protocol.ModuleId.ALGORITHM, protocol.ModuleId.MOTION):
            await self._reply_error(session, protocol.ErrorCode.INVALID_PARAM, "非法模块标识 %s" % module_id)
            return
        if message["source"] != module_id or message["target"] != protocol.ModuleId.BACKEND:
            await self._reply_error(session, protocol.ErrorCode.INVALID_MESSAGE, "注册身份或目标不一致")
            return
        if session.module_id and session.module_id != module_id:
            await self._reply_error(session, protocol.ErrorCode.INVALID_PARAM, "会话不得更改注册身份")
            return
        old_session = self._sessions.get(module_id)
        if old_session is not None and old_session is not session:
            if not old_session.writer.is_closing():
                await self._reply_error(session, protocol.ErrorCode.ROBOT_BUSY, "同名模块已有在线连接")
                return
            self._unregister(old_session)
        session.module_id = module_id
        session.last_heartbeat = time.monotonic()
        self._sessions[module_id] = session
        logger.info("模块注册成功：%s（%s）", module_id, session.peer_name)
        await self._reply(session, protocol.build_message(
            protocol.MsgType.REGISTER_ACK, protocol.ModuleId.BACKEND, module_id))

    async def _heartbeat_patrol(self) -> None:
        """周期巡检所有会话心跳，超时判定离线并断开"""
        while True:
            await asyncio.sleep(HEARTBEAT_CHECK_INTERVAL_SEC)
            now = time.monotonic()
            for module_id in list(self._sessions.keys()):
                session = self._sessions.get(module_id)
                if session is not None and now - session.last_heartbeat > protocol.HEARTBEAT_OFFLINE_SEC:
                    logger.warning("模块 %s 心跳超时，判定离线", module_id)
                    session.writer.close()
                    self._unregister(session)

    def _unregister(self, session: ClientSession) -> None:
        """会话下线时从注册表移除"""
        if session.module_id and self._sessions.get(session.module_id) is session:
            del self._sessions[session.module_id]
            logger.info("模块下线：%s", session.module_id)
            if self._on_disconnect is not None:
                self._on_disconnect(session.module_id)

    async def _reply(self, session: ClientSession, message: Dict[str, Any]) -> None:
        """向当前会话回发报文"""
        async with session.send_lock:
            session.writer.write(protocol.encode_message(message))
            await asyncio.wait_for(session.writer.drain(), protocol.REQUEST_TIMEOUT_SEC)

    async def _reply_error(self, session: ClientSession, code: int, detail: str) -> None:
        """向当前会话回发错误报文"""
        await self._reply(session, protocol.build_message(
            protocol.MsgType.ERROR_REPORT, protocol.ModuleId.BACKEND,
            session.module_id or session.reply_target, code=code, msg=detail))
