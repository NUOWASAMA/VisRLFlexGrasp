<!--
    文件功能：总览页：分拣任务控制、规划提交、状态卡、六轴关节轨迹与事件日志，并轮询机器人状态
    作者：VisRLFlexGrasp 项目组
    创建日期：2026-11-11
-->
<script setup>
import { computed, onMounted, ref } from 'vue'

import { backend_api } from '../api/backend_api.js'
import EventLogPanel from '../components/EventLogPanel.vue'
import JointTrajectoryChart from '../components/JointTrajectoryChart.vue'
import PlanSubmitPanel from '../components/PlanSubmitPanel.vue'
import StatusCard from '../components/StatusCard.vue'
import TaskControlPanel from '../components/TaskControlPanel.vue'
import TaskDetailPanel from '../components/TaskDetailPanel.vue'
import { WS_STATE } from '../config/defaults.js'
import { use_app_status } from '../composables/use_app_status.js'
import { use_event_log } from '../composables/use_event_log.js'
import { use_polling } from '../composables/use_polling.js'
import { use_robot_status } from '../composables/use_robot_status.js'
import { use_settings } from '../composables/use_settings.js'
import { use_task_history } from '../composables/use_task_history.js'
import { format_error, format_time_ms, get_task_status_label, WS_STATE_LABELS } from '../utils/format.js'

const { effective } = use_settings()
const { app_status, backend_online } = use_app_status()
const { robot_state, refresh_robot_status } = use_robot_status()
const { push_event } = use_event_log()
const { add_task_history_entry } = use_task_history()

const active_task = ref(null)
const task_loading = ref(false)
const task_error = ref('')

const poll_interval_ms = computed(() => effective.value.poll_interval_ms)

// 总览页轮询机器人状态：周期跟随参数配置中的轮询周期
const { start: start_robot_polling } = use_polling(refresh_robot_status, {
    interval_ms: poll_interval_ms,
    immediate: true,
})

const motion_online = computed(() => Boolean(robot_state.data && robot_state.data.motion_online))
const robot_busy = computed(() => Boolean(robot_state.data && robot_state.data.busy))
const active_planning_task_id = computed(() => {
    const data = robot_state.data
    return data && data.active_task_id ? String(data.active_task_id) : ''
})

const ws_tone = computed(() => {
    if (app_status.ws_state === WS_STATE.CONNECTED) {
        return 'ok'
    }
    if (app_status.ws_state === WS_STATE.CONNECTING) {
        return 'warn'
    }
    return 'error'
})

const status_cards = computed(() => [
    {
        title: '前端网关',
        value: `WebSocket ${WS_STATE_LABELS[app_status.ws_state] || '未知'}`,
        tone: ws_tone.value,
        hint: '开发环境经 Vite 代理 /ws 至前端网关',
        detail: app_status.ws_client_id ? `client_id: ${app_status.ws_client_id}` : '',
    },
    {
        title: '后端调度服务',
        value: backend_online.value ? '在线' : '离线',
        tone: backend_online.value ? 'ok' : 'error',
        hint: `网关 TCP ${app_status.gateway.tcp_connected ? '已连接' : '未连接'}`
            + ` · 模块注册${app_status.gateway.registered ? '已完成' : '未完成'}`,
        detail: app_status.gateway.last_error ? `最近错误：${app_status.gateway.last_error}` : '',
    },
    {
        title: '运动规划服务',
        value: motion_online.value ? '在线' : '离线',
        tone: motion_online.value ? 'ok' : 'error',
        hint: 'C++ 解析逆解与轨迹规划服务',
        detail: active_planning_task_id.value ? `规划任务：${active_planning_task_id.value}` : '',
    },
    {
        title: '当前规划任务',
        value: robot_busy.value ? '忙碌' : '空闲',
        tone: robot_busy.value ? 'warn' : 'ok',
        hint: robot_state.data ? `执行模式：${robot_state.data.execution_mode || 'plan_only'}` : '等待机器人状态数据',
        detail: active_planning_task_id.value,
    },
])

/**
 * 加载指定任务详情并写入本地历史，用于轨迹图与详情展示。
 * 入参：task_id 任务 ID。
 * 返回：Promise<void>。
 */
async function handle_view_task(task_id) {
    if (!task_id) {
        return
    }
    task_loading.value = true
    task_error.value = ''
    try {
        const record = await backend_api.get_task(task_id)
        active_task.value = record
        add_task_history_entry(record)
        push_event({
            source: 'http',
            level: record.status === 'planned' ? 'success' : 'info',
            message: `已加载任务详情：${task_id}（${get_task_status_label(record.status)}）`,
        })
    } catch (error) {
        task_error.value = format_error(error)
        push_event({ source: 'http', level: 'error', message: `任务详情查询失败：${format_error(error)}` })
    } finally {
        task_loading.value = false
    }
}

/**
 * 规划提交轮询到终态后回调：更新轨迹图并写入本地历史。
 * 入参：record 任务详情对象。
 * 返回：无。
 */
function handle_task_loaded(record) {
    if (!record || !record.task_id) {
        return
    }
    active_task.value = record
    add_task_history_entry(record)
}

onMounted(() => {
    start_robot_polling()
})
</script>

<template>
    <div class="dashboard-view">
        <div class="page-header">
            <div>
                <h1 class="page-title">运行总览</h1>
                <p class="page-subtitle">分拣任务下发、规划提交与六轴关节轨迹可视化 · 实时数据来自前端网关</p>
            </div>
            <div class="page-header-actions">
                <span class="chip">
                    <span class="text-muted">轮询周期</span>
                    <strong class="text-mono">{{ poll_interval_ms }} ms</strong>
                </span>
                <span v-if="robot_state.last_updated_ms" class="chip">
                    <span class="text-muted">状态更新</span>
                    <strong class="text-mono">{{ format_time_ms(robot_state.last_updated_ms) }}</strong>
                </span>
                <button class="btn btn--ghost btn--sm" type="button" @click="refresh_robot_status()">
                    刷新状态
                </button>
            </div>
        </div>

        <div class="status-grid">
            <StatusCard
                v-for="card in status_cards"
                :key="card.title"
                :title="card.title"
                :value="card.value"
                :tone="card.tone"
                :hint="card.hint"
                :detail="card.detail"
            />
        </div>

        <p v-if="robot_state.error" class="notice notice--warn dashboard-notice">
            <span>机器人状态查询失败：{{ format_error(robot_state.error) }}</span>
        </p>

        <div class="panel-grid panel-grid--two">
            <TaskControlPanel @view-task="handle_view_task" />
            <PlanSubmitPanel @task-loaded="handle_task_loaded" />
        </div>

        <p v-if="task_error" class="notice notice--error dashboard-notice">
            <span>{{ task_error }}</span>
        </p>
        <p v-if="task_loading" class="notice notice--info dashboard-notice">
            <span>正在加载任务详情…</span>
        </p>

        <div class="panel-grid panel-grid--detail">
            <JointTrajectoryChart :task="active_task" />
            <TaskDetailPanel :task="active_task" empty_text="下发分拣任务或提交规划后，这里展示对应任务详情" />
        </div>

        <EventLogPanel />
    </div>
</template>

<style scoped>
.dashboard-notice {
    margin-bottom: 18px;
}
</style>
