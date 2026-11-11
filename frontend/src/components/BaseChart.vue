<!--
    文件功能：ECharts 图表容器组件：负责实例初始化、option 变更重绘、容器尺寸自适应与卸载销毁
    作者：VisRLFlexGrasp 项目组
    创建日期：2026-11-11
-->
<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { init } from '../utils/echarts_setup.js'

const props = defineProps({
    // ECharts option；为 null 时展示空状态
    option: {
        type: Object,
        default: null,
    },
    // 图表高度（CSS 长度）
    height: {
        type: String,
        default: '320px',
    },
    // 无数据时的提示文案
    empty_text: {
        type: String,
        default: '暂无可视化数据',
    },
})

const chart_container = ref(null)
let chart_instance = null
let resize_observer = null

/**
 * 把当前 option 应用到图表实例；option 为空时清空画布。
 * 返回：无。
 */
function render_chart() {
    if (!chart_instance) {
        return
    }
    if (!props.option) {
        chart_instance.clear()
        return
    }
    chart_instance.setOption(props.option, true)
}

/**
 * 窗口尺寸变化的兜底处理（不支持 ResizeObserver 的环境）。
 * 返回：无。
 */
function handle_window_resize() {
    if (chart_instance) {
        chart_instance.resize()
    }
}

onMounted(() => {
    if (!chart_container.value) {
        return
    }
    chart_instance = init(chart_container.value)
    render_chart()
    if (typeof ResizeObserver !== 'undefined') {
        resize_observer = new ResizeObserver(() => {
            if (chart_instance) {
                chart_instance.resize()
            }
        })
        resize_observer.observe(chart_container.value)
    } else {
        window.addEventListener('resize', handle_window_resize)
    }
})

watch(() => props.option, () => {
    render_chart()
}, { deep: true })

onBeforeUnmount(() => {
    if (resize_observer) {
        resize_observer.disconnect()
        resize_observer = null
    } else {
        window.removeEventListener('resize', handle_window_resize)
    }
    if (chart_instance) {
        chart_instance.dispose()
        chart_instance = null
    }
})
</script>

<template>
    <div class="base-chart" :style="{ height: height }">
        <div ref="chart_container" class="base-chart-canvas"></div>
        <div v-if="!option" class="base-chart-empty">
            <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                    d="M4 20V10M10 20V4M16 20V13M22 20V8"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                />
            </svg>
            <span>{{ empty_text }}</span>
        </div>
    </div>
</template>

<style scoped>
.base-chart {
    position: relative;
    width: 100%;
    min-width: 0;
}

.base-chart-canvas {
    width: 100%;
    height: 100%;
}

.base-chart-empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 1px dashed var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-muted);
    color: var(--color-text-muted);
    font-size: 12.5px;
    text-align: center;
    padding: 16px;
}
</style>
