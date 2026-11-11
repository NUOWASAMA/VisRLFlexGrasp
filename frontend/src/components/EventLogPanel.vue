<!--
    文件功能：事件日志面板：滚动展示 WebSocket 与 HTTP 事件（时间、来源、级别、消息、详情），支持清空
    作者：VisRLFlexGrasp 项目组
    创建日期：2026-11-11
-->
<script setup>
import { computed } from 'vue'

import { use_event_log } from '../composables/use_event_log.js'
import { format_json_detail, format_time_ms } from '../utils/format.js'

const { entries, max_entries, clear_events } = use_event_log()

// 事件来源中文标识
const SOURCE_LABELS = {
    ws: 'WS',
    http: 'HTTP',
    system: '系统',
}

// 事件级别到界面色调的映射
const LEVEL_TONES = {
    info: 'info',
    success: 'ok',
    warn: 'warn',
    error: 'error',
}

const count_text = computed(() => `${entries.value.length} / ${max_entries.value}`)

/**
 * 获取事件来源展示文案。
 * 入参：source 来源标识。
 * 返回：中文短标签。
 */
function get_source_label(source) {
    return SOURCE_LABELS[source] || String(source || '系统')
}

/**
 * 获取事件级别对应的状态点色调。
 * 入参：level 级别标识。
 * 返回：色调字符串。
 */
function get_level_tone(level) {
    return LEVEL_TONES[level] || 'idle'
}

/**
 * 详情统一转文本：已是字符串则直接展示，否则格式化为美化 JSON。
 * 入参：detail 事件详情。
 * 返回：可展示文本。
 */
function format_detail(detail) {
    if (typeof detail === 'string') {
        return detail
    }
    return format_json_detail(detail)
}
</script>

<template>
    <section class="panel">
        <header class="panel-header">
            <div class="panel-heading">
                <h2 class="panel-title">事件日志</h2>
                <span class="panel-subtitle">WebSocket 报文、HTTP 结果与系统事件实时记录（最多保留 {{ max_entries }} 条）</span>
            </div>
            <div class="panel-actions">
                <span class="badge badge--idle text-mono">{{ count_text }}</span>
                <button
                    class="btn btn--ghost btn--sm"
                    type="button"
                    :disabled="entries.length === 0"
                    @click="clear_events()"
                >
                    清空日志
                </button>
            </div>
        </header>
        <div class="panel-body panel-body--flush">
            <div v-if="entries.length === 0" class="event-log-empty">
                <div class="empty-state">
                    <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                            d="M4 6h16M4 12h16M4 18h10"
                            stroke="currentColor"
                            stroke-width="1.6"
                            stroke-linecap="round"
                        />
                    </svg>
                    <span>暂无事件记录，任务下发、规划提交与连接变化会实时记录在此</span>
                </div>
            </div>
            <ol v-else class="event-log-list">
                <li v-for="entry in entries" :key="entry.id" class="event-item">
                    <span class="event-time text-mono">{{ format_time_ms(entry.timestamp_ms, false) }}</span>
                    <span class="event-source" :class="'event-source--' + entry.source">
                        {{ get_source_label(entry.source) }}
                    </span>
                    <span class="dot" :class="'dot--' + get_level_tone(entry.level)"></span>
                    <div class="event-content">
                        <p class="event-message">{{ entry.message }}</p>
                        <details v-if="entry.detail" class="event-detail">
                            <summary>查看详情</summary>
                            <pre class="event-detail-pre">{{ format_detail(entry.detail) }}</pre>
                        </details>
                    </div>
                </li>
            </ol>
        </div>
    </section>
</template>

<style scoped>
.event-log-empty {
    padding: 16px 20px 20px;
}

.event-log-list {
    max-height: 380px;
    overflow-y: auto;
}

.event-item {
    display: grid;
    grid-template-columns: 62px 46px 10px minmax(0, 1fr);
    align-items: start;
    gap: 8px;
    padding: 9px 20px;
    border-bottom: 1px solid var(--color-border);
    font-size: 12.5px;
}

.event-item:last-child {
    border-bottom: none;
}

.event-item:hover {
    background: var(--color-surface-muted);
}

.event-time {
    color: var(--color-text-muted);
    font-size: 11.5px;
    line-height: 18px;
}

.event-source {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 18px;
    padding: 0 6px;
    border-radius: var(--radius-xs);
    background: var(--color-surface-soft);
    border: 1px solid var(--color-border);
    color: var(--color-text-secondary);
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.4px;
    line-height: 18px;
}

.event-source--ws {
    background: var(--color-primary-soft);
    border-color: rgba(26, 97, 74, 0.2);
    color: var(--color-primary);
}

.event-source--http {
    background: var(--color-info-soft);
    border-color: rgba(47, 127, 191, 0.2);
    color: var(--color-info);
}

.event-source--system {
    background: var(--color-accent-soft);
    border-color: rgba(105, 208, 67, 0.35);
    color: #3f8a1f;
}

.event-item > .dot {
    margin-top: 5px;
}

.event-content {
    min-width: 0;
}

.event-message {
    color: var(--color-text);
    line-height: 1.55;
    word-break: break-word;
}

.event-detail {
    margin-top: 4px;
}

.event-detail summary {
    color: var(--color-primary);
    font-size: 11.5px;
    cursor: pointer;
    user-select: none;
    width: fit-content;
}

.event-detail-pre {
    margin: 6px 0 0;
    padding: 8px 10px;
    max-height: 180px;
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
</style>
