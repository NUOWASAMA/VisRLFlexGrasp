# 文件功能：HTTP 网关、真实内部 TCP 连接与 SQLite 的第一阶段验收
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-10-06
import asyncio
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

import httpx

from backend.app.api.application import create_app
from backend.config.settings import REPO_ROOT
from backend.app.schema.robot_request import PlanRequest
from common import protocol
from common.config_loader import load_config
from embedded.tools.export_ur5_model import multiply
from test_motion_service import find_binary, quaternion


class TestBackendGateway(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="visrl_gateway_")
        self.addCleanup(self.temp.cleanup)
        self.config = load_config(str(REPO_ROOT / "backend/config"), "sim")
        self.config["database"]["path"] = str(Path(self.temp.name) / "tasks.db")
        self.config["log_file"] = str(Path(self.temp.name) / "backend.log")
        self.config["server"]["port"] = 0
        self.config["api"]["port"] = 0
        self.config["gateway"]["plan_timeout_sec"] = 0.4
        self.writers = []
        self.lifespans = []
        self.clients = []
        self.addAsyncCleanup(self.cleanup)
        await self.start_app()

    async def start_app(self):
        self.app = create_app(copy.deepcopy(self.config))
        self.lifespan = self.app.router.lifespan_context(self.app)
        await self.lifespan.__aenter__()
        self.lifespans.append(self.lifespan)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://gateway")
        self.clients.append(self.client)
        self.port = self.app.state.tcp_server._server.sockets[0].getsockname()[1]

    async def cleanup(self):
        for client in self.clients:
            await client.aclose()
        for lifespan in reversed(self.lifespans):
            await lifespan.__aexit__(None, None, None)
        for writer in self.writers:
            writer.close()
            await writer.wait_closed()

    async def connect(self, module="motion"):
        reader, writer = await asyncio.open_connection("127.0.0.1", self.port)
        self.writers.append(writer)
        await self.send(writer, protocol.build_message("register", module, "backend", {"module": module}))
        reply = await self.read(reader)
        return reader, writer, reply

    async def read(self, reader):
        raw = await asyncio.wait_for(reader.readline(), 3)
        self.assertTrue(raw, "内部 TCP 意外断开")
        return json.loads(raw)

    async def send(self, writer, message):
        writer.write(protocol.encode_message(message))
        await writer.drain()

    def request(self):
        return {"grasp_pose": {"position": [0.8, 0.0, 0.5], "orientation": [0.0, 0.0, 0.0, 1.0]},
                "force_limit": 5.0}

    async def submit(self):
        reply = await self.client.post("/robot/plan", json=self.request())
        self.assertEqual(reply.status_code, 202, reply.text)
        return reply.json()["data"]["task_id"]

    def planned(self, command):
        task_id = command["data"]["task_id"]
        start = command["data"].get("current_joint_angles", [0.0] * 6)
        target = [0.1] * 6
        return protocol.build_message("motion_status", "motion", "backend", {
            "task_id": task_id, "phase": "planned", "is_success": True, "executed": False,
            "execution_mode": "plan_only", "reference_source": "config",
            "joint_target": target, "joint_trajectory": [start, target], "duration_sec": 1.0,
            "sample_period_sec": 1.0, "solution_count": 1, "force_limit": command["data"]["force_limit"]})

    async def terminal(self, task_id):
        for _ in range(150):
            reply = await self.client.get("/tasks/" + task_id)
            self.assertEqual(reply.status_code, 200)
            record = reply.json()["data"]
            if record["status"] != "planning" and not self.app.state.robot.status()["busy"]:
                return record
            await asyncio.sleep(0.02)
        self.fail("任务没有收尾")

    async def test_offline_status_and_unknown_task(self):
        self.assertEqual((await self.client.get("/health")).json()["data"]["status"], "ok")
        status = (await self.client.get("/robot/status")).json()["data"]
        self.assertFalse(status["motion_online"])
        self.assertFalse(status["controller_connected"])
        self.assertIsNone(status["current_joint_angles"])
        self.assertEqual((await self.client.post("/robot/plan", json=self.request())).status_code, 503)
        self.assertEqual((await self.client.get("/tasks/missing")).status_code, 404)

    async def test_invalid_inputs_rejected(self):
        await self.connect()
        changes = [({"grasp_pose": {"position": [0, 0], "orientation": [0, 0, 0, 1]}}),
                   {"grasp_pose": {"position": [0, 0, 1], "orientation": [0, 0, 0, 0]}},
                   {"current_joint_angles": [100.0] * 6}, {"current_joint_angles": [0.0] * 5},
                   {"force_limit": 0.0}, {"force_limit": 100.0}, {"force_limit": True},
                   {"force_limit": "5"}, {"execute": True}]
        for change in changes:
            with self.subTest(change=change):
                reply = await self.client.post("/robot/plan", json={**self.request(), **change})
                self.assertEqual(reply.status_code, 422, reply.text)
                self.assertFalse(self.app.state.robot.status()["busy"])
        raw = json.dumps({**self.request(), "force_limit": float("nan")})
        reply = await self.client.post("/robot/plan", content=raw, headers={"Content-Type": "application/json"})
        self.assertEqual(reply.status_code, 422)

    async def test_success_and_single_task_gate(self):
        reader, writer, ack = await self.connect()
        self.assertEqual(ack["code"], 0)
        task_id = await self.submit()
        command = await self.read(reader)
        self.assertEqual(command["data"]["task_id"], task_id)
        responses = await asyncio.gather(*(self.client.post("/robot/plan", json=self.request()) for _ in range(3)))
        self.assertEqual([reply.status_code for reply in responses], [409] * 3)
        await self.send(writer, self.planned(command))
        record = await self.terminal(task_id)
        self.assertEqual(record["status"], "planned")
        self.assertFalse(record["result"]["executed"])
        self.assertEqual(record["request"]["force_limit"], 5.0)
        self.assertIn(task_id, Path(self.config["log_file"]).read_text(encoding="utf-8"))
        self.assertIsNone((await self.client.get("/robot/status")).json()["data"]["current_joint_angles"])

    async def test_request_reference_and_quaternion_normalization(self):
        reader, writer, _ = await self.connect()
        body = self.request()
        body["current_joint_angles"] = [0.2] * 6
        body["grasp_pose"]["orientation"] = [0.0, 0.0, 0.0, 2.0]
        submitted = await self.client.post("/robot/plan", json=body)
        self.assertEqual(submitted.status_code, 202)
        command = await self.read(reader)
        self.assertEqual(command["data"]["grasp_pose"]["orientation"], [0.0, 0.0, 0.0, 1.0])
        reply = self.planned(command)
        reply["data"]["reference_source"] = "request"
        await self.send(writer, reply)
        record = await self.terminal(submitted.json()["data"]["task_id"])
        self.assertEqual(record["status"], "planned")
        self.assertEqual(record["result"]["joint_trajectory"][0], [0.2] * 6)

    async def test_shutdown_before_worker_gets_first_schedule(self):
        reader, _, _ = await self.connect()
        robot = self.app.state.robot
        task_id = await robot.submit(PlanRequest.model_validate(self.request()))
        await robot.close()
        self.assertFalse(robot.status()["busy"])
        record = (await self.client.get("/tasks/" + task_id)).json()["data"]
        self.assertEqual(record["status"], "interrupted")
        with self.assertRaises(asyncio.TimeoutError):
            await asyncio.wait_for(reader.readline(), 0.1)

    async def test_real_mode_rejected(self):
        config = copy.deepcopy(self.config)
        config["enable_hardware"] = True
        with self.assertRaisesRegex(ValueError, "控制柜"):
            create_app(config)

    async def test_timeout_and_late_reply_do_not_affect_next_task(self):
        reader, writer, _ = await self.connect()
        first = await self.submit()
        old_command = await self.read(reader)
        failed = await self.terminal(first)
        self.assertEqual(failed["error"]["code"], 1002)
        second = await self.submit()
        new_command = await self.read(reader)
        await self.send(writer, self.planned(old_command))
        await asyncio.sleep(0.04)
        self.assertEqual((await self.client.get("/tasks/" + second)).json()["data"]["status"], "planning")
        await self.send(writer, self.planned(new_command))
        self.assertEqual((await self.terminal(second))["status"], "planned")
        self.assertEqual((await self.client.get("/tasks/" + first)).json()["data"]["status"], "failed")

    async def test_disconnect_fails_and_reconnect_accepts_new_task(self):
        reader, writer, _ = await self.connect()
        first = await self.submit()
        await self.read(reader)
        writer.close()
        await writer.wait_closed()
        failed = await self.terminal(first)
        self.assertEqual(failed["error"]["code"], 4000)
        reader, writer, _ = await self.connect()
        second = await self.submit()
        await self.send(writer, self.planned(await self.read(reader)))
        self.assertEqual((await self.terminal(second))["status"], "planned")

    async def test_motion_error_and_unexpected_executed_result(self):
        reader, writer, _ = await self.connect()
        task_id = await self.submit()
        await self.read(reader)
        await self.send(writer, protocol.build_message("error_report", "motion", "backend", {"task_id": task_id},
                                                       code=3001, msg="目标不可达"))
        self.assertEqual((await self.terminal(task_id))["error"]["msg"], "目标不可达")
        second = await self.submit()
        reply = self.planned(await self.read(reader))
        reply["data"]["phase"] = "placed"
        reply["data"]["executed"] = True
        await self.send(writer, reply)
        self.assertEqual((await self.terminal(second))["status"], "failed")

    async def test_identity_bypass_and_duplicate_registration(self):
        reader, _, _ = await self.connect()
        _, _, duplicate = await self.connect()
        self.assertEqual(duplicate["code"], 3003)
        front_reader, front_writer, _ = await self.connect("frontend")
        await self.send(front_writer, protocol.build_message("grasp_command", "frontend", "motion", self.request()))
        self.assertEqual((await self.read(front_reader))["code"], 1000)
        fake = protocol.build_message("motion_status", "motion", "backend", {})
        await self.send(front_writer, fake)
        self.assertEqual((await self.read(front_reader))["code"], 1001)
        task_id = await self.submit()
        self.assertEqual((await self.read(reader))["data"]["task_id"], task_id)

    async def test_restart_preserves_history_and_interrupts_incomplete_task(self):
        reader, writer, _ = await self.connect()
        completed = await self.submit()
        await self.send(writer, self.planned(await self.read(reader)))
        await self.terminal(completed)
        pending = await self.submit()
        await self.read(reader)
        await self.lifespan.__aexit__(None, None, None)
        self.lifespans.remove(self.lifespan)
        # 模拟进程崩溃留下的 planning 记录，而非依赖正常关闭路径。
        orphan = "crash_orphan"
        self.app.state.repository.create(orphan, self.request())
        await self.start_app()
        self.assertEqual((await self.client.get("/tasks/" + completed)).json()["data"]["status"], "planned")
        for task_id in (pending, orphan):
            self.assertEqual((await self.client.get("/tasks/" + task_id)).json()["data"]["status"], "interrupted")
        reader, _, _ = await self.connect()
        with self.assertRaises(asyncio.TimeoutError):
            await asyncio.wait_for(reader.readline(), 0.1)

    async def test_second_gateway_cannot_recover_active_database(self):
        reader, _, _ = await self.connect()
        task_id = await self.submit()
        await self.read(reader)
        other = create_app(copy.deepcopy(self.config))
        with self.assertRaisesRegex(RuntimeError, "已有网关"):
            async with other.router.lifespan_context(other):
                pass
        self.assertEqual((await self.client.get("/tasks/" + task_id)).json()["data"]["status"], "planning")

    async def test_algorithm_uses_same_gateway_and_returns_plan_result(self):
        motion_reader, motion_writer, _ = await self.connect()
        algorithm_reader, algorithm_writer, _ = await self.connect("algorithm")
        frontend_reader, frontend_writer, _ = await self.connect("frontend")
        await self.send(frontend_writer, protocol.build_message("task_start", "frontend", "backend",
                                                               {"task_id": "algorithm_plan"}))
        self.assertEqual((await self.read(algorithm_reader))["msg_type"], "capture_cmd")
        await self.send(algorithm_writer, protocol.build_message("detection_result", "algorithm", "backend",
            {"task_id": "algorithm_plan", "objects": [self.request()]}))
        command = await self.read(motion_reader)
        self.assertEqual((await self.client.post("/robot/plan", json=self.request())).status_code, 409)
        await self.send(motion_writer, self.planned(command))
        result = await self.read(frontend_reader)
        self.assertEqual(result["data"]["phase"], "planned")
        self.assertEqual(result["data"]["sorted_count"], 0)
        self.assertFalse(result["data"]["executed"])
        record = await self.terminal(result["data"]["planning_task_id"])
        self.assertEqual(record["status"], "planned")

    @unittest.skipUnless(find_binary(), "需已编译的 motion_control")
    async def test_http_to_actual_cpp_planner(self):
        self.app.state.robot.settings.plan_timeout = 5.0
        motion = json.loads((REPO_ROOT / "embedded/config/base.json").read_text(encoding="utf-8"))
        motion["server"]["port"] = self.port
        motion["model_file"] = "ur5_model.json"
        model_text = (REPO_ROOT / "embedded/config/ur5_model.json").read_text(encoding="utf-8")
        directory = Path(self.temp.name)
        (directory / "ur5_model.json").write_text(model_text, encoding="utf-8")
        config = directory / "motion.json"
        config.write_text(json.dumps(motion), encoding="utf-8")
        log = (directory / "motion.log").open("w+b")
        self.addCleanup(log.close)
        process = subprocess.Popen([str(find_binary()), "--config", str(config)], cwd=REPO_ROOT,
            stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)

        def stop_process():
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)

        self.addCleanup(stop_process)
        for _ in range(150):
            if self.app.state.robot.status()["motion_online"]:
                break
            self.assertIsNone(process.poll(), "C++ 服务启动失败")
            await asyncio.sleep(0.02)
        model = json.loads(model_text)
        fixtures = json.loads((REPO_ROOT / "tests/fixtures/ur5_scene_poses.json").read_text(encoding="utf-8"))
        tcp = multiply(multiply(model["world_from_base"], fixtures["cases"][1]["base_from_flange"]),
                       model["flange_from_tcp"])
        payload = {"grasp_pose": {"position": [tcp[idx][3] for idx in range(3)], "orientation": quaternion(tcp)},
                   "force_limit": 5.0}
        reply = await self.client.post("/robot/plan", json=payload)
        self.assertEqual(reply.status_code, 202, reply.text)
        task_id = reply.json()["data"]["task_id"]
        record = await self.terminal(task_id)
        self.assertEqual(record["status"], "planned", record)
        self.assertEqual(len(record["result"]["joint_trajectory"]), 101)
        self.assertFalse(record["result"]["executed"])
        payload["grasp_pose"]["position"][0] = 100.0
        reply = await self.client.post("/robot/plan", json=payload)
        failed = await self.terminal(reply.json()["data"]["task_id"])
        self.assertEqual(failed["status"], "failed")
        self.assertEqual(failed["error"]["code"], 3001)
