// 文件功能：前端网关常量集中定义，统一模块标识、报文类型、错误码、WebSocket 报文、HTTP 与日志参数，禁止散落魔法数字
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11

// ===== 协议常量（与 common/protocol.py、docs/api/tcp_communication_spec.md 保持一致）=====

// 模块标识，对应协议规范 3.1 节
export const MODULE_ID = Object.freeze({
    BACKEND: "backend",
    ALGORITHM: "algorithm",
    MOTION: "motion",
    FRONTEND: "frontend",
});

// 报文类型，对应协议规范 3.2 节
export const MSG_TYPE = Object.freeze({
    REGISTER: "register",
    REGISTER_ACK: "register_ack",
    HEARTBEAT: "heartbeat",
    HEARTBEAT_ACK: "heartbeat_ack",
    TASK_START: "task_start",
    CAPTURE_CMD: "capture_cmd",
    DETECTION_RESULT: "detection_result",
    GRASP_COMMAND: "grasp_command",
    MOTION_STATUS: "motion_status",
    TASK_RESULT: "task_result",
    ERROR_REPORT: "error_report",
});

// 全局错误码，对应协议规范第 4 章
export const ERROR_CODE = Object.freeze({
    SUCCESS: 0,
    INVALID_PARAM: 1000,
    INVALID_MESSAGE: 1001,
    REQUEST_TIMEOUT: 1002,
    NOT_REGISTERED: 1003,
    TASK_NOT_FOUND: 1004,
    SIM_CONNECT_FAILED: 3000,
    MOTION_EXEC_FAILED: 3001,
    EMERGENCY_STOP: 3002,
    ROBOT_BUSY: 3003,
    TARGET_OFFLINE: 4000,
    HEARTBEAT_TIMEOUT: 4001,
});

// 报文必填字段清单，缺失任意字段判定为非法报文（与 common/protocol.py 一致）
export const REQUIRED_MESSAGE_FIELDS = Object.freeze(
    ["msg_type", "source", "target", "code", "msg", "data", "timestamp"],
);

// 错误码合法取值范围（全局错误码字典上限）
export const MAX_ERROR_CODE = 4999;

// 任务标识最大长度，后端 task_start 校验规则一致
export const TASK_ID_MAX_LENGTH = 256;

// 品类标识最大长度，防止异常客户端下发超长字段
export const CATEGORY_MAX_LENGTH = 64;

// ===== 前端网关 WebSocket 报文类型（网关与浏览器交互约定）=====

export const WS_TYPE = Object.freeze({
    CONNECTION: "connection",
    TASK_START: "task_start",
    PING: "ping",
    PONG: "pong",
    ACK: "ack",
    ERROR: "error",
    TASK_RESULT: "task_result",
    BACKEND_MESSAGE: "backend_message",
});

// 统一错误描述文本，避免各处重复硬编码
export const ERROR_MESSAGE = Object.freeze({
    INVALID_JSON: "报文格式错误：非法 JSON",
    INVALID_MESSAGE: "报文格式错误：缺少必填字段或字段类型非法",
    UNKNOWN_TYPE: "未知报文类型",
    INVALID_REQUEST_ID: "request_id 非法",
    INVALID_DATA: "data 必须为对象",
    EMPTY_TASK_ID: "task_id 不允许为空",
    TASK_ID_TOO_LONG: `task_id 长度不得超过 ${TASK_ID_MAX_LENGTH} 个字符`,
    INVALID_CATEGORY: "category 非法",
    INVALID_SPEED_LEVEL: "speed_level 非法",
    BACKEND_OFFLINE: "后端 TCP 未连接或未注册",
    TASK_SEND_FAILED: "任务下发失败：后端连接不可用",
    API_NOT_FOUND: "接口不存在",
});

// ===== 运行环境与启动参数 =====

// 环境变量名、允许的环境标识与缺省环境（与 common/config_loader.py 一致）
export const ENV_VAR_NAME = "VISRL_ENV";
export const VALID_ENVS = Object.freeze(["dev", "sim", "real"]);
export const DEFAULT_ENV = "sim";
export const BASE_CONFIG_NAME = "base.json";

// 单文件合并配置启动参数
export const CLI_CONFIG_FLAG = "--config";
export const CLI_CONFIG_FLAG_PREFIX = "--config=";
export const CLI_HELP_FLAGS = Object.freeze(["--help", "-h"]);
// --config 单文件模式下无法从文件名判定环境标识时的缺省值
export const CUSTOM_ENV = "custom";

// 日志中报文/错误文本预览的最大长度，防止非法帧刷屏
export const LOG_TEXT_PREVIEW_LENGTH = 120;

// 状态接口 last_error 展示文本的最大长度
export const LAST_ERROR_MAX_LENGTH = 512;

// ===== HTTP 服务 =====

export const HTTP_STATUS = Object.freeze({
    OK: 200,
    ACCEPTED: 202,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    NOT_FOUND: 404,
    METHOD_NOT_ALLOWED: 405,
    PAYLOAD_TOO_LARGE: 413,
    INTERNAL_ERROR: 500,
    SERVICE_UNAVAILABLE: 503,
    GATEWAY_TIMEOUT: 504,
});

export const HTTP_METHOD = Object.freeze({
    GET: "GET",
    POST: "POST",
    HEAD: "HEAD",
});

// HTTP 请求体上限（字节），防止异常请求撑爆内存
export const MAX_HTTP_REQUEST_BODY_BYTES = 1048576;

// 统一 JSON 响应头
export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

// 网关自身 API 子路径（相对 config.gateway.api_prefix）
export const API_PATH = Object.freeze({
    HEALTH: "/health",
    ROBOT_STATUS: "/robot/status",
    ROBOT_PLAN: "/robot/plan",
    TASKS_PREFIX: "/tasks/",
    SYSTEM_MODE: "/system/mode",
    GATEWAY_CONFIG: "/gateway/config",
    GATEWAY_STATUS: "/gateway/status",
});

// 缺省 API 前缀，实际取值来自 config.gateway.api_prefix
export const DEFAULT_API_PREFIX = "/api";

// 静态资源目录缺省值（相对仓库根），实际取值来自 config.gateway.static_dir
export const DEFAULT_STATIC_DIR = "frontend/dist";

// 单页应用入口文件名
export const INDEX_FILE_NAME = "index.html";

// 静态资源扩展名到 Content-Type 的映射
export const MIME_TYPES = Object.freeze({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8",
    ".wasm": "application/wasm",
});

// 未知扩展名的兜底 Content-Type
export const DEFAULT_BINARY_CONTENT_TYPE = "application/octet-stream";

// ===== WebSocket 会话 =====

// 单帧上限缺省值（字节），实际取值来自 config.gateway.max_frame_bytes
export const DEFAULT_MAX_FRAME_BYTES = 1048576;

// 客户端标识前缀，连接时按递增序号生成
export const CLIENT_ID_PREFIX = "client-";

// 网关关闭时 WebSocket 关闭码与原因
export const WS_CLOSE_CODE = Object.freeze({
    NORMAL: 1000,
    GOING_AWAY: 1001,
    PROTOCOL_ERROR: 1002,
    PAYLOAD_TOO_LARGE: 1009,
});
export const WS_CLOSE_REASON_GATEWAY_STOP = "网关关闭";

// WebSocket 优雅关闭的等待上限（毫秒）与关闭状态轮询间隔
export const WS_CLOSE_TIMEOUT_MS = 500;
export const WS_CLOSE_POLL_INTERVAL_MS = 20;

// 待关联 task_start 的保留时长（毫秒），用于把后端同步拒绝映射回原请求（契约 5~10 秒，取 10 秒）
export const PENDING_TASK_START_TTL_MS = 10000;

// ===== 日志 =====

export const LOG_LEVEL = Object.freeze({
    DEBUG: 10,
    INFO: 20,
    WARN: 30,
    ERROR: 40,
});

export const LOG_LEVEL_NAMES = Object.freeze({
    10: "DEBUG",
    20: "INFO",
    30: "WARN",
    40: "ERROR",
});

// 日志文件单文件上限（1 MiB）与历史备份份数
export const LOG_MAX_BYTES = 1048576;
export const LOG_BACKUP_COUNT = 3;

// 日志级别名与数值互查的合法名称集合（配置校验用）
export const VALID_LOG_LEVELS = Object.freeze(["DEBUG", "INFO", "WARN", "ERROR"]);

// ===== 配置校验边界 =====

export const MIN_PORT = 0;
export const MAX_PORT = 65535;
export const MIN_POSITIVE_INTERVAL_SEC = 0;
