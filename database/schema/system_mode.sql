-- 文件功能：运行环境模式选择持久化（sim / real），重启后保持上次选择；数据库由后端单进程持有
CREATE TABLE IF NOT EXISTS system_mode (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    mode TEXT NOT NULL CHECK (mode IN ('sim', 'real')),
    updated_at INTEGER NOT NULL
);
