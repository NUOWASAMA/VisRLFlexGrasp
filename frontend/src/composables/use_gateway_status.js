// 文件功能：网关连接状态查询（GET /api/gateway/status），失败/恢复只记录一次事件日志并按轮询周期刷新
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11
import { backend_api } from '../api/backend_api.js'
import { format_error } from '../utils/format.js'
import { apply_gateway_status, set_gateway_error } from './use_app_status.js'
import { push_event } from './use_event_log.js'

// 记录失败状态迁移，避免轮询失败时日志刷屏
let failed_before = false

/**
 * 查询前端网关连接状态并写入应用级状态。
 * 返回：Promise<void>；异常已内部记录，不向上抛出。
 */
export async function refresh_gateway_status() {
    try {
        const data = await backend_api.get_gateway_status()
        apply_gateway_status(data)
        if (failed_before) {
            failed_before = false
            push_event({ source: 'http', level: 'success', message: '前端网关状态查询已恢复' })
        }
    } catch (error) {
        set_gateway_error(error)
        if (!failed_before) {
            failed_before = true
            push_event({
                source: 'http',
                level: 'error',
                message: `前端网关状态查询失败：${format_error(error)}`,
            })
        }
    }
}

/**
 * 获取网关状态刷新接口。
 * 返回：{ refresh_gateway_status }。
 */
export function use_gateway_status() {
    return { refresh_gateway_status }
}
