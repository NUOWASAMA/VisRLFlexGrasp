# 文件功能：SQLite 任务持久化与重启中断恢复，每次操作独立连接并通过线程执行
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-10-06
import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path


def timestamp_ms():
    """返回 UTC Unix 毫秒时间戳。"""
    return time.time_ns() // 1_000_000


class TaskRepository:
    """保存规划请求与终态，不存连接对象或实时控制锁。"""

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
        """创建父目录与单张任务表；SQL 或磁盘错误交给启动流程处理。"""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.executescript(self.schema_path.read_text(encoding="utf-8"))

    def recover_interrupted(self):
        """重启后将未结束任务标记中断，保留请求，不重新下发。"""
        error = json.dumps({"code": 3001, "msg": "后端已重启，任务中断；未重新下发"}, ensure_ascii=False)
        with self._connect() as connection:
            cursor = connection.execute(
                "UPDATE robot_tasks SET status='interrupted', error_json=?, updated_at=? WHERE status='planning'",
                (error, timestamp_ms()))
            return cursor.rowcount

    def create(self, task_id, request):
        """持久化新规划任务，重复 ID 或数据库错误抛出异常。"""
        now = timestamp_ms()
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO robot_tasks VALUES (?, 'planning', ?, NULL, NULL, ?, ?)",
                (task_id, json.dumps(request, ensure_ascii=False, allow_nan=False), now, now))

    def finish(self, task_id, status, result=None, error=None):
        """只把 planning 转到终态，避免重复或迟到报文改写历史。"""
        if status not in ("planned", "failed", "interrupted"):
            raise ValueError("非法任务终态")
        def encode(value):
            return None if value is None else json.dumps(value, ensure_ascii=False, allow_nan=False)
        with self._connect() as connection:
            cursor = connection.execute(
                "UPDATE robot_tasks SET status=?, result_json=?, error_json=?, updated_at=? "
                "WHERE task_id=? AND status='planning'",
                (status, encode(result), encode(error), timestamp_ms(), task_id))
            return cursor.rowcount == 1

    def get(self, task_id):
        """查询完整任务；不存在返回 None。"""
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM robot_tasks WHERE task_id=?", (task_id,)).fetchone()
        if row is None:
            return None
        return {"task_id": row["task_id"], "status": row["status"],
                "request": json.loads(row["request_json"]),
                "result": None if row["result_json"] is None else json.loads(row["result_json"]),
                "error": None if row["error_json"] is None else json.loads(row["error_json"]),
                "created_at": row["created_at"], "updated_at": row["updated_at"]}
