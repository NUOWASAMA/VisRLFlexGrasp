# 文件功能：分级配置加载器单元测试（base 与环境配置深度合并、非法环境校验）
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-07-26

import json
import os
import tempfile
import unittest

from common import config_loader


class TestConfigLoader(unittest.TestCase):
    """配置加载器用例集"""

    def setUp(self):
        self._tmp_dir = tempfile.mkdtemp(prefix="tmp_visrl_config_")
        self._write("base.json", {
            "server": {"host": "127.0.0.1", "port": 9000},
            "enable_hardware": False,
        })
        self._write("real.json", {"enable_hardware": True, "server": {"port": 9100}})

    def _write(self, name, content):
        with open(os.path.join(self._tmp_dir, name), "w", encoding="utf-8") as f:
            json.dump(content, f)

    def test_load_base_only(self):
        """无环境覆盖文件时返回 base 配置"""
        config = config_loader.load_config(self._tmp_dir, "sim")
        self.assertFalse(config["enable_hardware"])
        self.assertEqual(config["env"], "sim")

    def test_env_deep_merge(self):
        """环境配置深度合并覆盖 base，未覆盖键保留"""
        config = config_loader.load_config(self._tmp_dir, "real")
        self.assertTrue(config["enable_hardware"])
        self.assertEqual(config["server"]["port"], 9100)
        self.assertEqual(config["server"]["host"], "127.0.0.1")

    def test_invalid_env_rejected(self):
        """非法环境标识必须抛出 ValueError"""
        with self.assertRaises(ValueError):
            config_loader.load_config(self._tmp_dir, "prod")

    def test_missing_base_rejected(self):
        """base.json 缺失必须抛出 FileNotFoundError"""
        empty_dir = tempfile.mkdtemp(prefix="tmp_visrl_empty_")
        with self.assertRaises(FileNotFoundError):
            config_loader.load_config(empty_dir, "sim")


if __name__ == "__main__":
    unittest.main()
