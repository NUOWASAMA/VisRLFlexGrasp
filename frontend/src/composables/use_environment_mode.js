// 文件功能：运行环境模式（仿真 / 真实）全局状态：读取并切换后端 /api/system/mode，应用主题并持久化本地选择
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-14
import { reactive } from 'vue'

import { backend_api } from '../api/backend_api.js'
import {
    DEFAULT_ENV_MODE,
    ENV_MODES,
    MODE_SWITCH_TIMEOUT_MS,
    STORAGE_KEYS,
    VALID_ENV_MODES,
} from '../config/defaults.js'
import { read_json, write_json } from '../utils/storage.js'

// 后端不可达时展示的硬件说明兜底文案，与后端 real 降级语义保持一致
const FALLBACK_HARDWARE = {
    available: false,
    controller: 'UR5',
    controller_connected: false,
    adapter: 'unavailable',
    reason: '未读取到后端环境状态，当前为本地模式',
}

// 全局单例状态：入口页、顶栏与图表共用；字段与 /system/mode 返回结构一致
const environment_state = reactive({
    mode: DEFAULT_ENV_MODE,
    available_modes: [...VALID_ENV_MODES],
    hardware: { ...FALLBACK_HARDWARE },
    degraded: false,
    updated_at: 0,
    loaded: false,
    loading: false,
    switching: false,
    error: null,
})

/**
 * 规范化模式取值：非法值回退默认仿真模式。
 * 入参：value 原始模式值。
 * 返回：'sim' 或 'real'。
 */
function normalize_mode(value) {
    return VALID_ENV_MODES.includes(value) ? value : DEFAULT_ENV_MODE
}

/**
 * 把模式写入根元素 data-env-mode，驱动 theme.css 的主题变量切换。
 * 入参：mode 模式值。
 * 返回：规范化后的模式值。
 */
export function apply_environment_theme(mode) {
    const normalized_mode = normalize_mode(mode)
    if (typeof document !== 'undefined') {
        document.documentElement.dataset.envMode = normalized_mode
    }
    return normalized_mode
}

/**
 * 把后端状态写入全局响应式对象。
 * 入参：data 后端 /system/mode 的 data 字段；fallback_mode 缺失时的兜底模式。
 * 返回：无。
 */
function apply_remote_state(data, fallback_mode) {
    const source = data && typeof data === 'object' ? data : {}
    const mode = apply_environment_theme(source.mode === undefined ? fallback_mode : source.mode)
    environment_state.mode = mode
    environment_state.available_modes = Array.isArray(source.available_modes) && source.available_modes.length > 0
        ? source.available_modes.filter((item) => VALID_ENV_MODES.includes(item))
        : [...VALID_ENV_MODES]
    const hardware = source.hardware && typeof source.hardware === 'object' ? source.hardware : {}
    environment_state.hardware = {
        available: Boolean(hardware.available),
        controller: typeof hardware.controller === 'string' ? hardware.controller : FALLBACK_HARDWARE.controller,
        controller_connected: Boolean(hardware.controller_connected),
        adapter: typeof hardware.adapter === 'string' ? hardware.adapter : FALLBACK_HARDWARE.adapter,
        reason: typeof hardware.reason === 'string' ? hardware.reason : '',
    }
    environment_state.degraded = mode === ENV_MODES.REAL && !environment_state.hardware.available
    environment_state.updated_at = Number(source.updated_at) || 0
    environment_state.loaded = true
    environment_state.error = null
    write_json(STORAGE_KEYS.ENV_MODE, { mode })
}

/**
 * 读取本地记录的模式并立即应用主题，保证刷新后主题不闪烁。
 * 返回：本地模式值。
 */
function restore_local_mode() {
    const stored = read_json(STORAGE_KEYS.ENV_MODE, null)
    const stored_mode = stored && typeof stored === 'object' ? normalize_mode(stored.mode) : DEFAULT_ENV_MODE
    environment_state.mode = apply_environment_theme(stored_mode)
    return stored_mode
}

/**
 * 从后端读取环境状态；失败时保留本地模式并记录错误，不阻塞界面。
 * 返回：Promise<environment_state>。
 */
export async function load_environment_mode() {
    if (environment_state.loading) {
        return environment_state
    }
    environment_state.loading = true
    try {
        const data = await backend_api.get_system_mode()
        apply_remote_state(data, environment_state.mode)
    } catch (error) {
        environment_state.error = error
        environment_state.hardware = { ...FALLBACK_HARDWARE }
        environment_state.degraded = environment_state.mode === ENV_MODES.REAL
        environment_state.loaded = true
    } finally {
        environment_state.loading = false
    }
    return environment_state
}

/**
 * 切换运行环境模式：调用后端持久化；失败时抛出 ApiError 由入口页兜底处理。
 * 入参：mode 目标模式（sim / real）。
 * 返回：Promise<environment_state>。
 * 异常：后端不可达、超时或参数非法时抛出 ApiError。
 */
export async function switch_environment_mode(mode) {
    const target_mode = normalize_mode(mode)
    environment_state.switching = true
    environment_state.error = null
    try {
        const data = await backend_api.switch_system_mode(target_mode, { timeout_ms: MODE_SWITCH_TIMEOUT_MS })
        apply_remote_state(data, target_mode)
        return environment_state
    } catch (error) {
        environment_state.error = error
        throw error
    } finally {
        environment_state.switching = false
    }
}

/**
 * 后端不可达时的本地降级切换：只切换本地主题并持久化，界面照常进入。
 * 入参：mode 目标模式。
 * 返回：无。
 */
export function apply_local_environment_mode(mode) {
    const target_mode = apply_environment_theme(mode)
    environment_state.mode = target_mode
    environment_state.degraded = target_mode === ENV_MODES.REAL && !environment_state.hardware.available
    environment_state.loaded = true
    write_json(STORAGE_KEYS.ENV_MODE, { mode: target_mode })
}

/**
 * 应用启动时初始化：先恢复本地主题（防闪烁），再异步同步后端状态。
 * 返回：无。
 */
export function init_environment_mode() {
    restore_local_mode()
    void load_environment_mode()
}

/**
 * 获取运行环境全局响应式状态。
 * 返回：environment_state（只读使用）。
 */
export function use_environment_mode() {
    return environment_state
}

/**
 * 当前是否处于真实环境模式。
 * 返回：布尔值。
 */
export function is_real_environment() {
    return environment_state.mode === ENV_MODES.REAL
}
