# 文件功能：编译后的 C++ 服务与真实 Python TCP 后端联调，覆盖分帧、心跳、坏包和重连
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-10-06
import asyncio
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
from backend.app.service.dispatch_service import DispatchService, TaskState
from backend.comm.tcp_server import TcpDispatchServer
from common import protocol
from embedded.tools.export_ur5_model import multiply


def find_binary():
    setting = os.environ.get('VISRL_MOTION_BINARY')
    if setting:
        return Path(setting)
    for candidate in ('embedded/build/native/motion_control.exe', 'embedded/build/Release/motion_control.exe',
                      'embedded/build/motion_control', 'embedded/build/motion_control.exe'):
        path = REPO / candidate
        if path.is_file():
            return path
    return None


def quaternion(matrix):
    # 选择最大对角分支，避免接近 180 度时 trace 公式退化。
    trace = sum(matrix[idx][idx] for idx in range(3))
    if trace > 0:
        scale = math.sqrt(trace + 1.0) * 2
        return [(matrix[2][1] - matrix[1][2]) / scale, (matrix[0][2] - matrix[2][0]) / scale,
                (matrix[1][0] - matrix[0][1]) / scale, scale / 4]
    idx = max(range(3), key=lambda col: matrix[col][col])
    second, third = (idx + 1) % 3, (idx + 2) % 3
    scale = math.sqrt(1.0 + matrix[idx][idx] - matrix[second][second] - matrix[third][third]) * 2
    result = [0.0] * 4
    result[idx] = scale / 4
    result[second] = (matrix[second][idx] + matrix[idx][second]) / scale
    result[third] = (matrix[third][idx] + matrix[idx][third]) / scale
    result[3] = (matrix[third][second] - matrix[second][third]) / scale
    return result


@unittest.skipUnless(find_binary(), '先构建 motion_control 或设置 VISRL_MOTION_BINARY')
class TestMotionService(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='visrl_motion_')
        self.addCleanup(self.temp.cleanup)
        self.events = asyncio.Queue()
        self.dispatch = DispatchService()

        def observe(message):
            self.events.put_nowait(message)
            return self.dispatch.on_message(message)

        self.server = TcpDispatchServer('127.0.0.1', 0, observe)
        self.dispatch.bind_server(self.server)
        self.server_task = asyncio.create_task(self.server.start())
        await self.wait_until(lambda: self.server._server is not None)
        port = self.server._server.sockets[0].getsockname()[1]
        root = json.loads((REPO / 'embedded/config/base.json').read_text(encoding='utf-8'))
        root['server']['port'] = port
        # 配置和模型一起放到临时目录，兼容 Windows 源码与 TEMP 位于不同盘符。
        root['model_file'] = 'ur5_model.json'
        model_text = (REPO / 'embedded/config/ur5_model.json').read_text(encoding='utf-8')
        (Path(self.temp.name) / root['model_file']).write_text(model_text, encoding='utf-8')
        path = Path(self.temp.name) / 'service.json'
        path.write_text(json.dumps(root), encoding='utf-8')
        self.config = root
        self.model = json.loads(model_text)
        scene = REPO / self.model['provenance']['scene']
        self.assertEqual(hashlib.sha256(scene.read_bytes()).hexdigest(), self.model['provenance']['sha256'])
        self.log = (Path(self.temp.name) / 'process.log').open('w+b')
        self.addCleanup(self.log.close)
        self.process = subprocess.Popen([str(find_binary()), '--config', str(path)], cwd=REPO,
            stdout=self.log, stderr=self.log,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        self.addCleanup(self.stop_process)
        await self.wait_until(lambda: self.server.is_online('motion'))
        # 注册 ACK 和后续 TCP 数据有序；留出调度一个事件循环的机会。
        await asyncio.sleep(0.05)

    def stop_process(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)

    async def asyncTearDown(self):
        if hasattr(self, 'process'):
            self.stop_process()
        for session in list(self.server._sessions.values()):
            session.writer.close()
            await session.writer.wait_closed()
        if self.server._server:
            self.server._server.close()
            await self.server._server.wait_closed()
        self.server_task.cancel()
        await asyncio.gather(self.server_task, return_exceptions=True)

    async def wait_until(self, condition, timeout=8):
        deadline = asyncio.get_running_loop().time() + timeout
        while not condition():
            if hasattr(self, 'process') and self.process.poll() is not None:
                self.log.seek(0)
                self.fail('C++ 服务退出：' + self.log.read().decode('utf-8', errors='replace'))
            if asyncio.get_running_loop().time() > deadline:
                self.fail('等待服务状态超时')
            await asyncio.sleep(0.02)

    def command(self, task_id='cpp_plan'):
        fixture = json.loads((REPO / 'tests/fixtures/ur5_scene_poses.json').read_text(encoding='utf-8'))
        flange = fixture['cases'][1]['base_from_flange']
        tcp = multiply(multiply(self.model['world_from_base'], flange), self.model['flange_from_tcp'])
        return protocol.build_message(protocol.MsgType.GRASP_COMMAND, 'backend', 'motion', {
            'task_id': task_id, 'grasp_pose': {'position': [tcp[idx][3] for idx in range(3)],
                                             'orientation': quaternion(tcp)}, 'force_limit': 5.0})

    async def receive(self):
        return await asyncio.wait_for(self.events.get(), 5)

    async def test_planning_fragmented_and_coalesced_frames(self):
        self.dispatch._tasks['fragmented'] = TaskState('fragmented', '')
        command = self.command('fragmented')
        payload = protocol.encode_message(command)
        writer = self.server._sessions['motion'].writer
        writer.write(payload[:17])
        await writer.drain()
        await asyncio.sleep(0.02)
        writer.write(payload[17:] + protocol.encode_message(self.command('coalesced')))
        await writer.drain()
        first, second = await self.receive(), await self.receive()
        self.assertEqual({first['data']['task_id'], second['data']['task_id']}, {'fragmented', 'coalesced'})
        for message in (first, second):
            self.assertEqual(message['code'], 0)
            self.assertEqual(message['data']['phase'], 'planned')
            self.assertFalse(message['data']['executed'])
            self.assertGreater(message['timestamp'], 0)
            points = message['data']['joint_trajectory']
            self.assertEqual(len(points), self.config['trajectory']['sample_count'])
            self.assertEqual(points[0], [0.0] * 6)
            self.assertEqual(points[-1], message['data']['joint_target'])
        self.assertEqual(self.dispatch._tasks['fragmented'].sorted_count, 0)
        self.assertFalse(self.dispatch._tasks['fragmented'].is_finished)

    async def test_bad_messages_recover_and_acks_do_not_echo(self):
        writer = self.server._sessions['motion'].writer
        writer.write(b'{bad json}\n')
        await writer.drain()
        self.assertEqual((await self.receive())['code'], 1001)
        bad = copy.deepcopy(self.command())
        bad['data']['grasp_pose']['orientation'] = [0, 0, 0, 0]
        await self.server.send_to('motion', bad)
        self.assertEqual((await self.receive())['code'], 1000)
        far = self.command()
        far['data']['grasp_pose']['position'][0] = 100
        await self.server.send_to('motion', far)
        self.assertEqual((await self.receive())['code'], 3001)
        await self.server.send_to('motion', self.command('recovered'))
        self.assertEqual((await self.receive())['code'], 0)
        previous = self.server._sessions['motion'].last_heartbeat
        await self.wait_until(lambda: self.server._sessions['motion'].last_heartbeat > previous, timeout=5)
        await asyncio.sleep(0.05)
        self.assertTrue(self.events.empty(), 'ACK 被误当抓取指令并回发')

    async def test_disconnect_reconnect(self):
        original = self.server._sessions['motion']
        original.writer.close()
        await original.writer.wait_closed()
        await self.wait_until(lambda: self.server._sessions.get('motion') not in (None, original))
        await self.server.send_to('motion', self.command('after_reconnect'))
        result = await self.receive()
        self.assertEqual(result['code'], 0)
        self.assertEqual(result['data']['task_id'], 'after_reconnect')


if __name__ == '__main__':
    unittest.main(verbosity=2)
