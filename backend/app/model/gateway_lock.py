# 文件功能：独占网关数据库，防止第二个后端进程恢复或操作正在运行的任务
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-10-06
import os
from pathlib import Path


class GatewayLock:
    """跨进程文件锁；进程退出时操作系统释放，不用删除锁文件。"""

    def __init__(self, database_path: Path):
        self.path = Path(str(database_path) + ".lock")
        self._stream = None

    def acquire(self):
        """非阻塞取得唯一实例锁，已占用时抛出 RuntimeError。"""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        stream = self.path.open("a+b")
        if stream.seek(0, os.SEEK_END) == 0:
            stream.write(b"0")
            stream.flush()
        stream.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            stream.close()
            raise RuntimeError("该数据库已有网关实例运行，请使用单进程启动") from error
        self._stream = stream

    def release(self):
        """关闭持有锁的文件，允许后续实例启动。"""
        if self._stream is not None:
            self._stream.close()
            self._stream = None
