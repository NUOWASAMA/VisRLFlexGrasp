-- 文件功能：第一阶段规划任务记录；数据库由后端单进程持有
CREATE TABLE IF NOT EXISTS robot_tasks (
    task_id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('planning', 'planned', 'failed', 'interrupted')),
    request_json TEXT NOT NULL,
    result_json TEXT,
    error_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
