// 文件功能：应用级事件日志（WebSocket 事件与 HTTP 结果），按 ui.event_log_limit 上限滚动保留并可清空
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11
import { readonly, ref } from 'vue'
import { DEFAULT_UI_CONFIG } from '../config/defaults.js'

// 事件级别：info 普通信息 / success 成功 / warn 警告 / error 错误
const EVENT_LEVELS = ['info', 'success', 'warn', 'error']

const entries = ref([])
const max_entries = ref(DEFAULT_UI_CONFIG.event_log_limit)

// 自增序号，仅用于列表 key 渲染
let next_sequence = 1

/**
 * 按当前上限裁剪事件列表（保留最新在前）。
 * 返回：无。
 */
function trim_entries() {
    if (entries.value.length > max_entries.value) {
        entries.value = entries.value.slice(0, max_entries.value)
    }
}

/**
 * 更新事件日志上限（来自 GET /api/gateway/config 的 ui.event_log_limit）。
 * 入参：limit 正整数上限。
 * 返回：无。
 */
export function configure_event_log_limit(limit) {
    const numeric_value = Number(limit)
    if (!Number.isFinite(numeric_value) || numeric_value <= 0) {
        return
    }
    max_entries.value = Math.round(numeric_value)
    trim_entries()
}

/**
 * 追加一条事件日志。
 * 入参：event { source, level, message, detail }；
 *       source 为 'ws' / 'http' / 'system' 等来源标识，level 取值见 EVENT_LEVELS。
 * 返回：无。
 */
export function push_event(event = {}) {
    const level = EVENT_LEVELS.includes(event.level) ? event.level : 'info'
    entries.value.unshift({
        id: next_sequence,
        source: typeof event.source === 'string' ? event.source : 'system',
        level,
        message: typeof event.message === 'string' ? event.message : '',
        detail: event.detail === undefined ? null : event.detail,
        timestamp_ms: Date.now(),
    })
    next_sequence += 1
    trim_entries()
}

/**
 * 清空事件日志。
 * 返回：无。
 */
export function clear_events() {
    entries.value = []
}

/**
 * 获取事件日志组合式接口。
 * 返回：{ entries, max_entries, push_event, clear_events, configure_event_log_limit }。
 */
export function use_event_log() {
    return {
        entries: readonly(entries),
        max_entries: readonly(max_entries),
        push_event,
        clear_events,
        configure_event_log_limit,
    }
}
