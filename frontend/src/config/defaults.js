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
// 运行环境模式：入口页两个按钮（仿真 / 真实），与后端 /system/mode 字段严格一致
// ---------------------------------------------------------------------------
export const ENV_MODES = {
    SIM: 'sim',
    REAL: 'real',
}
export const DEFAULT_ENV_MODE = ENV_MODES.SIM
export const VALID_ENV_MODES = [ENV_MODES.SIM, ENV_MODES.REAL]
export const PORTAL_ROUTE_NAME = 'mode-select'
export const MODE_SWITCH_TIMEOUT_MS = 4000

// 入口页环境按钮文案与视觉标识；key 与后端 mode 取值一致
export const ENV_MODE_OPTIONS = [
    {
        key: ENV_MODES.SIM,
        index: '01',
        en: 'SIMULATION',
        label: '仿真环境',
        description: 'CoppeliaSim 场景与规划链路，用于算法快速迭代和抓取验证。',
        spec: 'COPPELIASM 4.10',
        enter_label: '进入仿真环境',
        status_available: '场景与规划链路可用',
        status_unavailable: '仿真适配器未就绪',
    },
    {
        key: ENV_MODES.REAL,
        index: '02',
        en: 'HARDWARE',
        label: '真实环境',
        description: 'UR5 + RG2 实体产线，用于硬件联调、力控与无损分拣验证。',
        spec: 'UR5 · RG2',
        enter_label: '进入真实环境',
        status_available: '控制柜与夹爪在线',
        status_unavailable: '硬件适配器未接入 · 界面预览',
    },
]

// 入口页介绍信息：只保留三条与项目核心能力对应的说明，避免堆砌
export const PORTAL_FACTS = [
    { index: '01', label: '视觉感知', detail: '果蔬目标检测与位姿解算' },
    { index: '02', label: '强化学习', detail: '自适应抓取策略与夹持力决策' },
    { index: '03', label: '柔性抓取', detail: '力控约束下的无损分拣' },
]
export const PORTAL_EYEBROW = '运行环境 / RUNTIME ENVIRONMENT'
export const PORTAL_TITLE = '选择进入的环境'
export const PORTAL_LEDE =
    '同一套视觉感知与运动规划链路，可在仿真验证与真实产线之间切换。仿真用于算法快速迭代，真实环境用于硬件联调与力控验证。'
export const PORTAL_HINT = '进入后可随时通过顶栏环境标识返回本页切换；当前各环境均处于仅规划（plan_only）阶段。'
export const PORTAL_FOOTER_LEFT = 'VisRLFlexGrasp 项目组'
export const PORTAL_FOOTER_RIGHT = '仿真优先 · SIM-FIRST'

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
    SYSTEM_MODE: '/system/mode',
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

// 分环境图表配色：仿真沿用绿色系，真实环境切换为蓝色系；图表在路由切换后按当前模式重建
export const CHART_THEMES = {
    [ENV_MODES.SIM]: {
        colors: CHART_COLORS,
        text: CHART_TEXT_COLOR,
        axis_line: CHART_AXIS_LINE_COLOR,
        split_line: CHART_SPLIT_LINE_COLOR,
        tooltip_background: 'rgba(18, 40, 32, 0.92)',
        tooltip_text: '#f2f8f5',
        zoom_background: 'rgba(26, 97, 74, 0.06)',
        zoom_filler: 'rgba(26, 97, 74, 0.14)',
    },
    [ENV_MODES.REAL]: {
        colors: ['#1c4f9c', '#2f6fd0', '#4f9dff', '#2f9fc4', '#6f7fd8', '#3f8fd0'],
        text: '#46566b',
        axis_line: '#c6d5e6',
        split_line: '#e7eef7',
        tooltip_background: 'rgba(13, 27, 46, 0.94)',
        tooltip_text: '#eef5ff',
        zoom_background: 'rgba(28, 79, 156, 0.06)',
        zoom_filler: 'rgba(28, 79, 156, 0.16)',
    },
}
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
    ENV_MODE: 'env_mode',
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
// 顶栏导航（路由名与路由表 router/index.js 保持一致；入口页 mode-select 不进入顶栏）
// ---------------------------------------------------------------------------
export const NAV_ITEMS = [
    { name: 'dashboard', path: '/dashboard', label: '总览' },
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
