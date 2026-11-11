<!--
    文件功能：任务查询页：按 task_id 查询规划任务详情（状态/请求/结果/错误/时间），并维护 localStorage 本地历史
    作者：VisRLFlexGrasp 项目组
    创建日期：2026-11-11
-->
<script setup>
import { computed, ref } from 'vue'

import { backend_api } from '../api/backend_api.js'
import JointTrajectoryChart from '../components/JointTrajectoryChart.vue'
import TaskDetailPanel from '../components/TaskDetailPanel.vue'
import { TASK_ID_MAX_LENGTH } from '../config/defaults.js'
import { use_event_log } from '../composables/use_event_log.js'
import { use_task_history } from '../composables/use_task_history.js'
import {
    format_error,
    format_time_ms,
    get_task_status_label,
    get_task_status_tone,
} from '../utils/format.js'

const { push_event } = use_event_log()
const {
    history,
    add_task_history_entry,
    remove_task_history_entry,
    clear_task_history,
} = use_task_history()

const task_id_input = ref('')
const active_task = ref(null)
const loading = ref(false)
const error_text = ref('')

const current_task_id = computed(() => (active_task.value ? active_task.value.task_id : ''))
const is_planning = computed(() => Boolean(active_task.value && active_task.value.status === 'planning'))

/**
 * 查询任务详情并刷新本地历史。
 * 入参：task_id 任务 ID。
 * 返回：Promise<void>。
 */
async function query_task(task_id) {
    const normalized_id = String(task_id || '').trim()
    error_text.value = ''
    if (!normalized_id) {
        error_text.value = '请输入要查询的任务 ID'
        return
    }
    if (normalized_id.length > TASK_ID_MAX_LENGTH) {
        error_text.value = `任务 ID 长度不能超过 ${TASK_ID_MAX_LENGTH} 个字符`
        return
    }
    loading.value = true
    try {
        const record = await backend_api.get_task(normalized_id)
        active_task.value = record
        task_id_input.value = normalized_id
        add_task_history_entry(record)
        push_event({
            source: 'http',
            level: record.status === 'planned' ? 'success' : 'info',
            message: `任务查询成功：${normalized_id}（${get_task_status_label(record.status)}）`,
        })
    } catch (error) {
        error_text.value = format_error(error)
        push_event({ source: 'http', level: 'error', message: `任务查询失败：${format_error(error)}` })
    } finally {
        loading.value = false
    }
}

/**
 * 提交查询表单。
 * 返回：无。
 */
function handle_query() {
    query_task(task_id_input.value)
}

/**
 * 重新查询当前任务。
 * 返回：无。
 */
function handle_refresh_current() {
    if (current_task_id.value) {
        query_task(current_task_id.value)
    }
}

/**
 * 点击历史条目重新查询。
 * 入参：entry 历史条目 { task_id }。
 * 返回：无。
 */
function handle_history_click(entry) {
    query_task(entry.task_id)
}

/**
 * 清空本地任务历史。
 * 返回：无。
 */
function handle_clear_history() {
    clear_task_history()
    push_event({ source: 'system', level: 'info', message: '已清空本地任务查询历史' })
}
</script>

<template>
    <div class="task-view">
        <div class="page-header">
            <div>
                <h1 class="page-title">任务查询</h1>
                <p class="page-subtitle">GET /api/tasks/{task_id} · 查询请求、规划结果、错误与时间信息</p>
            </div>
            <div class="page-header-actions">
                <span class="chip">
                    <span class="text-muted">历史记录</span>
                    <strong class="text-mono">{{ history.length }} 条</strong>
                </span>
            </div>
        </div>

        <section class="panel query-panel">
            <div class="panel-body">
                <form class="query-form" @submit.prevent="handle_query">
                    <div class="field query-field">
                        <label class="field-label" for="task-query-input">规划任务 ID</label>
                        <input
                            id="task-query-input"
                            v-model="task_id_input"
                            class="input input--mono"
                            type="text"
                            :maxlength="TASK_ID_MAX_LENGTH"
                            placeholder="输入后端返回的 task_id，例如 6f1c…（32 位十六进制）"
                            autocomplete="off"
                        />
                    </div>
                    <div class="btn-row query-actions">
                        <button class="btn btn--primary" type="submit" :disabled="loading">
                            {{ loading ? '查询中…' : '查询任务' }}
                        </button>
                        <button
                            class="btn btn--ghost"
                            type="button"
                            :disabled="!current_task_id || loading"
                            @click="handle_refresh_current"
                        >
                            刷新当前任务
                        </button>
                    </div>
                </form>
                <p v-if="error_text" class="notice notice--error query-notice">
                    <span>{{ error_text }}</span>
                </p>
                <p v-else-if="is_planning" class="notice notice--info query-notice">
                    <span>任务仍在规划中，可稍后点击「刷新当前任务」查看终态。</span>
                </p>
            </div>
        </section>

        <div class="panel-grid panel-grid--detail">
            <TaskDetailPanel :task="active_task" empty_text="请输入任务 ID 查询，或从右侧历史记录中选择" />

            <section class="panel">
                <header class="panel-header">
                    <div class="panel-heading">
                        <h2 class="panel-title">本地查询历史</h2>
                        <span class="panel-subtitle">保存在浏览器 localStorage，仅保留最近记录</span>
                    </div>
                    <div class="panel-actions">
                        <button
                            class="btn btn--danger-ghost btn--sm"
                            type="button"
                            :disabled="history.length === 0"
                            @click="handle_clear_history"
                        >
                            清空历史
                        </button>
                    </div>
                </header>
                <div class="panel-body panel-body--flush">
                    <div v-if="history.length === 0" class="history-empty">
                        <div class="empty-state">
                            <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path
                                    d="M12 8v5l3 2M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z"
                                    stroke="currentColor"
                                    stroke-width="1.6"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                />
                            </svg>
                            <span>暂无查询历史，成功查询任务后自动记录</span>
                        </div>
                    </div>
                    <ul v-else class="history-list">
                        <li v-for="entry in history" :key="entry.task_id" class="history-item">
                            <button class="history-main" type="button" @click="handle_history_click(entry)">
                                <span class="history-task-id text-mono">{{ entry.task_id }}</span>
                                <span class="history-meta">
                                    <span class="badge" :class="'badge--' + get_task_status_tone(entry.status)">
                                        {{ get_task_status_label(entry.status) }}
                                    </span>
                                    <span class="text-muted text-sm">{{ format_time_ms(entry.recorded_at) }}</span>
                                </span>
                            </button>
                            <button
                                class="history-remove"
                                type="button"
                                title="从历史中删除"
                                aria-label="从历史中删除"
                                @click="remove_task_history_entry(entry.task_id)"
                            >
                                ×
                            </button>
                        </li>
                    </ul>
                </div>
            </section>
        </div>

        <JointTrajectoryChart :task="active_task" title="查询任务六轴关节轨迹" />
    </div>
</template>

<style scoped>
.query-panel {
    margin-bottom: 18px;
}

.query-form {
    display: flex;
    align-items: flex-end;
    gap: 14px;
    flex-wrap: wrap;
}

.query-field {
    flex: 1;
    min-width: 260px;
}

.query-actions {
    padding-bottom: 1px;
}

.query-notice {
    margin-top: 12px;
}

.history-empty {
    padding: 16px 20px 20px;
}

.history-list {
    max-height: 420px;
    overflow-y: auto;
}

.history-item {
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid var(--color-border);
}

.history-item:last-child {
    border-bottom: none;
}

.history-main {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 10px 14px 10px 20px;
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
    min-width: 0;
    transition: background-color var(--transition-fast);
}

.history-main:hover {
    background: var(--color-surface-muted);
}

.history-task-id {
    font-size: 12.5px;
    color: var(--color-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
}

.history-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.history-remove {
    width: 38px;
    border: none;
    border-left: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text-muted);
    font-size: 17px;
    line-height: 1;
    cursor: pointer;
    transition: background-color var(--transition-fast), color var(--transition-fast);
}

.history-remove:hover {
    background: var(--color-error-soft);
    color: var(--color-error);
}
</style>
