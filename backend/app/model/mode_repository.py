# 文件功能：运行环境模式（sim / real）的 SQLite 持久化，短连接读写并由后端单进程持有数据库
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-11-14
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from backend.app.model.task_repository import timestamp_ms

# 单行记录的固定主键，与 system_mode.sql 的 CHECK (id = 1) 约束一致
SINGLE_ROW_ID = 1

# 合法运行环境模式，与数据库 CHECK 约束及 ModeSwitchRequest 保持一致
VALID_MODES = ("sim", "real")


class ModeRepository:
    """保存运行环境模式选择，不持有连接对象，也不记录硬件实时状态。"""

    def __init__(self, database_path: Path, schema_path: Path):
        self.path = database_path
        self.schema_path = schema_path

    @contextmanager
    def _connect(self):
        connection = sqlite3.connect(str(self.path), timeout=1.0)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def initialize(self):
        """创建父目录与单行模式表；SQL 或磁盘错误交给启动流程处理。"""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.executescript(self.schema_path.read_text(encoding="utf-8"))

    def load(self):
        """查询模式记录；无记录返回 None，供服务层组装完整状态。"""
        with self._connect() as connection:
            row = connection.execute(
                "SELECT mode, updated_at FROM system_mode WHERE id = ?", (SINGLE_ROW_ID,)).fetchone()
        if row is None:
            return None
        return {"mode": row["mode"], "updated_at": row["updated_at"]}

    def get_mode(self):
        """查询当前模式；无记录返回 None。"""
        record = self.load()
        return None if record is None else record["mode"]

    def set_mode(self, mode: str):
        """按 id=1 UPSERT 模式并返回本次更新时间戳；非法模式抛 ValueError。"""
        if mode not in VALID_MODES:
            raise ValueError("非法运行环境模式")
        updated_at = timestamp_ms()
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO system_mode (id, mode, updated_at) VALUES (?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at",
                (SINGLE_ROW_ID, mode, updated_at))
        return updated_at
