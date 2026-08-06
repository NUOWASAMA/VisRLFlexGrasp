# 文件功能：TCP 调度服务端，负责客户端注册管理、心跳保活检测与报文路由转发
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
        self.last_heartbeat = time.monotonic()

    @property
    def peer_name(self) -> str:
        """返回客户端地址描述，用于日志输出"""
        peer = self.writer.get_extra_info("peername")
        return "%s:%s" % (peer[0], peer[1]) if peer else "unknown"


class TcpDispatchServer:
    """TCP 调度服务端。

    职责边界：只做注册、心跳、按 target 字段路由转发；业务编排交由上层 dispatch_service 处理。
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

    async def start(self) -> None:
        """启动监听与心跳巡检任务，本方法会阻塞直至服务关闭"""
        self._server = await asyncio.start_server(
            self._handle_client, self._host, self._port, limit=MAX_LINE_BYTES
        )
        asyncio.create_task(self._heartbeat_patrol())
        logger.info("TCP 调度服务已启动，监听 %s:%d", self._host, self._port)
        async with self._server:
            await self._server.serve_forever()

    def is_online(self, module_id: str) -> bool:
        """判断指定模块是否在线"""
        return module_id in self._sessions

    async def send_to(self, module_id: str, message: Dict[str, Any]) -> bool:
        """向指定模块发送报文。

        入参：module_id 目标模块标识；message 报文字典。
        返回：目标在线且发送成功返回 True，目标离线返回 False。
        """
        session = self._sessions.get(module_id)
        if session is None:
            logger.warning("目标模块离线，发送失败：%s -> %s", message.get("msg_type"), module_id)
            return False
        session.writer.write(protocol.encode_message(message))
        await session.writer.drain()
        return True

    async def _handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        """单客户端收包循环：解析报文 -> 注册/心跳自处理 -> 其余按 target 路由"""
        session = ClientSession(reader, writer)
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
        except (ConnectionResetError, asyncio.IncompleteReadError):
            pass
        finally:
            self._unregister(session)
            writer.close()

    async def _route_message(self, session: ClientSession, message: Dict[str, Any]) -> None:
        """按报文类型分发：注册与心跳由服务端消费，业务报文校验注册身份后路由"""
        msg_type = message["msg_type"]
        if msg_type == protocol.MsgType.REGISTER:
            await self._handle_register(session, message)
            return
        if msg_type == protocol.MsgType.HEARTBEAT:
            session.last_heartbeat = time.monotonic()
            await self._reply(session, protocol.build_message(
                protocol.MsgType.HEARTBEAT_ACK, protocol.ModuleId.BACKEND, session.module_id or "unknown"))
            return
        if not session.module_id:
            await self._reply_error(session, protocol.ErrorCode.NOT_REGISTERED, "请先完成注册")
            return

        target = message["target"]
        if target == protocol.ModuleId.BACKEND:
            # 后端自行消费的业务报文，交由调度服务处理
            if self._on_business_message is not None:
                reply = self._on_business_message(message)
                if reply is not None:
                    await self._reply(session, reply)
            return
        # 跨模块转发
        if not await self.send_to(target, message):
            await self._reply_error(session, protocol.ErrorCode.TARGET_OFFLINE, "目标模块 %s 离线" % target)

    async def _handle_register(self, session: ClientSession, message: Dict[str, Any]) -> None:
        """处理注册报文：校验模块标识合法性并登记会话"""
        module_id = message["data"].get("module", "")
        if module_id not in protocol.ModuleId.ALL:
            await self._reply_error(session, protocol.ErrorCode.INVALID_PARAM, "非法模块标识 %s" % module_id)
            return
        old_session = self._sessions.get(module_id)
        if old_session is not None and old_session is not session:
            # 同名模块重连时踢掉旧会话，避免消息发往失效连接
            old_session.writer.close()
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

    async def _reply(self, session: ClientSession, message: Dict[str, Any]) -> None:
        """向当前会话回发报文"""
        session.writer.write(protocol.encode_message(message))
        await session.writer.drain()

    async def _reply_error(self, session: ClientSession, code: int, detail: str) -> None:
        """向当前会话回发错误报文"""
        await self._reply(session, protocol.build_message(
            protocol.MsgType.ERROR_REPORT, protocol.ModuleId.BACKEND,
            session.module_id or "unknown", code=code, msg=detail))
