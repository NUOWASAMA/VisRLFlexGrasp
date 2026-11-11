// 文件功能：应用级网关配置加载（GET /api/gateway/config），失败时降级为内默认配置并保持界面可用
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11
import { reactive } from 'vue'
import { backend_api } from '../api/backend_api.js'
import { DEFAULT_UI_CONFIG, WS_PATH } from '../config/defaults.js'

/**
 * 规范化 ui 配置：数值非法或缺失时回退默认值，数组为空时回退默认数组。
 * 入参：raw_ui 网关返回的 ui 配置对象。
 * 返回：字段完整且类型正确的 ui 配置。
 */
function normalize_ui_config(raw_ui) {
    const source = raw_ui && typeof raw_ui === 'object' ? raw_ui : {}
    const poll_interval_ms = Number(source.poll_interval_ms)
    const default_force_limit = Number(source.default_force_limit)
    const event_log_limit = Number(source.event_log_limit)
    const task_history_limit = Number(source.task_history_limit)
    return {
        poll_interval_ms: Number.isFinite(poll_interval_ms) && poll_interval_ms > 0
            ? Math.round(poll_interval_ms)
            : DEFAULT_UI_CONFIG.poll_interval_ms,
        default_force_limit: Number.isFinite(default_force_limit) && default_force_limit > 0
            ? default_force_limit
            : DEFAULT_UI_CONFIG.default_force_limit,
        categories: Array.isArray(source.categories) && source.categories.length > 0
            ? source.categories.map((item) => String(item))
            : [...DEFAULT_UI_CONFIG.categories],
        speed_levels: Array.isArray(source.speed_levels) && source.speed_levels.length > 0
            ? source.speed_levels.map((item) => Number(item))
            : [...DEFAULT_UI_CONFIG.speed_levels],
        event_log_limit: Number.isFinite(event_log_limit) && event_log_limit > 0
            ? Math.round(event_log_limit)
            : DEFAULT_UI_CONFIG.event_log_limit,
        task_history_limit: Number.isFinite(task_history_limit) && task_history_limit > 0
            ? Math.round(task_history_limit)
            : DEFAULT_UI_CONFIG.task_history_limit,
    }
}

// 应用级配置：main.js 挂载前加载一次，各视图与组合式函数只读引用
const app_config = reactive({
    loaded: false,
    loading: false,
    error: null,
    env: '',
    ui: normalize_ui_config(DEFAULT_UI_CONFIG),
    gateway: {
        host: '',
        port: 0,
        ws_path: WS_PATH,
    },
    backend: {
        http: {
            host: '',
            port: 0,
        },
    },
})

/**
 * 获取应用级配置响应式对象。
 * 返回：app_config（只读使用）。
 */
export function use_app_config() {
    return app_config
}

/**
 * 加载网关配置；失败时记录错误并保留默认值，不阻塞页面渲染。
 * 返回：Promise<app_config>。
 */
export async function load_app_config() {
    if (app_config.loading) {
        return app_config
    }
    app_config.loading = true
    try {
        const data = await backend_api.get_gateway_config()
        const source = data && typeof data === 'object' ? data : {}
        app_config.env = typeof source.env === 'string' ? source.env : ''
        app_config.ui = normalize_ui_config(source.ui)
        if (source.gateway && typeof source.gateway === 'object') {
            app_config.gateway = {
                host: typeof source.gateway.host === 'string' ? source.gateway.host : '',
                port: Number(source.gateway.port) || 0,
                ws_path: typeof source.gateway.ws_path === 'string' && source.gateway.ws_path.startsWith('/')
                    ? source.gateway.ws_path
                    : WS_PATH,
            }
        }
        if (source.backend && source.backend.http && typeof source.backend.http === 'object') {
            app_config.backend = {
                http: {
                    host: typeof source.backend.http.host === 'string' ? source.backend.http.host : '',
                    port: Number(source.backend.http.port) || 0,
                },
            }
        }
        app_config.loaded = true
        app_config.error = null
    } catch (error) {
        app_config.error = error
    } finally {
        app_config.loading = false
    }
    return app_config
}
