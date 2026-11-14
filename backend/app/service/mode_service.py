# 文件功能：运行环境模式服务，持久化 sim / real 选择并如实报告硬件可用性与降级状态
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-11-14
import asyncio

from common.log_util import get_logger

logger = get_logger("backend.mode")

# 真实环境硬件信息：控制柜、夹爪与相机适配器尚未接入，如实标记不可用
HARDWARE_CONTROLLER = "UR5"
HARDWARE_ADAPTER = "unavailable"
HARDWARE_REASON = "真实控制柜、夹爪与相机适配器尚未接入（M5 阶段实现）"


class EnvironmentMode:
    """运行环境模式常量，取值与数据库 CHECK 约束保持一致。"""

    SIM = "sim"
    REAL = "real"
    ALL = (SIM, REAL)


class ModeService:
    """单实例运行环境模式服务：SQLite 是唯一持久化来源，内存缓存仅供同步查询。"""

    def __init__(self, repository, default_mode=EnvironmentMode.SIM, hardware_available=False,
                 hardware_reason=HARDWARE_REASON):
        self._repository = repository
        self._default_mode = default_mode
        self._hardware_available = hardware_available
        self._hardware_reason = hardware_reason
        self._mode = default_mode
        # 只用一把锁串行化切换，读取走短连接查询，不阻塞既有规划链路
        self._switch_lock = asyncio.Lock()

    def initialize(self):
        """建表并保证存在模式记录，再缓存当前模式；由 lifespan 在工作线程调用。"""
        if self._default_mode not in EnvironmentMode.ALL:
            raise ValueError("非法默认运行环境模式")
        self._repository.initialize()
        if self._repository.get_mode() is None:
            self._repository.set_mode(self._default_mode)
        record = self._repository.load()
        if record is None:
            raise RuntimeError("运行环境模式记录初始化失败")
        self._mode = record["mode"]
        logger.info("运行环境模式初始化：%s", self._mode)

    def current_mode(self):
        """同步返回内存中的当前模式，供健康检查与机器人状态接口使用。"""
        return self._mode

    def hardware_available(self):
        """同步返回硬件可用性；真实硬件接入前恒为 False，M5 阶段再替换。"""
        return self._hardware_available

    async def get_state(self):
        """读取持久化状态并返回对外状态字典，数据库访问在工作线程执行。"""
        record = await asyncio.to_thread(self._repository.load)
        if record is None:
            updated_at = await asyncio.to_thread(self._repository.set_mode, self._default_mode)
            self._mode = self._default_mode
            return self._build_state(self._default_mode, updated_at)
        self._mode = record["mode"]
        return self._build_state(record["mode"], record["updated_at"])

    async def switch(self, mode):
        """切换并持久化模式；允许切到 real，但硬件不可用时状态如实标记 degraded。"""
        if mode not in EnvironmentMode.ALL:
            raise ValueError("非法运行环境模式：%s" % mode)
        async with self._switch_lock:
            updated_at = await asyncio.to_thread(self._repository.set_mode, mode)
            self._mode = mode
            logger.info("运行环境模式切换：%s（硬件可用：%s）", mode, self._hardware_available)
            return self._build_state(mode, updated_at)

    def _build_state(self, mode, updated_at):
        """组装对外状态；degraded 只表示真实环境硬件不可用，不改变 plan_only 规划逻辑。"""
        return {
            "mode": mode,
            "available_modes": list(EnvironmentMode.ALL),
            "hardware": {
                "available": self._hardware_available,
                "controller": HARDWARE_CONTROLLER,
                "controller_connected": False,
                "adapter": HARDWARE_ADAPTER,
                "reason": self._hardware_reason,
            },
            "degraded": mode == EnvironmentMode.REAL and not self._hardware_available,
            "updated_at": updated_at,
        }
