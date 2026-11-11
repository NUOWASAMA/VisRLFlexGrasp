// 文件功能：任务查询历史（localStorage 持久化，按 ui.task_history_limit 上限保留，支持新增、删除与清空）
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11
import { readonly, ref } from 'vue'
import { DEFAULT_UI_CONFIG, STORAGE_KEYS } from '../config/defaults.js'
import { read_json, write_json } from '../utils/storage.js'
import { use_app_config } from './use_app_config.js'

const history = ref([])
let loaded = false

/**
 * 计算当前任务历史上限：优先取网关 ui 配置，非法时回退默认常量。
 * 返回：正整数上限。
 */
function resolve_history_limit() {
    const limit = Number(use_app_config().ui.task_history_limit)
    if (!Number.isFinite(limit) || limit <= 0) {
        return DEFAULT_UI_CONFIG.task_history_limit
    }
    return Math.round(limit)
}

/**
 * 判断存储中的历史条目结构是否合法。
 * 入参：entry 待校验条目。
 * 返回：布尔值。
 */
function is_valid_entry(entry) {
    return Boolean(entry)
        && typeof entry === 'object'
        && typeof entry.task_id === 'string'
        && entry.task_id.trim() !== ''
}

/**
 * 将内存中的历史写回 localStorage；失败时静默降级为仅内存。
 * 返回：无。
 */
function persist_history() {
    write_json(STORAGE_KEYS.TASK_HISTORY, history.value)
}

/**
 * 从 localStorage 恢复任务历史（应用启动时调用一次）。
 * 返回：无。
 */
export function load_task_history() {
    if (loaded) {
        return
    }
    loaded = true
    const stored = read_json(STORAGE_KEYS.TASK_HISTORY, [])
    if (!Array.isArray(stored)) {
        return
    }
    history.value = stored.filter(is_valid_entry).slice(0, resolve_history_limit())
}

/**
 * 新增或更新一条任务历史（同一 task_id 只保留最新记录，新的在最前）。
 * 入参：record 任务详情对象（含 task_id / status / created_at / updated_at）。
 * 返回：无。
 */
export function add_task_history_entry(record) {
    if (!record || typeof record !== 'object') {
        return
    }
    const task_id = String(record.task_id || '').trim()
    if (!task_id) {
        return
    }
    const entry = {
        task_id,
        status: typeof record.status === 'string' ? record.status : '',
        updated_at: Number(record.updated_at) || Number(record.created_at) || Date.now(),
        recorded_at: Date.now(),
    }
    const remaining = history.value.filter((item) => item.task_id !== task_id)
    history.value = [entry, ...remaining].slice(0, resolve_history_limit())
    persist_history()
}

/**
 * 删除一条任务历史。
 * 入参：task_id 任务 ID。
 * 返回：无。
 */
export function remove_task_history_entry(task_id) {
    const normalized_id = String(task_id || '').trim()
    history.value = history.value.filter((item) => item.task_id !== normalized_id)
    persist_history()
}

/**
 * 清空任务历史。
 * 返回：无。
 */
export function clear_task_history() {
    history.value = []
    persist_history()
}

/**
 * 获取任务历史组合式接口。
 * 返回：{ history, load_task_history, add_task_history_entry, remove_task_history_entry, clear_task_history }。
 */
export function use_task_history() {
    return {
        history: readonly(history),
        load_task_history,
        add_task_history_entry,
        remove_task_history_entry,
        clear_task_history,
    }
}
