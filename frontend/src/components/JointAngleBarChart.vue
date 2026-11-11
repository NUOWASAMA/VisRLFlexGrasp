<!--
    文件功能：规划参考角柱状图面板：展示 /api/robot/status 的 planning_reference 六关节角（配置初始规划角）
    作者：VisRLFlexGrasp 项目组
    创建日期：2026-11-11
-->
<script setup>
import { computed } from 'vue'

import { JOINT_CHART_HEIGHT } from '../config/defaults.js'
import BaseChart from './BaseChart.vue'
import { build_joint_bar_option } from '../utils/chart_options.js'

const props = defineProps({
    // planning_reference 六关节角数组（弧度）
    angles: {
        type: Array,
        default: null,
    },
    // 面板标题
    title: {
        type: String,
        default: '规划参考关节角',
    },
})

const chart_option = computed(() => build_joint_bar_option(props.angles))
const is_all_zero = computed(() => (
    Array.isArray(props.angles)
    && props.angles.length > 0
    && props.angles.every((angle) => Number(angle) === 0)
))
</script>

<template>
    <section class="panel">
        <header class="panel-header">
            <div class="panel-heading">
                <h2 class="panel-title">{{ title }}</h2>
                <span class="panel-subtitle">planning_reference：后端配置的初始规划参考角（非控制柜反馈）</span>
            </div>
        </header>
        <div class="panel-body">
            <BaseChart
                :option="chart_option"
                :height="JOINT_CHART_HEIGHT"
                empty_text="暂无规划参考角数据，请刷新机器人状态"
            />
            <p v-if="is_all_zero" class="field-hint chart-hint">
                当前 planning_reference 六个关节角均为 0 rad（嵌入式配置的初始规划参考角）；提交规划后可在总览页查看实际关节轨迹。
            </p>
        </div>
    </section>
</template>

<style scoped>
.chart-hint {
    margin-top: 8px;
}
</style>
