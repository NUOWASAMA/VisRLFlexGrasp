// 文件功能：全局 WebSocket 生命周期编排（连接、状态同步、下行报文写入事件日志），应用启动一次、退出关闭
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11
import { ws_client } from '../api/ws_client.js'
import {
    WS_PATH,
    WS_RECONNECT_LOG_ATTEMPT_LIMIT,
    WS_STATE,
} from '../config/defaults.js'
import { format_json_detail, format_ws_message, get_error_code_label } from '../utils/format.js'
import { use_app_config } from './use_app_config.js'
import { apply_connection_event, set_ws_state } from './use_app_status.js'
import { configure_event_log_limit, push_event } from './use_event_log.js'

// 初始化标记与事件订阅句柄，保证整个应用只建立一条连接
let initialized = false
let unsubscribe = null
let previous_ws_state = WS_STATE.DISCONNECTED

/**
 * 处理连接状态变化事件：更新全局状态并按需记录日志（重连失败不重复刷屏）。
 * 入参：event { state, reconnect_attempt }。
 * 返回：无。
 */
function handle_ws_state_event(event) {
    const next_state = event.state
    const attempt = Number(event.reconnect_attempt) || 0
    set_ws_state(next_state, attempt)
    if (next_state === WS_STATE.CONNECTED) {
        push_event({ source: 'ws', level: 'success', message: 'WebSocket 已连接前端网关，实时通道就绪' })
    } else if (next_state === WS_STATE.CONNECTING) {
        if (previous_ws_state !== WS_STATE.CONNECTING) {
            push_event({ source: 'ws', level: 'info', message: '正在连接前端网关 WebSocket…' })
        }
    } else if (next_state === WS_STATE.DISCONNECTED) {
        if (previous_ws_state === WS_STATE.CONNECTED) {
            push_event({ source: 'ws', level: 'warn', message: 'WebSocket 连接已断开，将按 1s/3s/5s 递增重连' })
        } else if (attempt <= WS_RECONNECT_LOG_ATTEMPT_LIMIT) {
            push_event({ source: 'ws', level: 'warn', message: 'WebSocket 连接失败，将持续自动重连' })
        }
    }
    previous_ws_state = next_state
}

/**
 * 处理网关下行报文：同步连接快照并写入事件日志（pong 心跳不记录）。
 * 入参：event 网关下行报文对象。
 * 返回：无。
 */
function handle_gateway_message(event) {
    if (event.type === 'connection') {
        apply_connection_event(event.data)
        const detail = event.data
        const text = format_ws_message(event)
        push_event({ source: 'ws', level: text.level, message: text.message, detail })
        return
    }
    if (event.type === 'pong') {
        return
    }
    if (event.type === 'error') {
        const level = 'warn'
        push_event({
            source: 'ws',
            level,
            message: `网关返回错误 ${event.code}：${event.msg || get_error_code_label(event.code)}`,
            detail: event.data === undefined ? null : event.data,
        })
        return
    }
    const text = format_ws_message(event)
    push_event({
        source: 'ws',
        level: text.level,
        message: text.message,
        detail: format_json_detail(event.data === undefined ? null : event.data),
    })
}

/**
 * WebSocket 客户端事件统一入口。
 * 入参：event WsClient 下发的事件对象。
 * 返回：无。
 */
function handle_ws_event(event) {
    if (!event || typeof event.type !== 'string') {
        return
    }
    switch (event.type) {
        case 'state':
            handle_ws_state_event(event)
            break
        case 'reconnect_scheduled':
            // 仅首次重连提示，后续重连尝试不再写入日志，避免离线时刷屏
            if ((Number(event.attempt) || 0) <= WS_RECONNECT_LOG_ATTEMPT_LIMIT) {
                const delay_sec = Math.round((Number(event.delay_ms) || 0) / 1000)
                push_event({
                    source: 'ws',
                    level: 'info',
                    message: `将在 ${delay_sec} 秒后进行第 ${event.attempt} 次重连`,
                })
            }
            break
        case 'socket_error':
            push_event({ source: 'ws', level: 'warn', message: event.message || 'WebSocket 套接字异常' })
            break
        case 'invalid_message':
            push_event({
                source: 'ws',
                level: 'warn',
                message: '收到非法 WebSocket 报文，已忽略',
                detail: String(event.raw).slice(0, 512),
            })
            break
        case 'connection':
        case 'ack':
        case 'error':
        case 'task_result':
        case 'backend_message':
        case 'pong':
            handle_gateway_message(event)
            break
        default:
            // 未知报文类型仅记录，不影响连接
            push_event({
                source: 'ws',
                level: 'info',
                message: `收到未识别的网关报文：${event.type}`,
                detail: format_json_detail(event),
            })
            break
    }
}

/**
 * 初始化全局 WebSocket：读取网关门面配置、订阅事件并建立连接。重复调用幂等。
 * 返回：无。
 */
export function init_gateway_ws() {
    if (initialized) {
        return
    }
    initialized = true
    const app_config = use_app_config()
    configure_event_log_limit(app_config.ui.event_log_limit)
    ws_client.set_path(app_config.gateway.ws_path || WS_PATH)
    unsubscribe = ws_client.subscribe(handle_ws_event)
    push_event({ source: 'system', level: 'info', message: '前端应用启动，正在连接前端网关' })
    ws_client.connect()
}

/**
 * 关闭全局 WebSocket 并取消事件订阅（应用卸载时调用）。
 * 返回：无。
 */
export function shutdown_gateway_ws() {
    if (!initialized) {
        return
    }
    initialized = false
    if (unsubscribe) {
        unsubscribe()
        unsubscribe = null
    }
    ws_client.close()
}
