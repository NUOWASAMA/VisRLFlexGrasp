# 文件功能：全链路集成测试——模拟「前端下发任务 -> 算法检测 -> 抓取执行 -> 结果回传」完整分拣闭环
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-07-26
# 运行方式（仓库根目录执行）：python -m unittest discover tests/integration

import asyncio
import unittest

from algorithm.algorithm_service import AlgorithmService
from backend.app.service.dispatch_service import DispatchService
from backend.comm.tcp_server import TcpDispatchServer
from common import protocol

# 集成测试专用端口，避开默认端口防止与本机运行中的服务冲突
TEST_PORT = 19000
TEST_HOST = "127.0.0.1"
# 模拟检测器目标总数（与 fruit_detector.MOCK_OBJECT_TOTAL 一致）
EXPECTED_SORTED_COUNT = 3
# 整体用例超时（秒）
CASE_TIMEOUT_SEC = 15.0


async def _mock_client(module_id, on_line):
    """通用模拟客户端：注册后进入收包循环，将业务报文交给 on_line 处理。

    on_line 返回报文字典则回发，返回 "stop" 则结束循环。
    """
    reader, writer = await asyncio.open_connection(TEST_HOST, TEST_PORT)
    writer.write(protocol.encode_message(protocol.build_message(
        protocol.MsgType.REGISTER, module_id, protocol.ModuleId.BACKEND, {"module": module_id})))
    await writer.drain()
    try:
        while True:
            line = await reader.readline()
            if not line:
                break
            message = protocol.decode_message(line)
            if message is None or message["msg_type"] in (
                    protocol.MsgType.REGISTER_ACK, protocol.MsgType.HEARTBEAT_ACK):
                continue
            result = await on_line(message, writer)
            if result == "stop":
                break
    finally:
        writer.close()


class TestFullSortingLoop(unittest.TestCase):
    """全链路分拣闭环用例"""

    def test_full_loop_sorts_all_objects(self):
        """模拟场景 3 个目标全部分拣完成，任务结果计数正确"""
        asyncio.run(asyncio.wait_for(self._run_loop(), CASE_TIMEOUT_SEC))

    async def _run_loop(self):
        # 1. 启动后端调度服务
        dispatch = DispatchService()
        server = TcpDispatchServer(TEST_HOST, TEST_PORT, dispatch.on_message)
        dispatch.bind_server(server)
        server_task = asyncio.create_task(server.start())
        await asyncio.sleep(0.2)

        # 2. 启动真实算法服务（模拟检测模式）
        algorithm_config = {
            "server": {"host": TEST_HOST, "port": TEST_PORT},
            "use_mock": True,
            "log_level": "INFO",
        }
        algorithm_task = asyncio.create_task(AlgorithmService(algorithm_config).run())

        # 3. 模拟运动控制客户端：收到抓取指令即回报「已放置、成功」
        async def motion_handler(message, writer):
            if message["msg_type"] == protocol.MsgType.GRASP_COMMAND:
                writer.write(protocol.encode_message(protocol.build_message(
                    protocol.MsgType.MOTION_STATUS, protocol.ModuleId.MOTION,
                    protocol.ModuleId.BACKEND,
                    {
                        "task_id": message["data"]["task_id"],
                        "phase": "placed",
                        "is_success": True,
                    })))
                await writer.drain()
            return None

        motion_task = asyncio.create_task(_mock_client(protocol.ModuleId.MOTION, motion_handler))
        await asyncio.sleep(0.3)

        # 4. 模拟前端客户端：下发任务并收集进度，直至任务完成
        results = []

        async def frontend_handler(message, writer):
            if message["msg_type"] == protocol.MsgType.TASK_RESULT:
                results.append(message["data"])
                if message["data"]["is_finished"]:
                    return "stop"
            return None

        async def frontend_flow(message_handler):
            reader, writer = await asyncio.open_connection(TEST_HOST, TEST_PORT)
            writer.write(protocol.encode_message(protocol.build_message(
                protocol.MsgType.REGISTER, protocol.ModuleId.FRONTEND,
                protocol.ModuleId.BACKEND, {"module": protocol.ModuleId.FRONTEND})))
            await writer.drain()
            writer.write(protocol.encode_message(protocol.build_message(
                protocol.MsgType.TASK_START, protocol.ModuleId.FRONTEND,
                protocol.ModuleId.BACKEND, {"task_id": "it_task_001", "category": "apple"})))
            await writer.drain()
            while True:
                line = await reader.readline()
                if not line:
                    break
                message = protocol.decode_message(line)
                if message is None or message["msg_type"] in (
                        protocol.MsgType.REGISTER_ACK, protocol.MsgType.HEARTBEAT_ACK):
                    continue
                if await message_handler(message, writer) == "stop":
                    break
            writer.close()

        await frontend_flow(frontend_handler)

        # 5. 校验：分拣计数达到目标总数且任务标记完成
        self.assertTrue(results, "未收到任何任务进度推送")
        final = results[-1]
        self.assertTrue(final["is_finished"])
        self.assertEqual(final["sorted_count"], EXPECTED_SORTED_COUNT)

        # 6. 清理后台任务
        for task in (motion_task, algorithm_task, server_task):
            task.cancel()


if __name__ == "__main__":
    unittest.main()
