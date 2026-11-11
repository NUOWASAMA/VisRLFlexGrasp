# 文件功能：前端交互层全链路 e2e——浏览器态 WebSocket 请求经 Node 前端网关进入真实后端，由真实 C++ 运动服务完成规划
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-11-11
# 运行方式（仓库根目录执行）：
#   .venv\Scripts\python.exe -m unittest tests.e2e.test_frontend_full_loop -v

import asyncio
import copy
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest

REPO = Path(__file__).resolve().parents[2]
# 复用集成测试中的最小 WS 客户端、网关子进程与配置构造工具，并定位 C++ 二进制查找函数
for location in (REPO, REPO / "tests/integration"):
    if str(location) not in sys.path:
        sys.path.insert(0, str(location))

DEPENDENCIES_READY = True
IMPORT_ERROR = None
try:
    import httpx
    import uvicorn

    from backend.app.api.application import create_app
    from common import protocol
    from common.config_loader import load_config
    from embedded.tools.export_ur5_model import multiply
    from test_frontend_gateway import GatewayProcess, MiniWebSocket, build_gateway_config, free_port
    from test_motion_service import find_binary, quaternion
except ImportError as error:  # 依赖缺失时整类跳过而非失败，便于在未装依赖的环境回归其余用例
    DEPENDENCIES_READY = False
    IMPORT_ERROR = error

GATEWAY_MAIN = REPO / "frontend/gateway/main.mjs"
NODE_BINARY = shutil.which("node")
MOTION_BINARY = find_binary() if DEPENDENCIES_READY else None
# 启动等待与全链路最长等待（秒），保证本文件总耗时可控
STARTUP_TIMEOUT_SEC = 20.0
TASK_TIMEOUT_SEC = 30.0
# 规划服务返回的轨迹采样点数（embedded/config/base.json 的 trajectory.sample_count）
EXPECTED_TRAJECTORY_POINTS = 101
# 浏览器态 WebSocket 上行请求标识与任务标识，便于日志追踪
E2E_REQUEST_ID = "e2e-request-1"
E2E_TASK_ID = "e2e_task_1"
E2E_CATEGORY = "apple"


def boundary_socket():
    """创建已监听的本机套接字，交给 uvicorn 复用以免端口抢占竞态。

    返回：绑定 127.0.0.1 随机端口并已 listen 的套接字。
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", 0))
    sock.listen(128)
    return sock


class RealBackendServer:
    """在后台线程中以 uvicorn 运行真实后端，提供可被网关代理的 HTTP 端口。

    说明：网关必须通过真实 TCP 访问后端 HTTP，ASGI 传输无法被 Node 代理复用。
    """

    def __init__(self, app):
        self.app = app
        self.socket = boundary_socket()
        self.port = self.socket.getsockname()[1]
        self.server = None
        self._thread = None

    def start(self):
        """启动后台线程并阻塞等待 uvicorn 完成启动（含 lifespan 初始化）。"""
        config = uvicorn.Config(self.app, host="127.0.0.1", port=0, log_level="warning",
                                lifespan="on", access_log=False)
        self.server = uvicorn.Server(config)
        self._thread = threading.Thread(target=self._serve, name="e2e-backend", daemon=True)
        self._thread.start()
        deadline = time.monotonic() + STARTUP_TIMEOUT_SEC
        while not self.server.started:
            if not self._thread.is_alive():
                raise AssertionError("真实后端线程提前退出")
            if time.monotonic() > deadline:
                raise AssertionError("真实后端启动超时")
            time.sleep(0.02)

    def _serve(self):
        """后台线程入口：在独立事件循环中运行 uvicorn 至收到退出信号。"""
        asyncio.run(self.server.serve(sockets=[self.socket]))

    def stop(self):
        """通知 uvicorn 优雅退出并等待线程结束（可重复调用）。"""
        if self.server is not None:
            self.server.should_exit = True
            if self._thread is not None:
                self._thread.join(timeout=10)
                if self._thread.is_alive():
                    self.server.force_exit = True
                    self._thread.join(timeout=5)
            self._thread = None
            self.server = None
        try:
            self.socket.close()
        except OSError:
            pass


class MotionProcess:
    """启动真实 C++ 运动规划服务，使其以 motion 模块注册到真实后端 TCP。"""

    def __init__(self, binary, backend_port, directory):
        self.directory = Path(directory)
        self.config_path = self.directory / "motion.json"
        self.model = json.loads((REPO / "embedded/config/ur5_model.json").read_text(encoding="utf-8"))
        motion_config = json.loads((REPO / "embedded/config/base.json").read_text(encoding="utf-8"))
        motion_config["server"]["port"] = backend_port
        # 配置与模型放到同一临时目录，C++ 侧按配置目录解析 model_file
        motion_config["model_file"] = "ur5_model.json"
        (self.directory / "ur5_model.json").write_text(json.dumps(self.model), encoding="utf-8")
        self.config_path.write_text(json.dumps(motion_config), encoding="utf-8")
        self.log_path = self.directory / "motion_process.log"
        self._log_file = open(self.log_path, "w+b")
        self._process = subprocess.Popen(
            [str(binary), "--config", str(self.config_path)], cwd=str(REPO),
            stdout=self._log_file, stderr=self._log_file,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)

    def stop(self):
        """终止 C++ 进程并关闭日志句柄（可重复调用）。"""
        if self._process is not None and self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()
                self._process.wait(timeout=5)
        self._process = None
        if self._log_file is not None:
            self._log_file.close()
            self._log_file = None

    def is_running(self):
        """返回 C++ 规划服务进程是否仍在运行。"""
        return self._process is not None and self._process.poll() is None

    def log_text(self):
        """读取 C++ 进程日志尾部，用于失败诊断。"""
        try:
            return self.log_path.read_text(encoding="utf-8", errors="replace")
        except FileNotFoundError:
            return ""


class FakeAlgorithmClient:
    """假算法客户端：注册 algorithm 模块，收到 capture_cmd 后回检测结果。"""

    def __init__(self, host, port, grasp_pose):
        self.host = host
        self.port = port
        self.grasp_pose = grasp_pose
        self.registered = asyncio.Event()
        self.received = []
        self._task = None
        self._writer = None

    def start(self):
        """在当前事件循环中启动客户端收包任务。"""
        self._task = asyncio.create_task(self._run())

    async def _run(self):
        """连接真实后端 TCP，完成注册并响应采集指令。"""
        reader, writer = await asyncio.open_connection(self.host, self.port)
        self._writer = writer
        register = protocol.build_message(
            protocol.MsgType.REGISTER, protocol.ModuleId.ALGORITHM, protocol.ModuleId.BACKEND,
            {"module": protocol.ModuleId.ALGORITHM})
        writer.write(protocol.encode_message(register))
        await writer.drain()
        try:
            while True:
                line = await reader.readline()
                if not line:
                    break
                message = protocol.decode_message(line)
                if message is None:
                    continue
                self.received.append(message)
                if message["msg_type"] == protocol.MsgType.REGISTER_ACK:
                    self.registered.set()
                elif message["msg_type"] == protocol.MsgType.CAPTURE_CMD:
                    task_id = message["data"].get("task_id", "")
                    result = protocol.build_message(
                        protocol.MsgType.DETECTION_RESULT, protocol.ModuleId.ALGORITHM,
                        protocol.ModuleId.BACKEND,
                        {"task_id": task_id,
                         "objects": [{"label": E2E_CATEGORY, "grasp_pose": self.grasp_pose,
                                      "force_limit": 5.0}]})
                    writer.write(protocol.encode_message(result))
                    await writer.drain()
        except (ConnectionError, OSError, asyncio.IncompleteReadError):
            pass
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except (ConnectionError, OSError):
                pass

    async def stop(self):
        """关闭连接并取消收包任务（可重复调用）。"""
        if self._writer is not None:
            self._writer.close()
            try:
                await self._writer.wait_closed()
            except (ConnectionError, OSError):
                pass
            self._writer = None
        if self._task is not None:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None

    def capture_commands(self):
        """返回已收到的采集指令报文列表。"""
        return [message for message in self.received
                if message["msg_type"] == protocol.MsgType.CAPTURE_CMD]


@unittest.skipUnless(DEPENDENCIES_READY, "缺少 Python 依赖：%s" % (IMPORT_ERROR,))
@unittest.skipUnless(NODE_BINARY and GATEWAY_MAIN.is_file(), "缺少 node 或前端网关实现 frontend/gateway/main.mjs")
@unittest.skipUnless(MOTION_BINARY is not None, "需已编译的 motion_control（可设置 VISRL_MOTION_BINARY）")
class TestFrontendFullLoop(unittest.IsolatedAsyncioTestCase):
    """全链路 e2e：浏览器 WS -> 前端网关 -> 真实后端 -> 真实 C++ 规划 -> 结果回推。"""

    async def asyncSetUp(self):
        """依次拉起真实后端、真实 C++ 运动服务、前端网关与假算法客户端。"""
        self.temp = tempfile.TemporaryDirectory(prefix="tmp_frontend_e2e_", dir=str(REPO))
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.dist = self.root / "dist"
        self.dist.mkdir()
        (self.dist / "index.html").write_text(
            '<!doctype html>\n<html><body><div id="app">visrl e2e dist</div></body></html>\n',
            encoding="utf-8")

        # 1. 真实后端：配置复制自 backend/config，数据库与日志替换到临时目录，内部 TCP 端口取 0 由系统分配
        self.config = load_config(str(REPO / "backend/config"), "sim")
        self.config["database"]["path"] = str(self.root / "tasks.db")
        self.config["log_file"] = str(self.root / "backend.log")
        self.config["server"]["port"] = 0
        self.config["api"]["port"] = 0
        self.config["gateway"]["plan_timeout_sec"] = 10.0
        self.app = create_app(copy.deepcopy(self.config))
        self.backend = RealBackendServer(self.app)
        self.backend.start()
        self.addCleanup(self.backend.stop)
        self.backend_client = httpx.AsyncClient(
            base_url="http://127.0.0.1:%d" % self.backend.port, timeout=5.0, trust_env=False)
        self.addAsyncCleanup(self.backend_client.aclose)
        self.tcp_port = self.app.state.tcp_server._server.sockets[0].getsockname()[1]

        # 2. 真实 C++ 运动服务：注册到后端内部 TCP，等待真实后端报告 motion_online
        self.motion = MotionProcess(MOTION_BINARY, self.tcp_port, self.root)
        self.addCleanup(self.motion.stop)
        await self.wait_for(self._is_motion_online, "C++ 运动服务未注册到真实后端")

        # 3. 前端网关：HTTP/WS 监听临时端口，代理真实后端 HTTP 并作为 frontend 模块注册到真实 TCP
        self.gateway_port = free_port()
        gateway_config = build_gateway_config(
            self.gateway_port, self.tcp_port, self.backend.port, self.dist, self.root / "gateway.log")
        config_path = self.root / "gateway.json"
        config_path.write_text(json.dumps(gateway_config, ensure_ascii=False), encoding="utf-8")
        self.gateway = GatewayProcess(config_path, self.root / "gateway_process.log")
        self.gateway.start(self.gateway_port)
        self.addCleanup(self.gateway.stop)
        await self.gateway.wait_ready()
        self.gateway_client = httpx.AsyncClient(
            base_url="http://127.0.0.1:%d" % self.gateway_port, timeout=10.0, trust_env=False)
        self.addAsyncCleanup(self.gateway_client.aclose)
        await self.wait_for(self._is_gateway_registered, "前端网关未完成 TCP 注册")

        # 4. 假算法客户端：按既有 TCP 协议注册并等待采集指令
        self.model = json.loads((REPO / "embedded/config/ur5_model.json").read_text(encoding="utf-8"))
        fixture = json.loads((REPO / "tests/fixtures/ur5_scene_poses.json").read_text(encoding="utf-8"))
        tcp_pose = multiply(multiply(self.model["world_from_base"],
                                     fixture["cases"][1]["base_from_flange"]),
                            self.model["flange_from_tcp"])
        grasp_pose = {"position": [tcp_pose[index][3] for index in range(3)],
                      "orientation": quaternion(tcp_pose)}
        self.algorithm = FakeAlgorithmClient("127.0.0.1", self.tcp_port, grasp_pose)
        self.algorithm.start()
        self.addAsyncCleanup(self.algorithm.stop)
        try:
            await asyncio.wait_for(self.algorithm.registered.wait(), STARTUP_TIMEOUT_SEC)
        except asyncio.TimeoutError:
            raise AssertionError("假算法客户端未完成注册")

    async def wait_for(self, condition, description, timeout=STARTUP_TIMEOUT_SEC):
        """轮询异步条件直至成立，超时携带各服务日志尾部抛出断言错误。"""
        deadline = asyncio.get_running_loop().time() + timeout
        while True:
            if await condition():
                return
            if asyncio.get_running_loop().time() > deadline:
                raise AssertionError("%s（超时）；网关日志：\n%s\nC++ 日志：\n%s" % (
                    description, self.gateway.log_text()[-3000:], self.motion.log_text()[-2000:]))
            await asyncio.sleep(0.05)

    async def _is_motion_online(self):
        """真实后端是否已识别 C++ 运动服务在线。"""
        if not self.motion.is_running():
            raise AssertionError("C++ 运动服务进程提前退出：\n%s" % self.motion.log_text()[-3000:])
        reply = await self.backend_client.get("/robot/status")
        return reply.status_code == 200 and reply.json()["data"]["motion_online"]

    async def _is_gateway_registered(self):
        """前端网关是否已连接真实后端 TCP 并完成 frontend 模块注册。"""
        if not self.gateway.is_running():
            raise AssertionError("前端网关进程提前退出：\n%s" % self.gateway.log_text()[-3000:])
        reply = await self.gateway_client.get("/api/gateway/status")
        data = reply.json().get("data", {})
        return reply.status_code == 200 and data.get("tcp_connected") and data.get("registered")

    async def test_ws_task_start_plans_with_real_cpp_service(self):
        """WS 下发任务经网关与真实后端驱动 C++ 规划，并可从 HTTP 查询到 101 点轨迹。"""
        client = MiniWebSocket("127.0.0.1", self.gateway_port, "/ws", timeout=10.0)
        await client.connect()
        self.addAsyncCleanup(client.close)
        connection = await client.recv_until(lambda message: message.get("type") == "connection")
        self.assertTrue(connection["data"]["tcp_connected"])
        self.assertTrue(connection["data"]["registered"])

        await client.send_json({"type": "task_start", "request_id": E2E_REQUEST_ID,
                                "data": {"task_id": E2E_TASK_ID, "category": E2E_CATEGORY, "speed_level": 1}})
        ack = await client.recv_until(lambda message: message.get("type") == "ack")
        self.assertEqual(ack["request_id"], E2E_REQUEST_ID)
        self.assertEqual(ack["data"]["task_id"], E2E_TASK_ID)

        result = await client.recv_until(
            lambda message: message.get("type") == "task_result", timeout=TASK_TIMEOUT_SEC)
        data = result["data"]
        self.assertEqual(data["task_id"], E2E_TASK_ID)
        self.assertEqual(data["phase"], "planned", data)
        self.assertFalse(data["executed"])
        self.assertTrue(data["is_finished"])
        self.assertEqual(data["sorted_count"], 0)
        planning_task_id = data.get("planning_task_id")
        self.assertIsInstance(planning_task_id, str)
        self.assertTrue(planning_task_id)
        self.assertTrue(self.algorithm.capture_commands(), "假算法未收到采集指令")

        # 规划结果已持久化：经网关查询任务详情应处于 planned 终态且轨迹为 101 个采样点
        detail = await self.gateway_client.get("/api/tasks/" + planning_task_id)
        self.assertEqual(detail.status_code, 200, detail.text)
        record = detail.json()["data"]
        self.assertEqual(record["status"], "planned", record)
        self.assertFalse(record["result"]["executed"])
        self.assertEqual(len(record["result"]["joint_trajectory"]), EXPECTED_TRAJECTORY_POINTS)
        self.assertEqual(record["request"]["force_limit"], 5.0)

        # 真实后端 HTTP 接口经网关可用，且运动服务确由真实 C++ 进程提供
        health = await self.gateway_client.get("/api/health")
        self.assertEqual(health.status_code, 200, health.text)
        self.assertEqual(health.json()["data"]["status"], "ok")
        status = await self.gateway_client.get("/api/robot/status")
        self.assertEqual(status.status_code, 200, status.text)
        status_data = status.json()["data"]
        self.assertTrue(status_data["motion_online"])
        self.assertEqual(status_data["execution_mode"], "plan_only")
        self.assertIsNone(status_data["current_joint_angles"])

        gateway_status = (await self.gateway_client.get("/api/gateway/status")).json()["data"]
        self.assertTrue(gateway_status["tcp_connected"])
        self.assertTrue(gateway_status["registered"])
        gateway_config = (await self.gateway_client.get("/api/gateway/config")).json()["data"]
        self.assertEqual(gateway_config["backend"]["http"]["port"], self.backend.port)


if __name__ == "__main__":
    unittest.main(verbosity=2)
