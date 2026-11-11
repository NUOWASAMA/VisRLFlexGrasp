// 文件功能：机器人/运动规划服务状态共享状态与刷新逻辑（GET /api/robot/status），供总览页与机器人状态页复用
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11
import { reactive, readonly } from 'vue'
import { backend_api } from '../api/backend_api.js'
import { format_error } from '../utils/format.js'
import { push_event } from './use_event_log.js'

const robot_state = reactive({
    data: null,
    error: null,
    loading: false,
    last_updated_ms: 0,
})

// 记录上一次是否失败，用于失败/恢复只记录一次事件日志，避免轮询刷屏
let failed_before = false

/**
 * 刷新机器人状态；并发调用时直接复用进行中的请求结果。
 * 返回：Promise<robot_state>。
 */
export async function refresh_robot_status() {
    if (robot_state.loading) {
        return robot_state
    }
    robot_state.loading = true
    try {
        const data = await backend_api.get_robot_status()
        robot_state.data = data && typeof data === 'object' ? data : {}
        robot_state.error = null
        robot_state.last_updated_ms = Date.now()
        if (failed_before) {
            failed_before = false
            push_event({ source: 'http', level: 'success', message: '机器人状态查询已恢复' })
        }
    } catch (error) {
        robot_state.error = error
        if (!failed_before) {
            failed_before = true
            push_event({
                source: 'http',
                level: 'error',
                message: `机器人状态查询失败：${format_error(error)}`,
            })
        }
    } finally {
        robot_state.loading = false
    }
    return robot_state
}

/**
 * 获取机器人状态组合式接口。
 * 返回：{ robot_state, refresh_robot_status }。
 */
export function use_robot_status() {
    return {
        robot_state: readonly(robot_state),
        refresh_robot_status,
    }
}
