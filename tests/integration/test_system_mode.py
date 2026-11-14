# 文件功能：运行环境模式 HTTP 接口与 SQLite 持久化验收（默认仿真、真实环境降级、非法输入、重启保持）
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-11-14
# 运行方式（仓库根目录执行）：
#   ./.venv/Scripts/python.exe -m unittest tests.integration.test_system_mode -v
from pathlib import Path
import tempfile
import unittest

import httpx

from backend.app.api.application import create_app
from backend.config.settings import REPO_ROOT
from common.config_loader import load_config

# 硬件不可用时真实环境的降级原因关键字，与 ModeService 常量保持一致
HARDWARE_REASON_KEYWORD = "M5 阶段实现"

# 对外状态字段清单，防止接口字段被未告知改名
STATE_FIELDS = {"mode", "available_modes", "hardware", "degraded", "updated_at"}
HARDWARE_FIELDS = {"available", "controller", "controller_connected", "adapter", "reason"}


class TestSystemMode(unittest.IsolatedAsyncioTestCase):
    """运行环境模式接口验收：默认仿真、真实环境降级、非法输入、重启持久化。"""

    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="visrl_mode_")
        self.addCleanup(self.temp.cleanup)
        self.config = load_config(str(REPO_ROOT / "backend/config"), "sim")
        self.config["database"]["path"] = str(Path(self.temp.name) / "tasks.db")
        self.config["log_file"] = str(Path(self.temp.name) / "backend.log")
        self.config["server"]["port"] = 0
        self.config["api"]["port"] = 0
        self.lifespans = []
        self.clients = []
        self.addAsyncCleanup(self.cleanup)
        await self.start_app()

    async def start_app(self):
        """启动一个使用当前配置的网关实例并进入 lifespan（端口 0 由系统分配）。"""
        self.app = create_app(self.config)
        lifespan = self.app.router.lifespan_context(self.app)
        await lifespan.__aenter__()
        self.lifespans.append(lifespan)
        client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://gateway")
        self.clients.append(client)
        self.client = client

    async def stop_app(self):
        """关闭客户端并退出 lifespan，模拟一次后端进程重启。"""
        await self.clients.pop().aclose()
        await self.lifespans.pop().__aexit__(None, None, None)

    async def cleanup(self):
        """兜底清理未关闭的客户端与 lifespan，避免临时目录被占用。"""
        for client in self.clients:
            await client.aclose()
        for lifespan in reversed(self.lifespans):
            await lifespan.__aexit__(None, None, None)

    async def get_state(self):
        """查询模式状态并返回 data，同时校验统一响应结构。"""
        reply = await self.client.get("/system/mode")
        self.assertEqual(reply.status_code, 200, reply.text)
        payload = reply.json()
        self.assertEqual(payload["code"], 0)
        self.assertIsInstance(payload["timestamp"], int)
        return payload["data"]

    async def switch(self, mode):
        """提交模式切换并返回原始 HTTP 响应。"""
        return await self.client.post("/system/mode", json={"mode": mode})

    async def test_default_mode_is_sim(self):
        """默认状态为仿真：无降级、硬件如实报告不可用、模式列表齐全。"""
        data = await self.get_state()
        self.assertEqual(set(data), STATE_FIELDS)
        self.assertEqual(data["mode"], "sim")
        self.assertEqual(data["available_modes"], ["sim", "real"])
        self.assertFalse(data["degraded"])
        self.assertIsInstance(data["updated_at"], int)
        hardware = data["hardware"]
        self.assertEqual(set(hardware), HARDWARE_FIELDS)
        self.assertFalse(hardware["available"])
        self.assertEqual(hardware["controller"], "UR5")
        self.assertFalse(hardware["controller_connected"])
        self.assertEqual(hardware["adapter"], "unavailable")
        self.assertIn(HARDWARE_REASON_KEYWORD, hardware["reason"])

    async def test_switch_to_real_marks_degraded(self):
        """切到真实环境返回 200，允许预览但 hardware.available=false 且 degraded=true。"""
        reply = await self.switch("real")
        self.assertEqual(reply.status_code, 200, reply.text)
        data = reply.json()["data"]
        self.assertEqual(data["mode"], "real")
        self.assertTrue(data["degraded"])
        self.assertFalse(data["hardware"]["available"])
        self.assertIsInstance(data["updated_at"], int)
        self.assertEqual((await self.get_state())["mode"], "real")

    async def test_invalid_mode_and_extra_fields_rejected(self):
        """非法 mode、字符串伪装、数组与多余字段均由统一校验返回 422/1000。"""
        invalid_bodies = [
            {"mode": "hardware"},
            {"mode": "REAL"},
            {"mode": "sim "},
            {"mode": 1},
            {"mode": ["real"]},
            {"mode": "real", "execute": True},
            {},
        ]
        for body in invalid_bodies:
            with self.subTest(body=body):
                reply = await self.client.post("/system/mode", json=body)
                self.assertEqual(reply.status_code, 422, reply.text)
                payload = reply.json()
                self.assertEqual(payload["code"], 1000)
                self.assertIn("errors", payload["data"])
        self.assertEqual((await self.get_state())["mode"], "sim")

    async def test_health_and_robot_status_expose_mode(self):
        """既有 health 与 robot/status 增加模式字段且保留原有字段；切换后同步变化。"""
        health = (await self.client.get("/health")).json()["data"]
        self.assertEqual(health["status"], "ok")
        self.assertEqual(health["execution_mode"], "plan_only")
        self.assertEqual(health["mode"], "sim")

        status = (await self.client.get("/robot/status")).json()["data"]
        self.assertEqual(status["mode"], "sim")
        self.assertFalse(status["hardware_available"])
        self.assertEqual(status["execution_mode"], "plan_only")
        self.assertIn("motion_online", status)
        self.assertFalse(status["controller_connected"])

        await self.switch("real")
        self.assertEqual((await self.client.get("/health")).json()["data"]["mode"], "real")
        real_status = (await self.client.get("/robot/status")).json()["data"]
        self.assertEqual(real_status["mode"], "real")
        self.assertFalse(real_status["hardware_available"])

    async def test_restart_keeps_real_mode(self):
        """退出 lifespan 后用同一临时数据库重建应用，real 选择仍然保持。"""
        await self.switch("real")
        await self.stop_app()
        await self.start_app()
        data = await self.get_state()
        self.assertEqual(data["mode"], "real")
        self.assertTrue(data["degraded"])
        self.assertFalse(data["hardware"]["available"])

    async def test_switch_back_to_sim_clears_degraded(self):
        """切回仿真后 degraded=false，并再次读取确认已持久化。"""
        await self.switch("real")
        reply = await self.switch("sim")
        self.assertEqual(reply.status_code, 200, reply.text)
        data = reply.json()["data"]
        self.assertEqual(data["mode"], "sim")
        self.assertFalse(data["degraded"])
        self.assertEqual((await self.get_state())["mode"], "sim")


if __name__ == "__main__":
    unittest.main(verbosity=2)
