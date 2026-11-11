<!--
    文件功能：机器人状态页：展示 /api/robot/status 全字段、planning_reference 柱状图、轮询开关与手动刷新
    作者：VisRLFlexGrasp 项目组
    创建日期：2026-11-11
-->
<script setup>
import { computed, onMounted } from 'vue'

import JointAngleBarChart from '../components/JointAngleBarChart.vue'
import { use_event_log } from '../composables/use_event_log.js'
import { use_polling } from '../composables/use_polling.js'
import { use_robot_status } from '../composables/use_robot_status.js'
import { use_settings } from '../composables/use_settings.js'
import {
    format_angles,
    format_boolean,
    format_error,
    format_json_detail,
    format_time_ms,
} from '../utils/format.js'

const { robot_state, refresh_robot_status } = use_robot_status()
const { effective } = use_settings()
const { push_event } = use_event_log()

const poll_interval_ms = computed(() => effective.value.poll_interval_ms)

const { is_running, start, stop } = use_polling(refresh_robot_status, {
    interval_ms: poll_interval_ms,
    immediate: true,
})

const data = computed(() => robot_state.data || null)
const reference_angles = computed(() => {
    const angles = data.value && data.value.planning_reference
    return Array.isArray(angles) ? angles : null
})
const raw_json = computed(() => (data.value ? format_json_detail(data.value) : ''))

const status_fields = computed(() => {
    const current = data.value || {}
    return [
        {
            key: 'motion_online',
            label: 'motion_online · 运动规划服务在线',
            value: format_boolean(current.motion_online),
            tone: current.motion_online ? 'ok' : 'error',
        },
        {
            key: 'controller_connected',
            label: 'controller_connected · 控制柜连接',
            value: format_boolean(current.controller_connected),
            tone: 'idle',
        },
        {
            key: 'execution_mode',
            label: 'execution_mode · 执行模式',
            value: current.execution_mode === 'plan_only' ? 'plan_only（仅规划）' : (current.execution_mode || '—'),
            tone: 'warn',
        },
        {
            key: 'busy',
            label: 'busy · 规划忙碌状态',
            value: format_boolean(current.busy),
            tone: current.busy ? 'warn' : 'ok',
        },
        {
            key: 'active_task_id',
            label: 'active_task_id · 当前活动规划任务',
            value: current.active_task_id || '无',
            tone: 'idle',
        },
        {
            key: 'current_joint_angles',
            label: 'current_joint_angles · 当前关节角',
            value: Array.isArray(current.current_joint_angles)
                ? format_angles(current.current_joint_angles, 4)
                : 'null（未接入控制柜反馈）',
            tone: 'idle',
        },
        {
            key: 'feedback_source',
            label: 'feedback_source · 反馈来源',
            value: current.feedback_source === 'unavailable'
                ? 'unavailable（不可用）'
                : (current.feedback_source || '—'),
            tone: 'idle',
        },
        {
            key: 'planning_reference',
            label: 'planning_reference · 初始规划参考角 (rad)',
            value: format_angles(current.planning_reference, 4),
            tone: 'idle',
        },
    ]
})

/**
 * 切换自动轮询开关。
 * 入参：event DOM change 事件。
 * 返回：无。
 */
function handle_toggle_polling(event) {
    if (event.target.checked) {
        start()
        push_event({ source: 'system', level: 'info', message: '机器人状态自动轮询已开启' })
    } else {
        stop()
        push_event({ source: 'system', level: 'info', message: '机器人状态自动轮询已暂停' })
    }
}

onMounted(() => {
    start()
})
</script>

<template>
    <div class="robot-view">
        <div class="page-header">
            <div>
                <h1 class="page-title">机器人状态</h1>
                <p class="page-subtitle">
                    GET /api/robot/status 全字段展示 · planning_reference 为后端配置的初始规划参考角
                </p>
            </div>
            <div class="page-header-actions">
                <label class="switch">
                    <input type="checkbox" :checked="is_running" @change="handle_toggle_polling" />
                    <span class="switch-track"></span>
                    <span class="switch-label">自动轮询</span>
                </label>
                <span class="chip">
                    <span class="text-muted">周期</span>
                    <strong class="text-mono">{{ poll_interval_ms }} ms</strong>
                </span>
                <span v-if="robot_state.last_updated_ms" class="chip">
                    <span class="text-muted">更新于</span>
                    <strong class="text-mono">{{ format_time_ms(robot_state.last_updated_ms) }}</strong>
                </span>
                <button class="btn btn--ghost btn--sm" type="button" @click="refresh_robot_status()">手动刷新</button>
            </div>
        </div>

        <p v-if="robot_state.error" class="notice notice--warn robot-notice">
            <span>机器人状态查询失败：{{ format_error(robot_state.error) }}</span>
        </p>
        <p v-if="!is_running" class="notice notice--info robot-notice">
            <span>自动轮询已暂停，可点击「手动刷新」获取最新状态。</span>
        </p>

        <div class="panel-grid panel-grid--robot">
            <section class="panel">
                <header class="panel-header">
                    <div class="panel-heading">
                        <h2 class="panel-title">状态字段</h2>
                        <span class="panel-subtitle">字段含义与取值来自后端 GET /api/robot/status</span>
                    </div>
                    <div class="panel-actions">
                        <span class="badge" :class="data && data.motion_online ? 'badge--ok' : 'badge--error'">
                            运动服务{{ data && data.motion_online ? '在线' : '离线' }}
                        </span>
                        <span class="badge" :class="data && data.busy ? 'badge--warn' : 'badge--idle'">
                            {{ data && data.busy ? '规划忙碌' : '规划空闲' }}
                        </span>
                    </div>
                </header>
                <div class="panel-body">
                    <div v-if="!data" class="empty-state">
                        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path
                                d="M12 3v18M5 8l7-5 7 5M5 16l7 5 7-5"
                                stroke="currentColor"
                                stroke-width="1.6"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            />
                        </svg>
                        <span>暂无机器人状态数据：请确认前端网关与后端已启动</span>
                    </div>
                    <template v-else>
                        <div class="table-wrap">
                            <table class="table table--kv">
                                <tbody>
                                    <tr v-for="field in status_fields" :key="field.key">
                                        <th>{{ field.label }}</th>
                                        <td>
                                            <span :class="field.tone === 'ok' ? 'text-ok'
                                                : field.tone === 'error' ? 'text-error'
                                                    : field.tone === 'warn' ? 'text-warn'
                                                        : field.tone === 'info' ? 'text-primary' : ''">
                                                {{ field.value }}
                                            </span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <details class="raw-json">
                            <summary>查看机器人状态原始 JSON</summary>
                            <pre class="raw-json-pre">{{ raw_json }}</pre>
                        </details>
                    </template>
                </div>
            </section>

            <div class="stack-md robot-side">
                <JointAngleBarChart :angles="reference_angles" />
                <section class="panel">
                    <header class="panel-header">
                        <div class="panel-heading">
                            <h2 class="panel-title">第一阶段反馈边界</h2>
                            <span class="panel-subtitle">为什么 current_joint_angles 为 null</span>
                        </div>
                    </header>
                    <div class="panel-body stack-sm">
                        <p class="notice notice--info">
                            <span>
                                机械臂控制柜、夹爪与力控尚未接入：controller_connected=false、
                                current_joint_angles=null、feedback_source=unavailable，
                                系统不会伪造控制柜反馈。
                            </span>
                        </p>
                        <p class="notice notice--warn">
                            <span>
                                planning_reference 仅为后端配置的初始规划参考角，用于逆解求解起点，
                                不代表机械臂当前实际姿态；planned 状态表示规划完成，executed 恒为 false。
                            </span>
                        </p>
                    </div>
                </section>
            </div>
        </div>
    </div>
</template>

<style scoped>
.robot-notice {
    margin-bottom: 18px;
}

.raw-json {
    margin-top: 14px;
    border-top: 1px dashed var(--color-border);
    padding-top: 10px;
}

.raw-json summary {
    color: var(--color-primary);
    font-size: 12px;
    cursor: pointer;
    user-select: none;
    width: fit-content;
}

.raw-json-pre {
    margin: 8px 0 0;
    padding: 10px 12px;
    max-height: 220px;
    overflow: auto;
    border-radius: var(--radius-sm);
    background: #12281f;
    color: #d7f2e3;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-all;
}

.robot-side {
    min-width: 0;
}
</style>
