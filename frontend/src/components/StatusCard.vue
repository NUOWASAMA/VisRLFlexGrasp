<!--
    文件功能：状态卡组件：展示单一系统指标（标题、状态值、色调、补充说明与明细）
    作者：VisRLFlexGrasp 项目组
    创建日期：2026-11-11
-->
<script setup>
defineProps({
    // 指标名称
    title: {
        type: String,
        required: true,
    },
    // 指标状态值
    value: {
        type: String,
        default: '—',
    },
    // 色调：ok / warn / error / info / idle
    tone: {
        type: String,
        default: 'idle',
    },
    // 补充说明
    hint: {
        type: String,
        default: '',
    },
    // 等宽明细（任务 ID、地址等）
    detail: {
        type: String,
        default: '',
    },
})
</script>

<template>
    <div class="status-card">
        <div class="status-card-head">
            <span class="status-card-title">{{ title }}</span>
            <span class="dot" :class="'dot--' + tone"></span>
        </div>
        <div class="status-card-value" :class="'status-card-value--' + tone">{{ value }}</div>
        <div v-if="hint" class="status-card-hint">{{ hint }}</div>
        <div v-if="detail" class="status-card-detail text-mono" :title="detail">{{ detail }}</div>
    </div>
</template>

<style scoped>
.status-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 16px 18px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-panel);
    overflow: hidden;
    min-width: 0;
}

.status-card::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    background: var(--color-border-strong);
}

.status-card:has(.status-card-value--ok)::before {
    background: var(--color-ok);
}

.status-card:has(.status-card-value--warn)::before {
    background: var(--color-warn);
}

.status-card:has(.status-card-value--error)::before {
    background: var(--color-error);
}

.status-card:has(.status-card-value--info)::before {
    background: var(--color-info);
}

.status-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
}

.status-card-title {
    color: var(--color-text-secondary);
    font-size: 12.5px;
    font-weight: 600;
    letter-spacing: 0.2px;
}

.status-card-value {
    font-size: 19px;
    font-weight: 700;
    line-height: 1.35;
    color: var(--color-text);
    word-break: break-word;
}

.status-card-value--ok {
    color: var(--color-ok);
}

.status-card-value--warn {
    color: var(--color-warn);
}

.status-card-value--error {
    color: var(--color-error);
}

.status-card-value--info {
    color: var(--color-info);
}

.status-card-hint {
    color: var(--color-text-muted);
    font-size: 11.5px;
    line-height: 1.5;
}

.status-card-detail {
    color: var(--color-text-secondary);
    font-size: 11.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
