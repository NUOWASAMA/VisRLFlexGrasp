// 文件功能：localStorage 安全封装（统一前缀、JSON 序列化、异常降级），用于界面参数与任务历史持久化
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11
import { STORAGE_PREFIX } from '../config/defaults.js'

/**
 * 拼接带应用前缀的完整存储键。
 * 入参：key 业务键名（STORAGE_KEYS 中的值）。
 * 返回：形如 visrl_flex_grasp:ui_settings 的完整键名。
 */
export function build_storage_key(key) {
    return `${STORAGE_PREFIX}:${key}`
}

/**
 * 判断当前运行环境是否可用 localStorage（隐私模式或被禁用时返回 false）。
 * 返回：布尔值。
 */
function is_storage_available() {
    try {
        if (typeof window === 'undefined' || !window.localStorage) {
            return false
        }
        const probe_key = build_storage_key('probe')
        window.localStorage.setItem(probe_key, '1')
        window.localStorage.removeItem(probe_key)
        return true
    } catch (error) {
        return false
    }
}

/**
 * 读取并反序列化 JSON 数据。
 * 入参：key 业务键名；fallback 读取失败或数据非法时的兜底值。
 * 返回：解析后的数据或 fallback；任何异常均降级为 fallback，不向上抛出。
 */
export function read_json(key, fallback = null) {
    if (!is_storage_available()) {
        return fallback
    }
    try {
        const raw_value = window.localStorage.getItem(build_storage_key(key))
        if (raw_value === null) {
            return fallback
        }
        const parsed_value = JSON.parse(raw_value)
        return parsed_value === null || parsed_value === undefined ? fallback : parsed_value
    } catch (error) {
        return fallback
    }
}

/**
 * 序列化并写入 JSON 数据。
 * 入参：key 业务键名；value 可 JSON 序列化的数据。
 * 返回：写入成功返回 true；存储不可用或超限返回 false，不向上抛出。
 */
export function write_json(key, value) {
    if (!is_storage_available()) {
        return false
    }
    try {
        window.localStorage.setItem(build_storage_key(key), JSON.stringify(value))
        return true
    } catch (error) {
        return false
    }
}

/**
 * 删除指定业务键。
 * 入参：key 业务键名。
 * 返回：无。
 */
export function remove_key(key) {
    if (!is_storage_available()) {
        return
    }
    try {
        window.localStorage.removeItem(build_storage_key(key))
    } catch (error) {
        // 存储不可用时静默降级，界面继续以内存状态运行
    }
}
