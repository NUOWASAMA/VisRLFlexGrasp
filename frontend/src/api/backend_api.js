// 文件功能：后端接口语义封装（前端网关 /api 代理），统一维护接口路径与调用方式，视图层不直接拼接 URL
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11
import { API_PATHS, API_PREFIX, TASK_ID_MAX_LENGTH, VALID_ENV_MODES } from '../config/defaults.js'
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
     * 查询运行环境模式（仿真 / 真实）与硬件可用性。
     * 返回：{ mode, available_modes, hardware: { available, controller, ... }, degraded, updated_at }。
     */
    function get_system_mode() {
        return http_client.get(API_PATHS.SYSTEM_MODE)
    }

    /**
     * 切换运行环境模式并持久化到后端。
     * 入参：mode 目标模式，取值 sim / real；request_options 透传 HTTP 超时等选项。
     * 返回：切换后的完整环境状态（结构同 get_system_mode）。
     */
    function switch_system_mode(mode, request_options = {}) {
        const normalized_mode = String(mode || '').trim()
        if (!VALID_ENV_MODES.includes(normalized_mode)) {
            throw new ApiError({
                code: 1000,
                msg: '运行环境模式必须为 sim 或 real',
            })
        }
        return http_client.post(API_PATHS.SYSTEM_MODE, { mode: normalized_mode }, request_options)
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
        get_system_mode,
        switch_system_mode,
        submit_plan,
        get_task,
    }
}

// 默认客户端：同源 /api 前缀；如需自定义（测试或跨域）可通过 create_backend_api 注入
export const http_client = create_http_client({ base_url: API_PREFIX })
export const backend_api = create_backend_api(http_client)
