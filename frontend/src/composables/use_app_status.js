// 文件功能：应用级连接状态（WebSocket 连接状态、网关 TCP/注册/后端在线状态），供顶栏与状态卡共享
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11
import { computed, reactive } from 'vue'
import { WS_STATE } from '../config/defaults.js'

// 网关状态默认值：未连接、未注册、后端离线
const DEFAULT_GATEWAY_STATUS = {
    tcp_connected: false,
    registered: false,
    backend_online: false,
    clients: 0,
    last_error: null,
}

const app_status = reactive({
    ws_state: WS_STATE.DISCONNECTED,
    ws_reconnect_attempt: 0,
    ws_client_id: '',
    gateway: { ...DEFAULT_GATEWAY_STATUS },
    gateway_last_updated_ms: 0,
    gateway_loading: false,
    gateway_error: null,
})

/**
 * 更新 WebSocket 连接状态。
 * 入参：state 'connecting' / 'connected' / 'disconnected'；reconnect_attempt 当前重连尝试次数。
 * 返回：无。
 */
export function set_ws_state(state, reconnect_attempt = 0) {
    app_status.ws_state = state
    app_status.ws_reconnect_attempt = Number(reconnect_attempt) || 0
}

/**
 * 应用 WS 下行 connection 报文里的连接快照。
 * 入参：data { tcp_connected, registered, backend_online, client_id }，允许字段缺失。
 * 返回：无。
 */
export function apply_connection_event(data) {
    const source = data && typeof data === 'object' ? data : {}
    app_status.gateway = {
        ...app_status.gateway,
        tcp_connected: source.tcp_connected === true,
        registered: source.registered === true,
        backend_online: source.backend_online === true,
    }
    if (typeof source.client_id === 'string') {
        app_status.ws_client_id = source.client_id
    }
}

/**
 * 应用 GET /api/gateway/status 的查询结果。
 * 入参：data { tcp_connected, registered, backend_online, clients, last_error }。
 * 返回：无。
 */
export function apply_gateway_status(data) {
    const source = data && typeof data === 'object' ? data : {}
    app_status.gateway = {
        tcp_connected: source.tcp_connected === true,
        registered: source.registered === true,
        backend_online: source.backend_online === true,
        clients: Number.isFinite(Number(source.clients)) ? Number(source.clients) : 0,
        last_error: source.last_error === undefined ? null : source.last_error,
    }
    app_status.gateway_last_updated_ms = Date.now()
    app_status.gateway_error = null
}

/**
 * 记录网关状态查询失败信息（界面顶栏据此显示离线）。
 * 入参：error ApiError 或普通 Error。
 * 返回：无。
 */
export function set_gateway_error(error) {
    app_status.gateway_error = error
}

/**
 * 获取应用级连接状态组合式接口。
 * 返回：{ app_status, ws_connected, backend_online, gateway_registered, gateway_tcp_connected }。
 */
export function use_app_status() {
    const ws_connected = computed(() => app_status.ws_state === WS_STATE.CONNECTED)
    const backend_online = computed(() => app_status.gateway.backend_online === true)
    const gateway_registered = computed(() => app_status.gateway.registered === true)
    const gateway_tcp_connected = computed(() => app_status.gateway.tcp_connected === true)
    return {
        app_status,
        ws_connected,
        backend_online,
        gateway_registered,
        gateway_tcp_connected,
    }
}
