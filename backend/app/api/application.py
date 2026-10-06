# 文件功能：第一阶段 HTTP 网关，生命周期内持有唯一规划服务与内部 TCP 服务
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-10-06
import asyncio
import logging
from contextlib import AsyncExitStack, asynccontextmanager
from logging.handlers import RotatingFileHandler

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from backend.app.model.gateway_lock import GatewayLock
from backend.app.model.task_repository import TaskRepository, timestamp_ms
from backend.app.schema.robot_request import PlanRequest
from backend.app.service.dispatch_service import DispatchService
from backend.app.service.robot_service import GatewayError, RobotService
from backend.comm.kinematics_adapter import KinematicsAdapter
from backend.comm.tcp_server import TcpDispatchServer
from backend.config.settings import GatewaySettings, REPO_ROOT
from common import protocol
from common.config_loader import load_config
from common.log_util import DATE_FORMAT, LOG_FORMAT, get_logger

logger = get_logger("backend.api")


def response(data=None, code=0, message="success"):
    """HTTP 统一报文，不向调用方暴露内部 Socket 细节。"""
    return {"code": code, "msg": message, "data": {} if data is None else data, "timestamp": timestamp_ms()}


def configure_logs(path, level):
    """四个后端模块共用轮转日志；返回清理函数以关闭文件并恢复原日志级别。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(path, maxBytes=1_048_576, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter(LOG_FORMAT, DATE_FORMAT))
    names = ("backend.api", "backend.robot", "backend.dispatch", "backend.tcp_server")
    levels = {name: logging.getLogger(name).level for name in names}
    for name in names:
        get_logger(name, level).addHandler(handler)

    def cleanup():
        for name in names:
            logging.getLogger(name).removeHandler(handler)
            logging.getLogger(name).setLevel(levels[name])
        handler.close()

    return cleanup


def create_app(config=None):
    """构建网关应用，启动时独占数据库、恢复任务并监听内部模块连接。"""
    config = load_config(str(REPO_ROOT / "backend/config")) if config is None else config
    settings = GatewaySettings.from_config(config)
    repository = TaskRepository(settings.database_path, REPO_ROOT / "database/schema/robot_tasks.sql")
    lock = GatewayLock(settings.database_path)
    server = TcpDispatchServer(config["server"]["host"], config["server"]["port"])
    adapter = KinematicsAdapter(server)
    robot = RobotService(adapter, repository, settings)
    dispatch = DispatchService(robot_service=robot)
    dispatch.bind_server(server)

    def on_message(message):
        if adapter.on_message(message):
            return None
        return dispatch.on_message(message)

    def on_disconnect(module_id):
        adapter.on_disconnect(module_id)
        dispatch.on_disconnect(module_id)

    server.set_handlers(on_message, on_disconnect)

    @asynccontextmanager
    async def lifespan(app):
        async with AsyncExitStack() as cleanup:
            lock.acquire()
            cleanup.callback(lock.release)
            cleanup.callback(configure_logs(settings.log_path, config.get("log_level", "INFO")))
            await asyncio.to_thread(repository.initialize)
            recovered = await asyncio.to_thread(repository.recover_interrupted)
            logger.info("恢复历史任务，标记中断 %d 项", recovered)
            await server.open()
            cleanup.push_async_callback(server.close)
            cleanup.push_async_callback(dispatch.close)
            cleanup.push_async_callback(robot.close)
            yield

    app = FastAPI(title="VisRLFlexGrasp 规划网关", version="0.1.0", lifespan=lifespan)
    app.state.robot = robot
    app.state.tcp_server = server
    app.state.repository = repository

    @app.exception_handler(GatewayError)
    async def gateway_error(request: Request, error: GatewayError):
        return JSONResponse(response(code=error.code, message=str(error)), status_code=error.status)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, error: RequestValidationError):
        # 不返回原始输入，避免 NaN 或异常对象令错误报文再次序列化失败。
        details = [{"field": list(item["loc"]), "msg": item["msg"]} for item in error.errors()]
        return JSONResponse(response({"errors": details}, protocol.ErrorCode.INVALID_PARAM, "请求参数非法"),
                            status_code=422)

    @app.exception_handler(Exception)
    async def internal_error(request: Request, error: Exception):
        logger.error("HTTP 网关内部错误", exc_info=(type(error), error, error.__traceback__))
        return JSONResponse(response(code=3001, message="后端内部错误，请查看日志"), status_code=500)

    @app.get("/health")
    async def health():
        return response({"status": "ok", "execution_mode": "plan_only"})

    @app.get("/robot/status")
    async def robot_status():
        return response(robot.status())

    @app.post("/robot/plan", status_code=202)
    async def plan(request: PlanRequest):
        task_id = await robot.submit(request)
        return response({"task_id": task_id, "status": "planning", "task_url": "/tasks/" + task_id})

    @app.get("/tasks/{task_id}")
    async def task(task_id: str):
        return response(await robot.get_task(task_id))

    return app
