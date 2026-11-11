// 文件功能：前端默认常量集中定义（接口路径、WS 策略、表单默认值、图表配色、存储键与路由表）
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11
// 说明：所有固定数值、文案与接口路径统一在此维护，业务组件禁止硬编码魔法数字；
//       运行时 ui 默认值优先来自前端网关 GET /api/gateway/config，本文件仅作降级兜底。

// ---------------------------------------------------------------------------
// 应用基础信息
// ---------------------------------------------------------------------------
export const APP_NAME = 'VisRLFlexGrasp'
export const APP_TITLE = '自适应柔性抓取果蔬分拣系统'
export const APP_SUBTITLE = '视觉感知 + 强化学习 + 柔性抓取 · 前端可视化交互层'
export const APP_FOOTER = 'VisRLFlexGrasp 项目组 · 第一阶段仅规划（plan_only）模式，机械臂执行与力控尚未接入'
export const APP_VERSION = 'v0.1.0'

// ---------------------------------------------------------------------------
// 接口路径：浏览器同源访问前端网关，统一 /api 前缀；WebSocket 默认 /ws
// ---------------------------------------------------------------------------
export const API_PREFIX = '/api'
export const WS_PATH = '/ws'

export const API_PATHS = {
    GATEWAY_CONFIG: '/gateway/config',
    GATEWAY_STATUS: '/gateway/status',
    HEALTH: '/health',
    ROBOT_STATUS: '/robot/status',
    ROBOT_PLAN: '/robot/plan',
    TASK_PREFIX: '/tasks/',
}

// ---------------------------------------------------------------------------
// 通信策略：HTTP 默认超时 3 秒（STYLEGUIDE 4.6）；WS 断线按 1s/3s/5s 递增重连
// ---------------------------------------------------------------------------
export const HTTP_TIMEOUT_MS = 3000
export const WS_RECONNECT_INTERVALS_SEC = [1, 3, 5]
export const WS_PING_INTERVAL_MS = 15000
export const WS_READY_STATE_OPEN = 1
// 断线重连仅在首次尝试时写事件日志，避免网关长时间离线时日志被重连信息刷屏
export const WS_RECONNECT_LOG_ATTEMPT_LIMIT = 1
export const MIN_POLL_INTERVAL_MS = 200
export const POLL_INTERVAL_MIN_MS = 200
export const POLL_INTERVAL_MAX_MS = 60000
export const POLL_INTERVAL_STEP_MS = 100

// ---------------------------------------------------------------------------
// 分拣任务与规划提交默认参数
// ---------------------------------------------------------------------------
export const DEFAULT_UI_CONFIG = {
    poll_interval_ms: 2000,
    default_force_limit: 5.0,
    categories: ['apple', 'pear', 'tomato', 'orange'],
    speed_levels: [1, 2, 3],
    event_log_limit: 200,
    task_history_limit: 20,
}

// 示例位姿来自仓库场景基准位姿，联调优先使用；坐标单位米，四元数顺序 [qx, qy, qz, qw]
export const DEFAULT_GRASP_POSE = {
    position: [0.4438529774275135, 0.0008265416580825816, 0.8782905239223139],
    orientation: [-0.4408671049817439, -0.6485064527651077, 0.26991550492473876, 0.558767569449282],
}

export const FORCE_LIMIT_MIN = 0.1
export const FORCE_LIMIT_MAX = 40.0
export const FORCE_LIMIT_STEP = 0.1
export const POSITION_INPUT_STEP = 0.001
export const QUATERNION_INPUT_STEP = 0.0001

export const TASK_ID_PREFIX = 'sort'
export const TASK_ID_RANDOM_LENGTH = 4
export const TASK_ID_MAX_LENGTH = 256
export const REQUEST_ID_PREFIX = 'req'

// 规划任务轮询：后端规划超时 5 秒，前端留出网络与排队余量
export const PLAN_POLL_TIMEOUT_MS = 15000

// ---------------------------------------------------------------------------
// 任务状态与阶段（与后端 status/phase 取值严格一致）
// ---------------------------------------------------------------------------
export const TASK_TERMINAL_STATUSES = ['planned', 'failed', 'interrupted']

// ---------------------------------------------------------------------------
// 图表：六轴关节名称与统一配色（绿色系呼应项目 Logo）
// ---------------------------------------------------------------------------
export const JOINT_COUNT = 6
export const JOINT_NAMES = [
    '关节 1（肩部）',
    '关节 2（大臂）',
    '关节 3（肘部）',
    '关节 4（腕部 1）',
    '关节 5（腕部 2）',
    '关节 6（末端）',
]
export const JOINT_SHORT_NAMES = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6']

export const CHART_COLORS = ['#1a614a', '#2e8b57', '#69d043', '#3aa6a0', '#4f86c6', '#8bc34a']
export const CHART_TEXT_COLOR = '#4a5f56'
export const CHART_AXIS_LINE_COLOR = '#c8d9d0'
export const CHART_SPLIT_LINE_COLOR = '#e8f0ec'
export const CHART_FONT_FAMILY =
    '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Segoe UI", system-ui, sans-serif'
export const CHART_ANIMATION_DURATION_MS = 400
export const TRAJECTORY_CHART_HEIGHT = '380px'
export const JOINT_CHART_HEIGHT = '300px'
export const CHART_SYMBOL_SIZE = 4
// 图表数值精度与缩放粒度：轨迹值保留 6 位小数；缩放窗口最小点数 2、按总点数 1/10 起步
export const CHART_VALUE_DECIMALS = 6
export const CHART_MIN_ZOOM_POINTS = 2
export const CHART_ZOOM_MIN_POINT_DIVISOR = 10
export const TRAJECTORY_TIME_DECIMALS = 6
// 四元数范数下限（与后端 robot_request.py 校验一致）
export const QUATERNION_NORM_MIN = 1e-12

// ---------------------------------------------------------------------------
// 本地存储：统一前缀，避免与同域其它应用冲突
// ---------------------------------------------------------------------------
export const STORAGE_PREFIX = 'visrl_flex_grasp'
export const STORAGE_KEYS = {
    UI_SETTINGS: 'ui_settings',
    TASK_HISTORY: 'task_history',
}

// ---------------------------------------------------------------------------
// WebSocket 连接状态枚举（前端内部状态，非后端报文）
// ---------------------------------------------------------------------------
export const WS_STATE = {
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
}

// ---------------------------------------------------------------------------
// 顶栏导航（路由名与路由表 router/index.js 保持一致）
// ---------------------------------------------------------------------------
export const NAV_ITEMS = [
    { name: 'dashboard', path: '/', label: '总览' },
    { name: 'robot', path: '/robot', label: '机器人状态' },
    { name: 'tasks', path: '/tasks', label: '任务查询' },
    { name: 'settings', path: '/settings', label: '参数配置' },
]

// ---------------------------------------------------------------------------
// 全局错误码（与 common/protocol.py ErrorCode 保持一致，前端仅用于友好提示）
// ---------------------------------------------------------------------------
export const ERROR_CODES = {
    SUCCESS: 0,
    INVALID_PARAM: 1000,
    INVALID_MESSAGE: 1001,
    REQUEST_TIMEOUT: 1002,
    NOT_REGISTERED: 1003,
    TASK_NOT_FOUND: 1004,
    MODEL_LOAD_FAILED: 2000,
    MOTION_EXEC_FAILED: 3001,
    EMERGENCY_STOP: 3002,
    ROBOT_BUSY: 3003,
    TARGET_OFFLINE: 4000,
    HEARTBEAT_TIMEOUT: 4001,
}

// ---------------------------------------------------------------------------
// 事件日志：详情 JSON 截断长度，避免单条报文撑爆日志面板
// ---------------------------------------------------------------------------
export const EVENT_LOG_DETAIL_MAX_CHARS = 1200
