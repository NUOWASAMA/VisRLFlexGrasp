// 文件功能：界面运行参数（轮询周期、默认夹持力、默认品类、默认速度等级）的本地覆盖与校验，持久化到 localStorage
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11
import { computed, reactive } from 'vue'
import {
    DEFAULT_UI_CONFIG,
    FORCE_LIMIT_MAX,
    FORCE_LIMIT_MIN,
    POLL_INTERVAL_MAX_MS,
    POLL_INTERVAL_MIN_MS,
    STORAGE_KEYS,
} from '../config/defaults.js'
import { read_json, remove_key, write_json } from '../utils/storage.js'
import { use_app_config } from './use_app_config.js'

// 本地覆盖值：null 表示跟随网关 /api/gateway/config 的 ui 默认值
const overrides = reactive({
    poll_interval_ms: null,
    default_force_limit: null,
    default_category: null,
    default_speed_level: null,
})

/**
 * 判断轮询周期是否合法。
 * 入参：value 待校验值。
 * 返回：布尔值。
 */
function is_valid_poll_interval(value) {
    const numeric_value = Number(value)
    return Number.isFinite(numeric_value)
        && numeric_value >= POLL_INTERVAL_MIN_MS
        && numeric_value <= POLL_INTERVAL_MAX_MS
}

/**
 * 判断夹持力是否合法（单位牛顿，上限与嵌入式最大夹持力配置一致）。
 * 入参：value 待校验值。
 * 返回：布尔值。
 */
function is_valid_force_limit(value) {
    const numeric_value = Number(value)
    return Number.isFinite(numeric_value)
        && numeric_value >= FORCE_LIMIT_MIN
        && numeric_value <= FORCE_LIMIT_MAX
}

/**
 * 从 localStorage 恢复本地覆盖值；非法字段直接丢弃，回退网关默认值。
 * 返回：无。
 */
export function load_settings() {
    const stored = read_json(STORAGE_KEYS.UI_SETTINGS, null)
    if (!stored || typeof stored !== 'object') {
        return
    }
    if (is_valid_poll_interval(stored.poll_interval_ms)) {
        overrides.poll_interval_ms = Math.round(Number(stored.poll_interval_ms))
    }
    if (is_valid_force_limit(stored.default_force_limit)) {
        overrides.default_force_limit = Number(stored.default_force_limit)
    }
    if (typeof stored.default_category === 'string') {
        overrides.default_category = stored.default_category
    }
    if (Number.isFinite(Number(stored.default_speed_level))) {
        overrides.default_speed_level = Number(stored.default_speed_level)
    }
}

/**
 * 保存界面运行参数：先校验再写入本地存储。
 * 入参：patch { poll_interval_ms, default_force_limit, default_category, default_speed_level }，
 *       值为 null 表示恢复跟随网关默认值。
 * 返回：{ ok: boolean, errors: string[] }。
 */
function save_settings(patch) {
    const errors = []
    const next = { ...patch }
    if (next.poll_interval_ms !== null && next.poll_interval_ms !== undefined) {
        if (!is_valid_poll_interval(next.poll_interval_ms)) {
            errors.push(`轮询周期需在 ${POLL_INTERVAL_MIN_MS} ~ ${POLL_INTERVAL_MAX_MS} 毫秒之间`)
        } else {
            next.poll_interval_ms = Math.round(Number(next.poll_interval_ms))
        }
    } else {
        next.poll_interval_ms = null
    }
    if (next.default_force_limit !== null && next.default_force_limit !== undefined) {
        if (!is_valid_force_limit(next.default_force_limit)) {
            errors.push(`默认夹持力需在 ${FORCE_LIMIT_MIN} ~ ${FORCE_LIMIT_MAX} 牛顿之间`)
        } else {
            next.default_force_limit = Number(next.default_force_limit)
        }
    } else {
        next.default_force_limit = null
    }
    if (next.default_category !== null && next.default_category !== undefined) {
        const categories = use_app_config().ui.categories
        if (next.default_category !== '' && !categories.includes(next.default_category)) {
            errors.push('默认品类不在网关配置的品类列表内')
        } else {
            next.default_category = String(next.default_category)
        }
    } else {
        next.default_category = null
    }
    if (next.default_speed_level !== null && next.default_speed_level !== undefined) {
        const speed_levels = use_app_config().ui.speed_levels
        if (!speed_levels.includes(Number(next.default_speed_level))) {
            errors.push('默认速度等级不在网关配置的速度等级列表内')
        } else {
            next.default_speed_level = Number(next.default_speed_level)
        }
    } else {
        next.default_speed_level = null
    }
    if (errors.length > 0) {
        return { ok: false, errors }
    }
    overrides.poll_interval_ms = next.poll_interval_ms
    overrides.default_force_limit = next.default_force_limit
    overrides.default_category = next.default_category
    overrides.default_speed_level = next.default_speed_level
    write_json(STORAGE_KEYS.UI_SETTINGS, {
        poll_interval_ms: overrides.poll_interval_ms,
        default_force_limit: overrides.default_force_limit,
        default_category: overrides.default_category,
        default_speed_level: overrides.default_speed_level,
    })
    return { ok: true, errors: [] }
}

/**
 * 清除本地覆盖值，恢复为网关 ui 默认配置。
 * 返回：无。
 */
function reset_settings() {
    overrides.poll_interval_ms = null
    overrides.default_force_limit = null
    overrides.default_category = null
    overrides.default_speed_level = null
    remove_key(STORAGE_KEYS.UI_SETTINGS)
}

/**
 * 获取界面运行参数组合式接口。
 * 返回：{ effective, overrides, has_overrides, save_settings, reset_settings }。
 */
export function use_settings() {
    const app_config = use_app_config()
    const effective = computed(() => {
        const ui = app_config.ui
        const categories = Array.isArray(ui.categories) ? ui.categories : [...DEFAULT_UI_CONFIG.categories]
        const speed_levels = Array.isArray(ui.speed_levels) ? ui.speed_levels : [...DEFAULT_UI_CONFIG.speed_levels]
        const poll_interval_ms = overrides.poll_interval_ms ?? ui.poll_interval_ms
        const default_force_limit = overrides.default_force_limit ?? ui.default_force_limit
        const override_category = overrides.default_category
        const default_category = override_category !== null
            && (override_category === '' || categories.includes(override_category))
            ? override_category
            : (categories[0] ?? '')
        const default_speed_level = speed_levels.includes(Number(overrides.default_speed_level))
            ? Number(overrides.default_speed_level)
            : (speed_levels[0] ?? null)
        return {
            poll_interval_ms,
            default_force_limit,
            default_category,
            default_speed_level,
        }
    })
    const has_overrides = computed(() => (
        overrides.poll_interval_ms !== null
        || overrides.default_force_limit !== null
        || overrides.default_category !== null
        || overrides.default_speed_level !== null
    ))
    return {
        effective,
        overrides,
        has_overrides,
        save_settings,
        reset_settings,
    }
}
