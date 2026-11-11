<!--
    文件功能：任务详情面板：展示任务状态、请求位姿、规划结果、错误与时间信息（总览与任务查询页复用）
    作者：VisRLFlexGrasp 项目组
    创建日期：2026-11-11
-->
<script setup>
import { computed } from 'vue'

import {
    format_angles,
    format_boolean,
    format_error,
    format_number,
    format_time_ms,
    get_task_status_label,
    get_task_status_tone,
} from '../utils/format.js'

const props = defineProps({
    // 任务详情对象（GET /api/tasks/{task_id} 的 data），或规划提交后轮询得到的记录
    task: {
        type: Object,
        default: null,
    },
    // 空状态提示文案
    empty_text: {
        type: String,
        default: '暂无任务详情',
    },
})

const result = computed(() => (props.task && props.task.result) || null)
const request = computed(() => (props.task && props.task.request) || null)
const pose = computed(() => (request.value && request.value.grasp_pose) || null)
const current_joint_angles = computed(() => (request.value && request.value.current_joint_angles) || null)
const status_label = computed(() => (props.task ? get_task_status_label(props.task.status) : ''))
const status_tone = computed(() => (props.task ? get_task_status_tone(props.task.status) : 'idle'))
const error_text = computed(() => (props.task && props.task.error ? format_error(props.task.error) : ''))
const is_planning = computed(() => Boolean(props.task && props.task.status === 'planning'))
</script>

<template>
    <section class="panel">
        <header class="panel-header">
            <div class="panel-heading">
                <h2 class="panel-title">任务详情</h2>
                <span class="panel-subtitle">
                    {{ task ? `任务标识：${task.task_id}` : '查询或提交规划后在此查看任务状态与结果' }}
                </span>
            </div>
            <div v-if="task" class="panel-actions">
                <span class="badge" :class="'badge--' + status_tone">{{ status_label }}</span>
            </div>
        </header>
        <div class="panel-body">
            <div v-if="!task" class="empty-state">
                <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                        d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"
                        stroke="currentColor"
                        stroke-width="1.6"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    />
                </svg>
                <span>{{ empty_text }}</span>
            </div>
            <div v-else class="stack-md">
                <p v-if="is_planning" class="notice notice--info">
                    <span>后端正在规划中，页面会持续轮询直到任务进入终态（planned / failed / interrupted）。</span>
                </p>
                <p v-if="error_text" class="notice notice--error">
                    <span>{{ error_text }}</span>
                </p>

                <div class="kv-list">
                    <div class="kv-item">
                        <span class="kv-label">创建时间</span>
                        <span class="kv-value text-mono">{{ format_time_ms(task.created_at) }}</span>
                    </div>
                    <div class="kv-item">
                        <span class="kv-label">更新时间</span>
                        <span class="kv-value text-mono">{{ format_time_ms(task.updated_at) }}</span>
                    </div>
                    <div class="kv-item">
                        <span class="kv-label">任务状态</span>
                        <span class="kv-value">{{ status_label }}</span>
                    </div>
                    <div class="kv-item">
                        <span class="kv-label">是否真实执行</span>
                        <span class="kv-value">
                            {{ result ? format_boolean(result.executed) + '（仅规划）' : '—' }}
                        </span>
                    </div>
                </div>

                <div v-if="request" class="detail-section">
                    <h3 class="detail-section-title">请求参数</h3>
                    <div class="kv-list">
                        <div class="kv-item">
                            <span class="kv-label">目标位置 (m)</span>
                            <span class="kv-value text-mono">{{ format_angles(pose && pose.position, 4) }}</span>
                        </div>
                        <div class="kv-item">
                            <span class="kv-label">目标四元数 (qx,qy,qz,qw)</span>
                            <span class="kv-value text-mono">{{ format_angles(pose && pose.orientation, 4) }}</span>
                        </div>
                        <div class="kv-item">
                            <span class="kv-label">当前关节角（参考）</span>
                            <span class="kv-value text-mono">
                                {{ current_joint_angles ? format_angles(current_joint_angles, 3) : '缺省（使用配置初始角）' }}
                            </span>
                        </div>
                        <div class="kv-item">
                            <span class="kv-label">夹持力上限 (N)</span>
                            <span class="kv-value text-mono">{{ format_number(request.force_limit, 2) }}</span>
                        </div>
                    </div>
                </div>

                <div v-if="result" class="detail-section">
                    <h3 class="detail-section-title">规划结果</h3>
                    <div class="kv-list">
                        <div class="kv-item">
                            <span class="kv-label">关节目标 (rad)</span>
                            <span class="kv-value text-mono">{{ format_angles(result.joint_target, 4) }}</span>
                        </div>
                        <div class="kv-item">
                            <span class="kv-label">轨迹点数量</span>
                            <span class="kv-value text-mono">
                                {{ Array.isArray(result.joint_trajectory) ? result.joint_trajectory.length : '—' }}
                            </span>
                        </div>
                        <div class="kv-item">
                            <span class="kv-label">规划时长</span>
                            <span class="kv-value text-mono">{{ format_number(result.duration_sec, 3, 's') }}</span>
                        </div>
                        <div class="kv-item">
                            <span class="kv-label">采样周期</span>
                            <span class="kv-value text-mono">
                                {{ format_number(result.sample_period_sec, 4, 's') }}
                            </span>
                        </div>
                        <div class="kv-item">
                            <span class="kv-label">可行解数量</span>
                            <span class="kv-value text-mono">{{ format_number(result.solution_count, 0) }}</span>
                        </div>
                        <div class="kv-item">
                            <span class="kv-label">参考角来源</span>
                            <span class="kv-value text-mono">
                                {{ result.reference_source === 'request' ? '请求传入' : '后端配置初始角' }}
                            </span>
                        </div>
                        <div class="kv-item">
                            <span class="kv-label">规划夹持力 (N)</span>
                            <span class="kv-value text-mono">{{ format_number(result.force_limit, 2) }}</span>
                        </div>
                        <div class="kv-item">
                            <span class="kv-label">执行状态</span>
                            <span class="kv-value">
                                <span class="badge badge--warn">仅规划，未执行实际抓取</span>
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>
</template>

<style scoped>
.detail-section {
    padding-top: 12px;
    border-top: 1px dashed var(--color-border);
}

.detail-section-title {
    margin-bottom: 10px;
    color: var(--color-text);
    font-size: 13px;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 7px;
}

.detail-section-title::before {
    content: "";
    display: inline-block;
    width: 3px;
    height: 13px;
    border-radius: var(--radius-pill);
    background: var(--color-primary);
}
</style>
