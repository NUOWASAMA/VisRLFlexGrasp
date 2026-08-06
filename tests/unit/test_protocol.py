# 文件功能：通信协议公共模块单元测试（报文构建、编解码、非法报文校验）
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-07-26
# 运行方式（仓库根目录执行）：python -m unittest discover tests/unit

import unittest

from common import protocol


class TestProtocol(unittest.TestCase):
    """协议模块用例集"""

    def test_build_message_fields_complete(self):
        """构建的报文必须包含全部必填字段"""
        message = protocol.build_message(
            protocol.MsgType.TASK_START, protocol.ModuleId.FRONTEND,
            protocol.ModuleId.BACKEND, {"task_id": "t001"})
        for field in protocol.REQUIRED_FIELDS:
            self.assertIn(field, message)
        self.assertEqual(message["code"], protocol.ErrorCode.SUCCESS)
        self.assertEqual(message["data"]["task_id"], "t001")

    def test_build_message_rejects_empty_type(self):
        """空 msg_type 必须抛出 ValueError"""
        with self.assertRaises(ValueError):
            protocol.build_message("", protocol.ModuleId.FRONTEND, protocol.ModuleId.BACKEND)

    def test_encode_decode_roundtrip(self):
        """编码后再解码应还原报文内容（含中文）"""
        message = protocol.build_message(
            protocol.MsgType.ERROR_REPORT, protocol.ModuleId.MOTION,
            protocol.ModuleId.BACKEND, {"detail": "紧急停止"},
            code=protocol.ErrorCode.EMERGENCY_STOP, msg="硬件异常")
        line = protocol.encode_message(message)
        self.assertTrue(line.endswith(b"\n"))
        decoded = protocol.decode_message(line)
        self.assertEqual(decoded, message)

    def test_decode_rejects_invalid_json(self):
        """非法 JSON 返回 None"""
        self.assertIsNone(protocol.decode_message(b"not a json\n"))

    def test_decode_rejects_missing_fields(self):
        """缺少必填字段返回 None"""
        self.assertIsNone(protocol.decode_message(b'{"msg_type": "heartbeat"}\n'))


if __name__ == "__main__":
    unittest.main()
