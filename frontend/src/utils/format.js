// 文件功能：界面展示格式化工具（时间、数值、状态文案、错误码提示、WebSocket 事件中文描述）
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11
import {
    ERROR_CODES,
    EVENT_LOG_DETAIL_MAX_CHARS,
    TASK_TERMINAL_STATUSES,
    TRAJECTORY_TIME_DECIMALS,
    WS_STATE,
} from '../config/defaults.js'

// 后端任务状态（GET /api/tasks/{task_id} 的 data.status）
export const TASK_STATUS_LABELS = {
    planning: '规划中',
    planned: '规划完成（未执行）',
    failed: '规划失败',
    interrupted: '已中断',
}

export const TASK_STATUS_TONES = {
    planning: 'info',
    planned: 'ok',
    failed: 'error',
    interrupted: 'warn',
}

// 任务阶段（task_result 的 data.phase；仅真实执行后才会出现 placed）
export const PHASE_LABELS = {
    sorting: '分拣中',
    planned: '规划完成（未执行）',
    failed: '规划失败',
    interrupted: '已中断',
    placed: '已放置（真实执行）',
}

export const WS_STATE_LABELS = {
    [WS_STATE.CONNECTING]: '连接中',
    [WS_STATE.CONNECTED]: '已连接',
    [WS_STATE.DISCONNECTED]: '未连接',
}

export const ERROR_CODE_LABELS = {
    1000: '参数非法',
    1001: '报文格式非法',
    1002: '请求超时',
    1003: '未注册模块',
    1004: '任务不存在',
    2000: '模型加载失败',
    2001: '推理超时',
    2002: '未检测到目标',
    3000: '仿真连接失败',
    3001: '运动规划失败',
    3002: '紧急停止',
    3003: '已有任务正在运行',
    4000: '后端服务未连接',
    4001: '心跳超时',
}

export const CATEGORY_LABELS = {
    apple: '苹果',
    pear: '梨',
    tomato: '番茄',
    orange: '橙子',
}

export const SPEED_LEVEL_LABELS = {
    1: '1 级（低速）',
    2: '2 级（中速）',
    3: '3 级（高速）',
}

// 未知取值的兜底展示文案
const UNKNOWN_TEXT = '—'

/**
 * 将毫秒时间戳格式化为本地时间文本。
 * 入参：timestamp_ms Unix 毫秒；with_date 是否包含日期部分（默认 true）。
 * 返回：'YYYY-MM-DD HH:mm:ss' 或 'HH:mm:ss'；非法/空值返回 '—'。
 */
export function format_time_ms(timestamp_ms, with_date = true) {
    if (timestamp_ms === null || timestamp_ms === undefined || timestamp_ms === '') {
        return UNKNOWN_TEXT
    }
    const numeric_value = Number(timestamp_ms)
    if (!Number.isFinite(numeric_value) || numeric_value <= 0) {
        return UNKNOWN_TEXT
    }
    const date = new Date(numeric_value)
    const pad = (value) => String(value).padStart(2, '0')
    const time_part = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    if (!with_date) {
        return time_part
    }
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time_part}`
}

/**
 * 格式化带单位的浮点数值。
 * 入参：value 任意数值；digits 小数位（默认 3）；unit 单位文本（可空）。
 * 返回：'0.443 m' 形式文本；非法值返回 '—'。
 */
export function format_number(value, digits = 3, unit = '') {
    const numeric_value = Number(value)
    if (value === null || value === undefined || !Number.isFinite(numeric_value)) {
        return UNKNOWN_TEXT
    }
    const text = numeric_value.toFixed(digits)
    return unit ? `${text} ${unit}` : text
}

/**
 * 格式化关节角数组。
 * 入参：angles 关节角数组（弧度）；digits 小数位（默认 3）。
 * 返回：'0.000, -0.400, 0.700, 0.200, -0.500, 0.600' 形式文本；非法值返回 '—'。
 */
export function format_angles(angles, digits = 3) {
    if (!Array.isArray(angles) || angles.length === 0) {
        return UNKNOWN_TEXT
    }
    return angles.map((value) => format_number(value, digits)).join(', ')
}

/**
 * 格式化布尔值为中文。
 * 入参：value 布尔值或 null。
 * 返回：'是' / '否' / '—'。
 */
export function format_boolean(value) {
    if (value === true) {
        return '是'
    }
    if (value === false) {
        return '否'
    }
    return UNKNOWN_TEXT
}

/**
 * 弧度转角度展示文本。
 * 入参：radians 弧度值；digits 小数位（默认 1）。
 * 返回：'12.3°'；非法值返回 '—'。
 */
export function format_degrees(radians, digits = 1) {
    const numeric_value = Number(radians)
    if (!Number.isFinite(numeric_value)) {
        return UNKNOWN_TEXT
    }
    const degrees = (numeric_value * 180) / Math.PI
    return `${degrees.toFixed(digits)}°`
}

/**
 * 获取任务状态中文文案。
 * 入参：status 后端任务状态字符串。
 * 返回：中文状态；未知状态原样返回。
 */
export function get_task_status_label(status) {
    if (!status) {
        return UNKNOWN_TEXT
    }
    return TASK_STATUS_LABELS[status] || String(status)
}

/**
 * 获取任务状态对应的界面色调。
 * 入参：status 后端任务状态字符串。
 * 返回：'ok' / 'error' / 'warn' / 'info' / 'idle'。
 */
export function get_task_status_tone(status) {
    return TASK_STATUS_TONES[status] || 'idle'
}

/**
 * 获取任务阶段中文文案。
 * 入参：phase task_result 的 phase 字段。
 * 返回：中文阶段；未知阶段原样返回；空值返回 '—'。
 */
export function get_phase_label(phase) {
    if (!phase) {
        return UNKNOWN_TEXT
    }
    return PHASE_LABELS[phase] || String(phase)
}

/**
 * 获取品类中文文案；空品类表示全品类。
 * 入参：category 品类标识（apple/pear/...）。
 * 返回：中文品类。
 */
export function get_category_label(category) {
    if (!category) {
        return '全品类'
    }
    return CATEGORY_LABELS[category] || String(category)
}

/**
 * 获取速度等级中文文案。
 * 入参：speed_level 速度等级数值。
 * 返回：中文速度描述。
 */
export function get_speed_level_label(speed_level) {
    if (speed_level === null || speed_level === undefined || speed_level === '') {
        return UNKNOWN_TEXT
    }
    return SPEED_LEVEL_LABELS[speed_level] || `${speed_level} 级`
}

/**
 * 获取错误码中文说明。
 * 入参：code 整数错误码。
 * 返回：中文说明；未知错误码返回 '未知错误'。
 */
export function get_error_code_label(code) {
    return ERROR_CODE_LABELS[code] || '未知错误'
}

/**
 * 将错误对象格式化为界面可读文案。
 * 入参：error 可为 {code, msg} 结构、Error 实例、字符串。
 * 返回：'已有任务正在运行（3003）：...' 形式的中文提示。
 */
export function format_error(error) {
    if (!error) {
        return '未知错误'
    }
    if (typeof error === 'string') {
        return error
    }
    const code = error.code
    const label = code === undefined || code === null ? '' : get_error_code_label(code)
    const raw_message = error.msg || error.message || ''
    if (label && raw_message) {
        return `${label}（${code}）：${raw_message}`
    }
    if (label) {
        return `${label}（${code}）`
    }
    return raw_message || '未知错误'
}

/**
 * 判断任务状态是否已到终态（planned/failed/interrupted）。
 * 入参：status 后端任务状态字符串。
 * 返回：布尔值。
 */
export function is_task_terminal(status) {
    return TASK_TERMINAL_STATUSES.includes(status)
}

/**
 * 将 WebSocket 下行报文转换为事件日志可读文案。
 * 入参：payload 网关下行报文对象（含 type 与业务字段）。
 * 返回：{ level, message }，level 为 info/warn/error。
 */
export function format_ws_message(payload) {
    const type = payload ? payload.type : ''
    const data = (payload && payload.data) || {}
    if (type === 'connection') {
        const tcp_text = data.tcp_connected ? '已连接' : '未连接'
        const register_text = data.registered ? '已完成' : '未完成'
        const backend_text = data.backend_online ? '在线' : '离线'
        return {
            level: 'info',
            message: `网关连接状态：TCP ${tcp_text}，模块注册${register_text}，后端${backend_text}`,
        }
    }
    if (type === 'ack') {
        return { level: 'info', message: `后端已受理分拣任务：${data.task_id || '未知任务'}` }
    }
    if (type === 'error') {
        const code = payload.code
        return {
            level: 'warn',
            message: `网关返回错误 ${code}：${payload.msg || get_error_code_label(code)}`,
        }
    }
    if (type === 'task_result') {
        const phase_text = get_phase_label(data.phase)
        const finished_text = data.is_finished ? '任务已结束' : '任务进行中'
        if (data.error) {
            return {
                level: 'error',
                message: `任务 ${data.task_id || '未知任务'} 失败：${format_error(data.error)}`,
            }
        }
        return {
            level: 'info',
            message: `任务 ${data.task_id || '未知任务'}：已分拣 ${format_number(data.sorted_count, 0)}，`
                + `${phase_text}，${finished_text}`,
        }
    }
    if (type === 'backend_message') {
        const code = payload.code
        const parts = [`后端报文转发：${payload.msg_type || '未知类型'}`]
        if (typeof code === 'number' && code !== 0) {
            parts.push(`错误码 ${code}`)
        }
        if (typeof payload.msg === 'string' && payload.msg && payload.msg !== 'success') {
            parts.push(payload.msg)
        }
        return {
            level: typeof code === 'number' && code !== 0 ? 'warn' : 'info',
            message: parts.join('，'),
        }
    }
    return { level: 'info', message: `收到网关报文：${type || '未知类型'}` }
}

/**
 * 将任意数据格式化为可读 JSON 文本（用于事件日志详情），超长自动截断。
 * 入参：value 任意可序列化数据。
 * 返回：美化后的 JSON；无法序列化时返回 String(value)。
 */
export function format_json_detail(value) {
    if (value === null || value === undefined) {
        return ''
    }
    let text = ''
    try {
        text = JSON.stringify(value, null, 2)
    } catch (error) {
        text = String(value)
    }
    if (typeof text !== 'string') {
        text = String(text)
    }
    if (text.length > EVENT_LOG_DETAIL_MAX_CHARS) {
        return `${text.slice(0, EVENT_LOG_DETAIL_MAX_CHARS)}…（已截断）`
    }
    return text
}

/**
 * 计算六轴轨迹的时间轴数组：优先使用后端 sample_period_sec，缺失时按 duration 等分推算。
 * 入参：point_count 轨迹点数量；duration_sec 规划时长（秒）；sample_period_sec 采样周期（秒）。
 * 返回：长度等于 point_count 的时间数组（秒）。
 */
export function build_trajectory_times(point_count, duration_sec, sample_period_sec) {
    const safe_count = Number(point_count) > 0 ? Number(point_count) : 0
    if (safe_count === 0) {
        return []
    }
    const duration = Number(duration_sec)
    const period = Number(sample_period_sec)
    let step = period
    if (!Number.isFinite(step) || step <= 0) {
        step = Number.isFinite(duration) && duration > 0 && safe_count > 1 ? duration / (safe_count - 1) : 0
    }
    const times = []
    for (let index = 0; index < safe_count; index += 1) {
        // 保留固定小数位，避免浮点累加噪声进入图表数据
        times.push(Number((index * step).toFixed(TRAJECTORY_TIME_DECIMALS)))
    }
    return times
}

// 常用错误码引用，便于组件判断特定业务场景（如 409 忙碌、503 离线）
export const ERROR_CODE_SET = {
    INVALID_PARAM: ERROR_CODES.INVALID_PARAM,
    REQUEST_TIMEOUT: ERROR_CODES.REQUEST_TIMEOUT,
    TASK_NOT_FOUND: ERROR_CODES.TASK_NOT_FOUND,
    ROBOT_BUSY: ERROR_CODES.ROBOT_BUSY,
    TARGET_OFFLINE: ERROR_CODES.TARGET_OFFLINE,
}
