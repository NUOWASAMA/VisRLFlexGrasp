# 文件功能：前端网关（Node 子进程）Python 集成测试，使用假后端 TCP/HTTP 与最小 RFC6455 WebSocket 客户端
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-11-11
# 运行方式（仓库根目录执行）：
#   .venv\Scripts\python.exe -m unittest tests.integration.test_frontend_gateway -v

import asyncio
import base64
import hashlib
import http.server
import json
import os
from pathlib import Path
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest

import httpx

REPO = Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from common import protocol  # noqa: E402  先保证仓库根在导入路径中

# 前端网关入口与运行时依赖
GATEWAY_MAIN = REPO / "frontend/gateway/main.mjs"
NODE_BINARY = shutil.which("node")
# 启动/等待超时（秒），单文件总耗时控制在 60 秒以内
READY_TIMEOUT_SEC = 15.0
MESSAGE_TIMEOUT_SEC = 5.0
# 与 frontend/config/base.json 保持一致的帧上限
MAX_FRAME_BYTES = 1024 * 1024
# RFC6455 规定的固定 GUID，用于校验握手 Accept 值
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
# 临时 dist 内容：仅 ASCII，避免响应编码干扰断言
INDEX_HTML = '<!doctype html>\n<html><body><div id="app">visrl frontend test dist</div></body></html>\n'
APP_JS = 'console.log("visrl frontend test dist");\n'
# 测试用 UI 配置，用于断言 /api/gateway/config 透传
TEST_UI = {
    "poll_interval_ms": 1000,
    "default_force_limit": 5.0,
    "categories": ["apple", "pear"],
    "speed_levels": [1, 2, 3],
    "event_log_limit": 50,
    "task_history_limit": 10,
}


def free_port():
    """申请一个当前空闲的本机端口，供测试配置注入使用。

    返回：绑定 127.0.0.1 随机端口后立即释放的端口号。
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def relative_to_repo(path):
    """把仓库内路径转换为网关配置约定的仓库根相对路径（统一正斜杠）。

    入参：path 仓库内的文件或目录路径。
    返回：形如 tmp_frontend_gateway_xxx/dist 的相对路径字符串。
    异常：路径不在仓库内时抛出 ValueError（测试临时目录必须位于仓库根下）。
    """
    return Path(path).resolve().relative_to(REPO.resolve()).as_posix()


def build_gateway_config(gateway_port, tcp_port, http_port, static_dir, log_file):
    """构造前端网关测试用单文件合并配置。

    入参：gateway_port 网关 HTTP/WS 监听端口；tcp_port 假/真后端内部 TCP 端口；
    http_port 后端 HTTP 端口；static_dir 静态目录；log_file 网关日志文件。
    返回：可直接写入临时 JSON 的配置字典。
    """
    return {
        "env": "sim",
        "gateway": {
            "host": "127.0.0.1",
            "port": gateway_port,
            "ws_path": "/ws",
            "api_prefix": "/api",
            "static_dir": relative_to_repo(static_dir),
            "max_frame_bytes": MAX_FRAME_BYTES,
            "heartbeat_interval_sec": 0.2,
            "heartbeat_timeout_sec": 1,
            "reconnect_intervals_sec": [0.1, 0.2, 0.3],
            "send_timeout_sec": 1,
            "log_level": "DEBUG",
            "log_file": relative_to_repo(log_file),
        },
        "backend": {
            "http": {"host": "127.0.0.1", "port": http_port},
            "tcp": {"host": "127.0.0.1", "port": tcp_port},
        },
        "ui": TEST_UI,
    }


class MiniWebSocket:
    """最小 RFC6455 WebSocket 客户端。

    仅使用 asyncio 流实现握手、掩码文本帧收发与 ping/pong 应答，
    避免为集成测试引入 websockets 等额外 Python 依赖。
    """

    def __init__(self, host, port, path="/ws", timeout=MESSAGE_TIMEOUT_SEC):
        self.host = host
        self.port = port
        self.path = path
        self.timeout = timeout
        self.received = []
        self._reader = None
        self._writer = None
        self._fragments = []

    async def connect(self):
        """建立 TCP 连接并完成 WebSocket 握手校验，失败时抛出断言错误。"""
        self._reader, self._writer = await asyncio.wait_for(
            asyncio.open_connection(self.host, self.port, limit=MAX_FRAME_BYTES * 2), self.timeout)
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        request = ("GET %s HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                   "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n"
                   % (self.path, self.host, self.port, key))
        self._writer.write(request.encode("ascii"))
        await self._writer.drain()
        status_line = await asyncio.wait_for(self._reader.readline(), self.timeout)
        headers = {}
        while True:
            line = await asyncio.wait_for(self._reader.readline(), self.timeout)
            if line in (b"\r\n", b"\n", b""):
                break
            name, _, value = line.decode("ascii", errors="replace").partition(":")
            headers[name.strip().lower()] = value.strip()
        self._check_handshake(status_line, headers, key)

    def _check_handshake(self, status_line, headers, key):
        """校验 101 状态行与 Sec-WebSocket-Accept，避免把普通 HTTP 响应当成 WS。"""
        if b" 101 " not in status_line:
            raise AssertionError("WebSocket 握手被拒绝：%r" % status_line)
        expected = base64.b64encode(
            hashlib.sha1((key + WS_GUID).encode("ascii")).digest()).decode("ascii")
        if headers.get("sec-websocket-accept") != expected:
            raise AssertionError("WebSocket Accept 校验失败：%r" % headers)

    async def send_json(self, message):
        """发送一个 JSON 文本帧。"""
        await self.send_text(json.dumps(message, ensure_ascii=False))

    async def send_text(self, text):
        """发送 UTF-8 文本帧（客户端帧按协议要求掩码）。"""
        await self._send_frame(0x1, text.encode("utf-8"))

    async def _send_frame(self, opcode, payload):
        """按 RFC6455 组帧并写入连接，客户端发送的帧必须掩码。"""
        mask = os.urandom(4)
        length = len(payload)
        header = bytearray([0x80 | opcode])
        if length < 126:
            header.append(0x80 | length)
        elif length <= 0xFFFF:
            header.append(0x80 | 126)
            header.extend(struct.pack("!H", length))
        else:
            header.append(0x80 | 127)
            header.extend(struct.pack("!Q", length))
        header.extend(mask)
        self._writer.write(bytes(header) + bytes(
            value ^ mask[index % 4] for index, value in enumerate(payload)))
        await self._writer.drain()

    async def _read_frame(self):
        """读取一个完整帧，返回 (fin, opcode, payload) 三元组。"""
        header = await self._reader.readexactly(2)
        fin = bool(header[0] & 0x80)
        opcode = header[0] & 0x0F
        masked = bool(header[1] & 0x80)
        length = header[1] & 0x7F
        if length == 126:
            length = struct.unpack("!H", await self._reader.readexactly(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", await self._reader.readexactly(8))[0]
        if length > MAX_FRAME_BYTES:
            raise AssertionError("收到超过帧上限的报文：%d 字节" % length)
        mask = await self._reader.readexactly(4) if masked else None
        payload = await self._reader.readexactly(length) if length else b""
        if mask is not None:
            payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        return fin, opcode, payload

    async def _recv_text_message(self):
        """读取下一个文本报文并解析 JSON；ping 自动回 pong，pong 与二进制帧忽略。"""
        while True:
            fin, opcode, payload = await self._read_frame()
            if opcode == 0x8:
                raise AssertionError("WebSocket 连接已被服务端关闭")
            if opcode == 0x9:
                await self._send_frame(0xA, payload)
                continue
            if opcode == 0xA:
                continue
            if opcode not in (0x0, 0x1, 0x2):
                continue
            self._fragments.append(payload)
            if not fin:
                continue
            raw = b"".join(self._fragments)
            self._fragments = []
            try:
                message = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                raise AssertionError("收到非法 JSON 报文：%r" % raw[:200]) from error
            self.received.append(message)
            return message

    async def recv_json(self, timeout=None):
        """等待一个 JSON 报文，超时抛出断言错误。"""
        timeout = self.timeout if timeout is None else timeout
        try:
            return await asyncio.wait_for(self._recv_text_message(), timeout)
        except asyncio.TimeoutError as error:
            raise AssertionError("等待 WebSocket 报文超时（%.1f 秒）" % timeout) from error

    async def recv_until(self, predicate, timeout=MESSAGE_TIMEOUT_SEC):
        """持续接收报文直至 predicate 成立，返回命中的报文。"""
        deadline = asyncio.get_running_loop().time() + timeout
        while True:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                raise AssertionError("未收到期望的 WebSocket 报文；已收到 type：%r"
                                     % [message.get("type") for message in self.received])
            try:
                message = await asyncio.wait_for(self._recv_text_message(), remaining)
            except asyncio.TimeoutError:
                raise AssertionError("未收到期望的 WebSocket 报文；已收到 type：%r"
                                     % [message.get("type") for message in self.received])
            if predicate(message):
                return message

    async def close(self):
        """发送关闭帧并关闭底层连接（可重复调用）。"""
        if self._writer is None:
            return
        writer = self._writer
        self._writer = None
        try:
            if not writer.is_closing():
                writer.write(bytes([0x88, 0x80]) + os.urandom(4))
                await writer.drain()
        except (ConnectionError, OSError):
            pass
        writer.close()
        try:
            await writer.wait_closed()
        except (ConnectionError, OSError):
            pass


class FakeBackendTcp:
    """假后端调度 TCP 服务：处理注册/心跳/任务，并按需回推 task_result。"""

    def __init__(self):
        self._server = None
        self._writers = {}
        self._client_tasks = set()
        self.received = []
        self.auto_result = True
        self._changed = asyncio.Event()

    @property
    def port(self):
        return self._server.sockets[0].getsockname()[1]

    async def start(self):
        self._server = await asyncio.start_server(
            self._handle_client, "127.0.0.1", 0, limit=MAX_FRAME_BYTES)

    async def stop(self):
        """关闭监听与所有客户端连接（可重复调用）。"""
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None
        for writer in list(self._writers.values()):
            writer.close()
            try:
                await writer.wait_closed()
            except (ConnectionError, OSError):
                pass
        self._writers.clear()
        for task in list(self._client_tasks):
            task.cancel()
        await asyncio.gather(*self._client_tasks, return_exceptions=True)
        self._client_tasks.clear()

    async def _handle_client(self, reader, writer):
        """单连接收包循环：记录报文并处理注册/心跳/任务三类请求。"""
        task = asyncio.current_task()
        self._client_tasks.add(task)
        try:
            while True:
                line = await reader.readline()
                if not line:
                    break
                message = protocol.decode_message(line)
                if message is None:
                    continue
                self.received.append(message)
                self._changed.set()
                await self._respond(message, writer)
        except (ConnectionError, OSError, asyncio.IncompleteReadError):
            pass
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except (ConnectionError, OSError):
                pass
            self._client_tasks.discard(task)

    async def _respond(self, message, writer):
        """按仓库现有 TCP 协议生成 ACK；task_start 可按配置立即回推 task_result。"""
        msg_type = message["msg_type"]
        reply = None
        if msg_type == protocol.MsgType.REGISTER:
            self._writers[message["data"].get("module", "")] = writer
            reply = protocol.build_message(protocol.MsgType.REGISTER_ACK, "backend", message["source"])
        elif msg_type == protocol.MsgType.HEARTBEAT:
            reply = protocol.build_message(protocol.MsgType.HEARTBEAT_ACK, "backend", message["source"])
        elif msg_type == protocol.MsgType.TASK_START and self.auto_result:
            reply = self.task_result(message["data"].get("task_id", ""))
        if reply is not None:
            writer.write(protocol.encode_message(reply))
            await writer.drain()

    @staticmethod
    def task_result(task_id):
        """构造与真实后端一致的 task_result 报文，供网关 WS 转发断言。"""
        return protocol.build_message(protocol.MsgType.TASK_RESULT, "backend", "frontend", {
            "task_id": task_id,
            "sorted_count": 0,
            "is_finished": True,
            "phase": "planned",
            "executed": False,
            "planning_task_id": "planning_" + task_id,
            "error": None,
        })

    async def push(self, message, module="frontend"):
        """向指定已注册模块主动推送报文。"""
        writer = self._writers.get(module)
        if writer is None:
            raise AssertionError("假后端尚无已注册模块 %s" % module)
        writer.write(protocol.encode_message(message))
        await writer.drain()

    async def wait_for_message(self, predicate, timeout=MESSAGE_TIMEOUT_SEC, start=0):
        """等待 start 之后收到的第一条满足 predicate 的报文。"""
        deadline = asyncio.get_running_loop().time() + timeout
        index = start
        while True:
            self._changed.clear()
            while index < len(self.received):
                message = self.received[index]
                index += 1
                if predicate(message):
                    return message
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                raise AssertionError("等待假后端报文超时；已收到：%r"
                                     % [message["msg_type"] for message in self.received[start:]])
            try:
                await asyncio.wait_for(self._changed.wait(), remaining)
            except asyncio.TimeoutError:
                raise AssertionError("等待假后端报文超时；已收到：%r"
                                     % [message["msg_type"] for message in self.received[start:]])


class FakeBackendHttp:
    """假后端 HTTP 服务：线程内运行标准库 ThreadingHTTPServer 并记录代理请求。"""

    def __init__(self):
        self.requests = []
        self.plan_status = 202
        self.plan_data = {"task_id": "plan-202", "status": "planning", "task_url": "/tasks/plan-202"}
        self._server = None
        self._thread = None

    @property
    def port(self):
        return self._server.server_address[1]

    def start(self):
        """在后台线程启动 HTTP 服务。"""
        self._server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), self._build_handler())
        self._server.daemon_threads = True
        self._server.fake_backend = self
        self._thread = threading.Thread(target=self._server.serve_forever, name="fake-backend-http", daemon=True)
        self._thread.start()

    def stop(self):
        """关闭监听与后台线程（可重复调用）。"""
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
            self._server = None
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None

    @staticmethod
    def _build_handler():
        """构造记录型请求处理器，屏蔽标准库访问日志避免污染测试输出。"""
        class RecordHandler(http.server.BaseHTTPRequestHandler):
            def log_message(self, format_string, *args):
                pass

            def do_GET(self):
                self.server.fake_backend.handle_request(self, "GET")

            def do_POST(self):
                self.server.fake_backend.handle_request(self, "POST")

        return RecordHandler

    def handle_request(self, request, method):
        """读取请求体、记录请求信息并返回预置的统一响应。"""
        length = int(request.headers.get("Content-Length") or 0)
        body = request.rfile.read(length) if length else b""
        self.requests.append({
            "method": method,
            "path": request.path,
            "headers": {name.lower(): value for name, value in request.headers.items()},
            "body": body,
        })
        status, payload = self._route(method, request.path)
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request.send_response(status)
        request.send_header("Content-Type", "application/json; charset=utf-8")
        request.send_header("Content-Length", str(len(raw)))
        request.end_headers()
        request.wfile.write(raw)
        request.wfile.flush()

    def _route(self, method, path):
        """按后端第一阶段 HTTP 契约返回假响应，便于断言网关透传行为。"""
        if method == "GET" and path == "/health":
            return 200, self._response({"status": "ok", "execution_mode": "plan_only"})
        if method == "GET" and path == "/robot/status":
            return 200, self._response({
                "motion_online": True,
                "controller_connected": False,
                "execution_mode": "plan_only",
                "busy": False,
                "active_task_id": None,
                "current_joint_angles": None,
                "feedback_source": "unavailable",
                "planning_reference": [0.0] * 6,
            })
        if method == "GET" and path.startswith("/tasks/"):
            task_id = path.split("/tasks/", 1)[1]
            if task_id == "missing":
                return 404, self._response({}, 1004, "任务不存在")
            return 200, self._response({
                "task_id": task_id,
                "status": "planned",
                "request": {},
                "result": {"executed": False},
                "error": None,
                "created_at": int(time.time() * 1000),
                "updated_at": int(time.time() * 1000),
            })
        if method == "POST" and path == "/robot/plan":
            if self.plan_status == 202:
                return 202, self._response(dict(self.plan_data))
            return self.plan_status, self._response({}, 3003, "已有规划任务正在运行")
        return 404, self._response({}, 1004, "未知接口")

    @staticmethod
    def _response(data, code=0, message="success"):
        """构造与后端一致的四字段统一响应。"""
        return {"code": code, "msg": message, "data": data, "timestamp": int(time.time() * 1000)}


class GatewayProcess:
    """以前端子进程方式运行真实网关，负责就绪等待、日志采集与清理。"""

    def __init__(self, config_path, output_log):
        self.config_path = Path(config_path)
        self.output_log = Path(output_log)
        self.port = None
        self._process = None
        self._log_file = None

    def start(self, port):
        """启动 node 网关子进程，标准输出重定向到临时日志文件。"""
        self.port = port
        self._log_file = open(self.output_log, "w+b")
        environment = dict(os.environ)
        environment["VISRL_ENV"] = "sim"
        self._process = subprocess.Popen(
            [NODE_BINARY, str(GATEWAY_MAIN), "--config", str(self.config_path)],
            cwd=str(REPO), env=environment, stdout=self._log_file, stderr=self._log_file,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        return self

    def stop(self):
        """终止网关进程并关闭日志句柄（可重复调用）。"""
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
        """返回网关进程是否仍在运行。"""
        return self._process is not None and self._process.poll() is None

    def log_text(self):
        """读取网关标准输出日志尾部，用于失败诊断。"""
        try:
            return self.output_log.read_text(encoding="utf-8", errors="replace")
        except FileNotFoundError:
            return ""

    def _assert_running(self):
        """进程异常退出时携带日志抛出断言错误。"""
        if not self.is_running():
            raise AssertionError("前端网关进程已退出：\n%s" % self.log_text()[-4000:])

    async def wait_ready(self, timeout=READY_TIMEOUT_SEC):
        """轮询 /api/gateway/status 直至网关 HTTP 服务可访问。"""
        deadline = asyncio.get_running_loop().time() + timeout
        async with httpx.AsyncClient(
                base_url="http://127.0.0.1:%d" % self.port, timeout=2.0, trust_env=False) as client:
            while True:
                self._assert_running()
                try:
                    reply = await client.get("/api/gateway/status")
                    if reply.status_code == 200:
                        return
                except httpx.HTTPError:
                    pass
                if asyncio.get_running_loop().time() > deadline:
                    raise AssertionError("前端网关未就绪：\n%s" % self.log_text()[-4000:])
                await asyncio.sleep(0.05)


@unittest.skipUnless(NODE_BINARY and GATEWAY_MAIN.is_file(), "缺少 node 或前端网关实现 frontend/gateway/main.mjs")
class TestFrontendGateway(unittest.IsolatedAsyncioTestCase):
    """前端网关集成用例：真实 Node 网关 + 假后端 TCP/HTTP + 浏览器态 WS 客户端。"""

    async def asyncSetUp(self):
        """创建临时 dist/配置，启动假后端、共享网关并等待前端模块完成 TCP 注册。"""
        # 临时目录放在仓库根下并加 tmp_ 前缀，既满足 .gitignore 过滤，也便于配置使用相对路径
        self.temp = tempfile.TemporaryDirectory(prefix="tmp_frontend_gateway_", dir=str(REPO))
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.dist = self.root / "dist"
        (self.dist / "assets").mkdir(parents=True)
        (self.dist / "index.html").write_text(INDEX_HTML, encoding="utf-8", newline="\n")
        (self.dist / "assets" / "app.js").write_text(APP_JS, encoding="utf-8", newline="\n")

        self.backend_tcp = FakeBackendTcp()
        await self.backend_tcp.start()
        self.addAsyncCleanup(self.backend_tcp.stop)
        self.backend_http = FakeBackendHttp()
        self.backend_http.start()
        self.addCleanup(self.backend_http.stop)

        self.gateway = self.start_gateway(tcp_port=self.backend_tcp.port, http_port=self.backend_http.port)
        self.addCleanup(self.gateway.stop)
        self.client = httpx.AsyncClient(
            base_url="http://127.0.0.1:%d" % self.gateway.port, timeout=5.0, trust_env=False)
        self.addAsyncCleanup(self.client.aclose)
        await self.gateway.wait_ready()
        await self.wait_until_registered()

    def start_gateway(self, tcp_port, http_port, static_dir=None, log_name="gateway.log"):
        """按给定后端端口启动一个独立网关实例，并登记进程清理。"""
        port = free_port()
        config = build_gateway_config(
            port, tcp_port, http_port, static_dir if static_dir is not None else self.dist,
            self.root / log_name)
        config_path = self.root / ("gateway_%d.json" % port)
        config_path.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")
        gateway = GatewayProcess(config_path, self.root / ("gateway_%d.stdout.log" % port))
        gateway.start(port)
        self.addCleanup(gateway.stop)
        return gateway

    async def wait_until_registered(self, timeout=READY_TIMEOUT_SEC):
        """等待共享网关完成 TCP 连接与 frontend 模块注册。"""
        deadline = asyncio.get_running_loop().time() + timeout
        while True:
            self.gateway._assert_running()
            try:
                reply = await self.client.get("/api/gateway/status")
                data = reply.json().get("data", {})
                if reply.status_code == 200 and data.get("tcp_connected") and data.get("registered"):
                    return
            except (httpx.HTTPError, ValueError):
                pass
            if asyncio.get_running_loop().time() > deadline:
                raise AssertionError("前端网关未完成 TCP 注册：\n%s" % self.gateway.log_text()[-4000:])
            await asyncio.sleep(0.05)

    async def connect_ws(self, port):
        """建立 WebSocket 客户端连接并登记关闭清理。"""
        client = MiniWebSocket("127.0.0.1", port, "/ws", timeout=MESSAGE_TIMEOUT_SEC)
        await client.connect()
        self.addAsyncCleanup(client.close)
        return client

    async def test_gateway_status_and_config(self):
        """状态接口报告 TCP 已连接且已注册，配置接口返回端口/WS 路径与 UI 配置。"""
        reply = await self.client.get("/api/gateway/status")
        self.assertEqual(reply.status_code, 200, reply.text)
        payload = reply.json()
        self.assertEqual(payload["code"], 0)
        data = payload["data"]
        for key in ("tcp_connected", "registered", "backend_online", "clients", "last_error"):
            self.assertIn(key, data)
        self.assertTrue(data["tcp_connected"])
        self.assertTrue(data["registered"])

        gateway_config = (await self.client.get("/api/gateway/config")).json()["data"]
        self.assertEqual(gateway_config["gateway"]["port"], self.gateway.port)
        self.assertEqual(gateway_config["gateway"]["ws_path"], "/ws")
        self.assertEqual(gateway_config["backend"]["http"]["port"], self.backend_http.port)
        self.assertEqual(gateway_config["ui"], TEST_UI)

    async def test_http_proxy_passthrough(self):
        """GET /api/health、/api/robot/status、/api/tasks/{id} 透传到假后端 HTTP 服务。"""
        health = await self.client.get("/api/health")
        self.assertEqual(health.status_code, 200, health.text)
        self.assertEqual(health.json()["data"]["status"], "ok")

        status = await self.client.get("/api/robot/status")
        self.assertEqual(status.status_code, 200, status.text)
        self.assertTrue(status.json()["data"]["motion_online"])
        self.assertIsNone(status.json()["data"]["current_joint_angles"])

        task = await self.client.get("/api/tasks/plan-202")
        self.assertEqual(task.status_code, 200, task.text)
        self.assertEqual(task.json()["data"]["task_id"], "plan-202")

        missing = await self.client.get("/api/tasks/missing")
        self.assertEqual(missing.status_code, 404, missing.text)
        self.assertEqual(missing.json()["code"], 1004)

        paths = [record["path"] for record in self.backend_http.requests]
        self.assertIn("/health", paths)
        self.assertIn("/robot/status", paths)
        self.assertIn("/tasks/plan-202", paths)

    async def test_http_proxy_plan_status(self):
        """POST /api/robot/plan 透传请求体并原样返回 202/409 状态与业务码。"""
        body = {"grasp_pose": {"position": [0.8, 0.0, 0.5], "orientation": [0.0, 0.0, 0.0, 1.0]},
                "force_limit": 5.0}
        reply = await self.client.post("/api/robot/plan", json=body)
        self.assertEqual(reply.status_code, 202, reply.text)
        self.assertEqual(reply.json()["data"]["task_id"], "plan-202")
        self.assertIn("application/json", self.backend_http.requests[-1]["headers"].get("content-type", ""))
        self.assertEqual(self.backend_http.requests[-1]["method"], "POST")
        self.assertEqual(self.backend_http.requests[-1]["path"], "/robot/plan")
        self.assertEqual(json.loads(self.backend_http.requests[-1]["body"]), body)

        self.backend_http.plan_status = 409
        self.addCleanup(setattr, self.backend_http, "plan_status", 202)
        conflict = await self.client.post("/api/robot/plan", json=body)
        self.assertEqual(conflict.status_code, 409, conflict.text)
        self.assertEqual(conflict.json()["code"], 3003)

    async def test_unknown_api_route_returns_404(self):
        """未知 /api 路由返回统一 JSON 的 404/1004，而不是静态回退。"""
        reply = await self.client.get("/api/unknown/route")
        self.assertEqual(reply.status_code, 404, reply.text)
        self.assertEqual(reply.json()["code"], 1004)

    async def test_static_serving_and_spa_fallback(self):
        """静态托管 index.html 与资源文件，未知非 /api 路径回退 index.html。"""
        index = await self.client.get("/")
        self.assertEqual(index.status_code, 200, index.text)
        self.assertEqual(index.text, INDEX_HTML)
        self.assertIn("text/html", index.headers.get("Content-Type", ""))

        asset = await self.client.get("/assets/app.js")
        self.assertEqual(asset.status_code, 200, asset.text)
        self.assertEqual(asset.text, APP_JS)

        fallback = await self.client.get("/task/detail/not-found-route")
        self.assertEqual(fallback.status_code, 200, fallback.text)
        self.assertEqual(fallback.text, INDEX_HTML)

    async def test_static_missing_dist_returns_503(self):
        """dist 目录缺失时静态请求返回 503 JSON，提示先构建前端产物。"""
        gateway = self.start_gateway(tcp_port=free_port(), http_port=self.backend_http.port,
                                     static_dir=self.root / "missing_dist", log_name="gateway_no_dist.log")
        await gateway.wait_ready()
        async with httpx.AsyncClient(
                base_url="http://127.0.0.1:%d" % gateway.port, timeout=5.0, trust_env=False) as client:
            reply = await client.get("/")
        self.assertEqual(reply.status_code, 503, reply.text)
        payload = reply.json()
        self.assertNotEqual(payload["code"], 0)
        self.assertIn("msg", payload)

    async def test_backend_http_unreachable_returns_503(self):
        """后端 HTTP 不可达时代理返回 503/4000 统一错误，而不是挂起或 500。"""
        gateway = self.start_gateway(tcp_port=free_port(), http_port=free_port(),
                                     log_name="gateway_no_http.log")
        await gateway.wait_ready()
        async with httpx.AsyncClient(
                base_url="http://127.0.0.1:%d" % gateway.port, timeout=10.0, trust_env=False) as client:
            reply = await client.get("/api/health")
        self.assertEqual(reply.status_code, 503, reply.text)
        self.assertEqual(reply.json()["code"], 4000)

    async def test_ws_connection_task_start_and_ack(self):
        """WS 连接收到 connection 事件；task_start 返回 ack 且报文真实到达假后端 TCP。"""
        client = await self.connect_ws(self.gateway.port)
        connection = await client.recv_until(lambda message: message.get("type") == "connection")
        self.assertTrue(connection["data"]["tcp_connected"])
        self.assertTrue(connection["data"]["registered"])
        self.assertIn("client_id", connection["data"])

        start_index = len(self.backend_tcp.received)
        request_id = "req-ws-task-start"
        await client.send_json({"type": "task_start", "request_id": request_id,
                                "data": {"task_id": "ws_task_1", "category": "apple", "speed_level": 2}})
        ack = await client.recv_until(lambda message: message.get("type") == "ack")
        self.assertEqual(ack["request_id"], request_id)
        self.assertEqual(ack["data"]["task_id"], "ws_task_1")

        forwarded = await self.backend_tcp.wait_for_message(
            lambda message: message["msg_type"] == protocol.MsgType.TASK_START
            and message["data"].get("task_id") == "ws_task_1", start=start_index)
        self.assertEqual(forwarded["source"], protocol.ModuleId.FRONTEND)
        self.assertEqual(forwarded["target"], protocol.ModuleId.BACKEND)
        self.assertEqual(forwarded["data"]["category"], "apple")
        self.assertEqual(forwarded["data"]["speed_level"], 2)

        result = await client.recv_until(lambda message: message.get("type") == "task_result")
        self.assertEqual(result["data"]["task_id"], "ws_task_1")
        self.assertEqual(result["data"]["planning_task_id"], "planning_ws_task_1")

        await client.send_json({"type": "ping"})
        pong = await client.recv_until(lambda message: message.get("type") == "pong")
        self.assertIsInstance(pong, dict)

    async def test_ws_backend_task_result_forwarded(self):
        """假后端主动推送的 task_result 被网关按 data 原样转发给浏览器。"""
        self.backend_tcp.auto_result = False
        self.addCleanup(setattr, self.backend_tcp, "auto_result", True)
        client = await self.connect_ws(self.gateway.port)
        await client.recv_until(lambda message: message.get("type") == "connection")
        await client.send_json({"type": "task_start", "request_id": "req-backend-push",
                                "data": {"task_id": "ws_task_2", "category": "pear", "speed_level": 1}})
        await client.recv_until(lambda message: message.get("type") == "ack")

        payload = {"task_id": "ws_task_2", "sorted_count": 1, "is_finished": False, "phase": "sorting",
                   "executed": False, "planning_task_id": "planning_ws_task_2", "error": None}
        await self.backend_tcp.push(protocol.build_message(
            protocol.MsgType.TASK_RESULT, "backend", "frontend", payload))
        result = await client.recv_until(lambda message: message.get("type") == "task_result")
        self.assertEqual(result["data"], payload)

    async def test_ws_invalid_messages(self):
        """非法 JSON 返回 1001，未知 type 与空 task_id 返回 1000。"""
        client = await self.connect_ws(self.gateway.port)
        await client.recv_until(lambda message: message.get("type") == "connection")

        await client.send_text("not-a-json-packet")
        error = await client.recv_until(lambda message: message.get("type") == "error")
        self.assertEqual(error["code"], 1001)

        await client.send_json({"type": "task_start", "request_id": "bad-empty-task",
                                "data": {"task_id": "", "category": "apple", "speed_level": 1}})
        error = await client.recv_until(
            lambda message: message.get("type") == "error" and message.get("request_id") == "bad-empty-task")
        self.assertEqual(error["code"], 1000)

        await client.send_json({"type": "unknown_command", "request_id": "bad-type"})
        error = await client.recv_until(
            lambda message: message.get("type") == "error" and message.get("request_id") == "bad-type")
        self.assertEqual(error["code"], 1000)

    async def test_ws_task_start_without_tcp_connection(self):
        """TCP 未连接时 WS 下发 task_start 返回 4000，且网关保持存活。"""
        gateway = self.start_gateway(tcp_port=free_port(), http_port=self.backend_http.port,
                                     log_name="gateway_no_tcp.log")
        await gateway.wait_ready()
        client = await self.connect_ws(gateway.port)
        connection = await client.recv_until(lambda message: message.get("type") == "connection")
        self.assertFalse(connection["data"]["tcp_connected"])
        await client.send_json({"type": "task_start", "request_id": "offline-task",
                                "data": {"task_id": "offline_task", "category": "apple", "speed_level": 1}})
        error = await client.recv_until(lambda message: message.get("type") == "error")
        self.assertEqual(error["code"], 4000)
        self.assertTrue(gateway.is_running())


if __name__ == "__main__":
    unittest.main(verbosity=2)
