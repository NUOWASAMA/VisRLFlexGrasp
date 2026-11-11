// 文件功能：后端接口语义封装（前端网关 /api 代理），统一维护接口路径与调用方式，视图层不直接拼接 URL
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11
import { API_PATHS, API_PREFIX, TASK_ID_MAX_LENGTH } from '../config/defaults.js'
import { ApiError, create_http_client } from './http_client.js'

/**
 * 基于 HTTP 客户端构建后端接口集合。
 * 入参：http_client create_http_client 创建的客户端实例（便于测试注入 baseURL 与 fetch）。
 * 返回：get_gateway_config / get_gateway_status / get_health / get_robot_status / submit_plan / get_task。
 */
export function create_backend_api(http_client) {
    /**
     * 查询网关运行配置（env、ui 默认值、gateway 与 backend 地址）。
     * 返回：{ env, ui, gateway, backend }。
     */
    function get_gateway_config() {
        return http_client.get(API_PATHS.GATEWAY_CONFIG)
    }

    /**
     * 查询网关连接状态（TCP 连接、模块注册、后端在线、客户端数与最近错误）。
     * 返回：{ tcp_connected, registered, backend_online, clients, last_error }。
     */
    function get_gateway_status() {
        return http_client.get(API_PATHS.GATEWAY_STATUS)
    }

    /**
     * 查询后端健康状态。
     * 返回：{ status, execution_mode }。
     */
    function get_health() {
        return http_client.get(API_PATHS.HEALTH)
    }

    /**
     * 查询机器人/运动规划服务状态。
     * 返回：motion_online、busy、active_task_id、planning_reference 等字段。
     */
    function get_robot_status() {
        return http_client.get(API_PATHS.ROBOT_STATUS)
    }

    /**
     * 提交规划请求（仅规划，不执行）。
     * 入参：request { grasp_pose: { position: [x,y,z], orientation: [qx,qy,qz,qw] }, force_limit }。
     * 返回：{ task_id, status: 'planning', task_url }；忙碌/参数非法/离线由 ApiError 携带业务错误码。
     */
    function submit_plan(request) {
        return http_client.post(API_PATHS.ROBOT_PLAN, request)
    }

    /**
     * 查询规划任务详情。
     * 入参：task_id 任务 ID。
     * 返回：{ task_id, status, request, result, error, created_at, updated_at }。
     * 异常：task_id 非法时直接抛出 1000；任务不存在抛出 1004（ApiError）。
     */
    function get_task(task_id) {
        const normalized_id = String(task_id || '').trim()
        if (!normalized_id || normalized_id.length > TASK_ID_MAX_LENGTH) {
            throw new ApiError({
                code: 1000,
                msg: 'task_id 不允许为空且长度不能超过 256',
            })
        }
        return http_client.get(`${API_PATHS.TASK_PREFIX}${encodeURIComponent(normalized_id)}`)
    }

    return {
        get_gateway_config,
        get_gateway_status,
        get_health,
        get_robot_status,
        submit_plan,
        get_task,
    }
}

// 默认客户端：同源 /api 前缀；如需自定义（测试或跨域）可通过 create_backend_api 注入
export const http_client = create_http_client({ base_url: API_PREFIX })
export const backend_api = create_backend_api(http_client)
