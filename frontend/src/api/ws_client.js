// 文件功能：前端网关 WebSocket 客户端（连接、1s/3s/5s 递增重连、事件订阅、task_start 请求关联、心跳）
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11
import {
    WS_PATH,
    WS_PING_INTERVAL_MS,
    WS_READY_STATE_OPEN,
    WS_RECONNECT_INTERVALS_SEC,
    WS_STATE,
} from '../config/defaults.js'
import { generate_request_id } from '../utils/id.js'

// 毫秒与秒换算基数，用于把配置中的秒级重连间隔转换为 setTimeout 毫秒
const MS_PER_SECOND = 1000

/**
 * WebSocket 客户端：对外暴露 connect/close/send/send_task_start/subscribe。
 * 事件通过 subscribe 回调下发，回调入参为网关下行报文对象，另有本地事件：
 *   { type: 'state', state, reconnect_attempt }        连接状态变化
 *   { type: 'reconnect_scheduled', delay_ms, attempt } 已安排重连
 *   { type: 'socket_error', message }                  底层套接字异常
 *   { type: 'invalid_message', raw }                   收到非法 JSON/非文本帧
 */
export class WsClient {
    constructor(options = {}) {
        this.path = options.path || WS_PATH
        this.reconnect_intervals_sec = options.reconnect_intervals_sec || WS_RECONNECT_INTERVALS_SEC
        this.ping_interval_ms = Number(options.ping_interval_ms) > 0
            ? Number(options.ping_interval_ms)
            : WS_PING_INTERVAL_MS
        this.socket_factory = options.socket_factory
            || ((url) => new WebSocket(url))
        this.socket = null
        this.state = WS_STATE.DISCONNECTED
        this.reconnect_attempt = 0
        this.listeners = new Set()
        this.reconnect_timer = null
        this.ping_timer = null
        this.manual_close = false
    }

    /**
     * 获取当前连接状态。
     * 返回：'connecting' / 'connected' / 'disconnected'。
     */
    get_state() {
        return this.state
    }

    /**
     * 更新 WebSocket 路径（来自网关门面配置 gateway.ws_path）。
     * 入参：path 以 / 开头的路径。
     * 返回：无。
     */
    set_path(path) {
        if (typeof path === 'string' && path.startsWith('/')) {
            this.path = path
        }
    }

    /**
     * 订阅网关下行报文与本地生命周期事件。
     * 入参：listener 处理函数 (event) => void。
     * 返回：取消订阅函数。
     */
    subscribe(listener) {
        if (typeof listener !== 'function') {
            return () => {}
        }
        this.listeners.add(listener)
        return () => {
            this.listeners.delete(listener)
        }
    }

    /**
     * 内部事件分发：单个监听器异常不影响其它监听器。
     * 入参：event 事件对象。
     * 返回：无。
     */
    _emit(event) {
        this.listeners.forEach((listener) => {
            try {
                listener(event)
            } catch (error) {
                console.error('[ws_client] 事件监听处理失败', error)
            }
        })
    }

    /**
     * 更新连接状态并广播 state 事件。
     * 入参：state 目标状态；extra 附加字段。
     * 返回：无。
     */
    _set_state(state, extra = {}) {
        this.state = state
        this._emit({
            type: 'state',
            state,
            reconnect_attempt: this.reconnect_attempt,
            ...extra,
        })
    }

    /**
     * 构建同源 WebSocket 地址：开发环境由 Vite 代理 /ws 到前端网关。
     * 返回：ws:// 或 wss:// 地址。
     */
    build_url() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        return `${protocol}//${window.location.host}${this.path}`
    }

    /**
     * 建立连接；重复调用在连接中/已连接时直接返回。
     * 返回：无。
     */
    connect() {
        if (typeof window === 'undefined') {
            return
        }
        if (this.state === WS_STATE.CONNECTING || this.state === WS_STATE.CONNECTED) {
            return
        }
        this.manual_close = false
        this._clear_reconnect_timer()
        const url = this.build_url()
        this._set_state(WS_STATE.CONNECTING)
        let socket = null
        try {
            socket = this.socket_factory(url)
        } catch (error) {
            this._emit({ type: 'socket_error', message: 'WebSocket 创建失败', error })
            this._set_state(WS_STATE.DISCONNECTED)
            this._schedule_reconnect()
            return
        }
        this.socket = socket
        socket.onopen = () => {
            this.reconnect_attempt = 0
            this._set_state(WS_STATE.CONNECTED)
            this._start_ping()
        }
        socket.onmessage = (event) => {
            this._handle_raw_message(event ? event.data : null)
        }
        socket.onerror = () => {
            this._emit({ type: 'socket_error', message: 'WebSocket 连接异常' })
        }
        socket.onclose = (event) => {
            this._stop_ping()
            this.socket = null
            this._set_state(WS_STATE.DISCONNECTED, {
                close_code: event ? event.code : null,
                close_reason: event ? event.reason : '',
            })
            if (!this.manual_close) {
                this._schedule_reconnect()
            }
        }
    }

    /**
     * 解析并分发服务端文本帧；非法报文只广播 invalid_message，不抛异常。
     * 入参：raw 原始帧数据。
     * 返回：无。
     */
    _handle_raw_message(raw) {
        if (typeof raw !== 'string') {
            this._emit({ type: 'invalid_message', raw })
            return
        }
        let payload = null
        try {
            payload = JSON.parse(raw)
        } catch (error) {
            this._emit({ type: 'invalid_message', raw })
            return
        }
        if (!payload || typeof payload !== 'object' || typeof payload.type !== 'string') {
            this._emit({ type: 'invalid_message', raw })
            return
        }
        this._emit(payload)
    }

    /**
     * 发送一条 JSON 文本帧。
     * 入参：payload 可序列化对象。
     * 返回：发送成功 true；未连接或序列化失败 false。
     */
    send(payload) {
        if (!this.socket || this.socket.readyState !== WS_READY_STATE_OPEN) {
            return false
        }
        try {
            this.socket.send(JSON.stringify(payload))
            return true
        } catch (error) {
            return false
        }
    }

    /**
     * 下发分拣任务（唯一上行报文 task_start），并生成用于 ack/error 关联的 request_id。
     * 入参：data { task_id, category, speed_level }。
     * 返回：{ request_id, sent }。
     */
    send_task_start(data) {
        const request_id = generate_request_id()
        const sent = this.send({
            type: 'task_start',
            request_id,
            data: {
                task_id: data.task_id,
                category: data.category === undefined ? '' : data.category,
                speed_level: data.speed_level === undefined ? null : data.speed_level,
            },
        })
        return { request_id, sent }
    }

    /**
     * 启动应用层心跳（协议支持 ping/pong，网关回 pong 时仅作为存活信号）。
     * 返回：无。
     */
    _start_ping() {
        this._stop_ping()
        this.ping_timer = setInterval(() => {
            this.send({ type: 'ping', timestamp: Date.now() })
        }, this.ping_interval_ms)
    }

    /**
     * 停止心跳定时器。
     * 返回：无。
     */
    _stop_ping() {
        if (this.ping_timer !== null) {
            clearInterval(this.ping_timer)
            this.ping_timer = null
        }
    }

    /**
     * 按 1s/3s/5s 递增间隔安排下一次重连，达到最大间隔后保持 5s 持续重试。
     * 返回：无。
     */
    _schedule_reconnect() {
        this._clear_reconnect_timer()
        const intervals = this.reconnect_intervals_sec
        const index = Math.min(this.reconnect_attempt, intervals.length - 1)
        const delay_ms = Math.round(Number(intervals[index]) * MS_PER_SECOND)
        this.reconnect_attempt += 1
        this._emit({ type: 'reconnect_scheduled', delay_ms, attempt: this.reconnect_attempt })
        this.reconnect_timer = setTimeout(() => {
            this.reconnect_timer = null
            this.connect()
        }, delay_ms)
    }

    /**
     * 清理重连定时器。
     * 返回：无。
     */
    _clear_reconnect_timer() {
        if (this.reconnect_timer !== null) {
            clearTimeout(this.reconnect_timer)
            this.reconnect_timer = null
        }
    }

    /**
     * 主动关闭连接并停止重连（组件卸载或应用退出时调用）。
     * 返回：无。
     */
    close() {
        this.manual_close = true
        this._clear_reconnect_timer()
        this._stop_ping()
        const socket = this.socket
        this.socket = null
        if (socket) {
            try {
                socket.close()
            } catch (error) {
                // 关闭异常可忽略，连接已不可用
            }
        }
        if (this.state !== WS_STATE.DISCONNECTED) {
            this.state = WS_STATE.DISCONNECTED
            this._emit({ type: 'state', state: WS_STATE.DISCONNECTED, reconnect_attempt: this.reconnect_attempt })
        }
    }
}

// 全局单例：整个应用共享同一条 WebSocket 连接
export const ws_client = new WsClient()
