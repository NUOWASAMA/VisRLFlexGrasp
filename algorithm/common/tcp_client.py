# 文件功能：模块通用 TCP 客户端，实现注册、心跳保活、断线递增重连与业务报文收发
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-07-26

import asyncio
from typing import Any, Callable, Dict, Optional

from common import protocol
from common.log_util import get_logger

logger = get_logger("algorithm.tcp_client")


class ModuleTcpClient:
    """模块侧 TCP 客户端。

    职责：连接调度服务并注册身份、周期发送心跳、断线按 1s/3s/5s 递增间隔重连、
    将业务报文交给上层回调处理。
    """

    def __init__(self, module_id: str, host: str, port: int,
                 on_message: Callable[[Dict[str, Any]], Optional[Dict[str, Any]]]):
        """入参：module_id 本模块标识；host/port 调度服务地址；
        on_message 业务报文回调，返回需要回发的报文或 None。"""
        self._module_id = module_id
        self._host = host
        self._port = port
        self._on_message = on_message
        self._writer: Optional[asyncio.StreamWriter] = None

    async def run_forever(self) -> None:
        """主循环：连接 -> 注册 -> 收发，断线后自动重连，永不退出（STYLEGUIDE 4.6）"""
        reconnect_index = 0
        while True:
            try:
                await self._connect_and_serve()
                reconnect_index = 0
            except (ConnectionError, OSError, asyncio.IncompleteReadError) as exc:
                interval = protocol.RECONNECT_INTERVALS_SEC[
                    min(reconnect_index, len(protocol.RECONNECT_INTERVALS_SEC) - 1)]
                logger.warning("连接断开（%s），%.0f 秒后重连", exc, interval)
                reconnect_index += 1
                await asyncio.sleep(interval)

    async def send(self, message: Dict[str, Any]) -> None:
        """发送报文，未连接时静默丢弃并记录告警"""
        if self._writer is None:
            logger.warning("连接未建立，报文丢弃：%s", message.get("msg_type"))
            return
        self._writer.write(protocol.encode_message(message))
        await self._writer.drain()

    async def _connect_and_serve(self) -> None:
        """建立连接、注册身份、启动心跳并进入收包循环"""
        reader, writer = await asyncio.open_connection(self._host, self._port)
        self._writer = writer
        logger.info("已连接调度服务 %s:%d", self._host, self._port)
        await self.send(protocol.build_message(
            protocol.MsgType.REGISTER, self._module_id, protocol.ModuleId.BACKEND,
            {"module": self._module_id}))
        heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        try:
            while True:
                line = await reader.readline()
                if not line:
                    raise ConnectionError("服务端关闭连接")
                message = protocol.decode_message(line)
                if message is None:
                    logger.warning("收到非法报文，已忽略")
                    continue
                await self._dispatch(message)
        finally:
            heartbeat_task.cancel()
            self._writer = None
            writer.close()

    async def _dispatch(self, message: Dict[str, Any]) -> None:
        """协议层报文自消化，业务报文交回调处理"""
        msg_type = message["msg_type"]
        if msg_type == protocol.MsgType.REGISTER_ACK:
            logger.info("模块 %s 注册成功", self._module_id)
            return
        if msg_type == protocol.MsgType.HEARTBEAT_ACK:
            return
        reply = self._on_message(message)
        if reply is not None:
            await self.send(reply)

    async def _heartbeat_loop(self) -> None:
        """按统一间隔发送心跳"""
        while True:
            await asyncio.sleep(protocol.HEARTBEAT_INTERVAL_SEC)
            await self.send(protocol.build_message(
                protocol.MsgType.HEARTBEAT, self._module_id, protocol.ModuleId.BACKEND))
