<!--
    文件功能：六轴关节轨迹折线图面板：展示任务 result 中的 joint_trajectory（时间 × 六个关节角）与规划摘要
    作者：VisRLFlexGrasp 项目组
    创建日期：2026-11-11
-->
<script setup>
import { computed } from 'vue'

import { TRAJECTORY_CHART_HEIGHT } from '../config/defaults.js'
import BaseChart from './BaseChart.vue'
import { build_trajectory_option } from '../utils/chart_options.js'
import {
    format_boolean,
    format_number,
    get_task_status_label,
    get_task_status_tone,
} from '../utils/format.js'

const props = defineProps({
    // 任务详情对象，取其 result 绘制轨迹
    task: {
        type: Object,
        default: null,
    },
    // 面板标题
    title: {
        type: String,
        default: '六轴关节轨迹',
    },
})

const result = computed(() => (props.task && props.task.result) || null)
const chart_option = computed(() => build_trajectory_option(result.value))
const status_label = computed(() => (props.task ? get_task_status_label(props.task.status) : ''))
const status_tone = computed(() => (props.task ? get_task_status_tone(props.task.status) : 'idle'))
const subtitle = computed(() => {
    const axis_hint = '横轴时间（秒）· 纵轴关节角（弧度）'
    if (!props.task) {
        return `提交规划或查询任务后展示 joint_trajectory 六轴关节角曲线（${axis_hint}）`
    }
    return `任务 ${props.task.task_id} · ${axis_hint} · 时间轴按 duration_sec 与 sample_period_sec 推算`
})
const summary_items = computed(() => {
    if (!result.value) {
        return []
    }
    const trajectory = Array.isArray(result.value.joint_trajectory) ? result.value.joint_trajectory : []
    return [
        { label: '规划时长', value: format_number(result.value.duration_sec, 3, 's') },
        { label: '采样周期', value: format_number(result.value.sample_period_sec, 4, 's') },
        { label: '轨迹点', value: String(trajectory.length) },
        { label: '可行解数量', value: format_number(result.value.solution_count, 0) },
        { label: '真实执行', value: `${format_boolean(result.value.executed)}（仅规划）` },
    ]
})
</script>

<template>
    <section class="panel">
        <header class="panel-header">
            <div class="panel-heading">
                <h2 class="panel-title">{{ title }}</h2>
                <span class="panel-subtitle">{{ subtitle }}</span>
            </div>
            <div class="panel-actions">
                <span v-if="task" class="badge" :class="'badge--' + status_tone">{{ status_label }}</span>
            </div>
        </header>
        <div class="panel-body stack-md">
            <div v-if="summary_items.length > 0" class="chip-row">
                <span v-for="item in summary_items" :key="item.label" class="chip">
                    <span class="text-muted">{{ item.label }}</span>
                    <strong class="text-mono">{{ item.value }}</strong>
                </span>
            </div>
            <BaseChart
                :option="chart_option"
                :height="TRAJECTORY_CHART_HEIGHT"
                empty_text="暂无轨迹数据：提交规划任务并等待状态为 planned 后，将在此展示六轴关节角曲线"
            />
        </div>
    </section>
</template>

<style scoped>
.chip-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}
</style>
