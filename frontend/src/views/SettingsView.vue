<!--
    文件功能：参数配置页：配置轮询周期、默认夹持力、默认品类与默认速度等级（localStorage），并展示只读运行参数
    作者：VisRLFlexGrasp 项目组
    创建日期：2026-11-11
-->
<script setup>
import { computed, reactive, ref } from 'vue'

import { use_app_config } from '../composables/use_app_config.js'
import { use_app_status } from '../composables/use_app_status.js'
import { use_event_log } from '../composables/use_event_log.js'
import { use_settings } from '../composables/use_settings.js'
import {
    FORCE_LIMIT_MAX,
    FORCE_LIMIT_MIN,
    FORCE_LIMIT_STEP,
    HTTP_TIMEOUT_MS,
    POLL_INTERVAL_MAX_MS,
    POLL_INTERVAL_MIN_MS,
    POLL_INTERVAL_STEP_MS,
    WS_RECONNECT_INTERVALS_SEC,
} from '../config/defaults.js'
import { format_boolean, format_time_ms, get_category_label, get_speed_level_label } from '../utils/format.js'

const app_config = use_app_config()
const { app_status } = use_app_status()
const { effective, has_overrides, save_settings, reset_settings } = use_settings()
const { push_event } = use_event_log()

const form = reactive({
    poll_interval_ms: effective.value.poll_interval_ms,
    default_force_limit: effective.value.default_force_limit,
    default_category: effective.value.default_category,
    default_speed_level: effective.value.default_speed_level,
})

const form_error = ref('')
const saved_tip = ref('')

const category_options = computed(() => app_config.ui.categories || [])
const speed_options = computed(() => app_config.ui.speed_levels || [])
const reconnect_text = computed(() => (
    `${WS_RECONNECT_INTERVALS_SEC.map((seconds) => `${seconds} s`).join(' → ')}（达到最大间隔后保持持续重试）`
))
const gateway_address = computed(() => {
    const gateway = app_config.gateway
    return gateway.host && gateway.port ? `http://${gateway.host}:${gateway.port}` : '未知'
})
const backend_address = computed(() => {
    const http = app_config.backend && app_config.backend.http ? app_config.backend.http : {}
    return http.host && http.port ? `http://${http.host}:${http.port}` : '未知'
})

const readonly_items = computed(() => [
    { label: '运行环境（env）', value: app_config.env ? app_config.env.toUpperCase() : '未知' },
    { label: '前端网关 HTTP 地址', value: gateway_address.value },
    { label: '后端 HTTP 地址', value: backend_address.value },
    { label: 'WebSocket 路径', value: app_config.gateway.ws_path || '/ws' },
    { label: 'WebSocket 重连策略', value: reconnect_text.value },
    { label: 'HTTP 请求超时', value: `${HTTP_TIMEOUT_MS} ms` },
    { label: '网关 TCP 连接', value: format_boolean(app_status.gateway.tcp_connected) },
    { label: '网关模块注册', value: format_boolean(app_status.gateway.registered) },
    { label: '后端在线', value: format_boolean(app_status.gateway.backend_online) },
    { label: '本次 WebSocket 客户端', value: app_status.ws_client_id || '未分配' },
])

const override_text = computed(() => (has_overrides.value ? '当前使用本地覆盖参数' : '当前使用网关默认参数'))

/**
 * 保存界面运行参数到 localStorage。
 * 返回：无。
 */
function handle_save() {
    saved_tip.value = ''
    const result = save_settings({ ...form })
    if (!result.ok) {
        form_error.value = result.errors.join('；')
        return
    }
    form_error.value = ''
    saved_tip.value = `已保存并应用到全局轮询与默认参数（${format_time_ms(Date.now())}）`
    push_event({ source: 'system', level: 'success', message: '界面运行参数已保存到本地存储' })
}

/**
 * 恢复网关 /api/gateway/config 提供的默认参数。
 * 返回：无。
 */
function handle_reset() {
    reset_settings()
    form.poll_interval_ms = effective.value.poll_interval_ms
    form.default_force_limit = effective.value.default_force_limit
    form.default_category = effective.value.default_category
    form.default_speed_level = effective.value.default_speed_level
    form_error.value = ''
    saved_tip.value = '已恢复网关 /api/gateway/config 的默认参数'
    push_event({ source: 'system', level: 'info', message: '已恢复网关默认界面参数' })
}
</script>

<template>
    <div class="settings-view">
        <div class="page-header">
            <div>
                <h1 class="page-title">参数配置</h1>
                <p class="page-subtitle">
                    界面运行参数保存在浏览器 localStorage，仅影响本机界面行为，不改变后端与前端网关配置
                </p>
            </div>
            <div class="page-header-actions">
                <span class="badge" :class="has_overrides ? 'badge--info' : 'badge--idle'">{{ override_text }}</span>
            </div>
        </div>

        <div class="panel-grid panel-grid--two">
            <section class="panel">
                <header class="panel-header">
                    <div class="panel-heading">
                        <h2 class="panel-title">界面运行参数</h2>
                        <span class="panel-subtitle">默认值来自前端网关 GET /api/gateway/config 的 ui 配置</span>
                    </div>
                </header>
                <div class="panel-body stack-md">
                    <form class="stack-md" @submit.prevent="handle_save">
                        <div class="form-grid">
                            <div class="field">
                                <label class="field-label" for="settings-poll-input">轮询周期（ms）</label>
                                <input
                                    id="settings-poll-input"
                                    v-model.number="form.poll_interval_ms"
                                    class="input text-mono"
                                    type="number"
                                    :min="POLL_INTERVAL_MIN_MS"
                                    :max="POLL_INTERVAL_MAX_MS"
                                    :step="POLL_INTERVAL_STEP_MS"
                                />
                                <span class="field-hint">
                                    允许 {{ POLL_INTERVAL_MIN_MS }} ~ {{ POLL_INTERVAL_MAX_MS }} ms，
                                    作用于总览/机器人状态轮询与规划任务轮询
                                </span>
                            </div>
                            <div class="field">
                                <label class="field-label" for="settings-force-input">默认夹持力（N）</label>
                                <input
                                    id="settings-force-input"
                                    v-model.number="form.default_force_limit"
                                    class="input text-mono"
                                    type="number"
                                    :min="FORCE_LIMIT_MIN"
                                    :max="FORCE_LIMIT_MAX"
                                    :step="FORCE_LIMIT_STEP"
                                />
                                <span class="field-hint">
                                    允许 {{ FORCE_LIMIT_MIN }} ~ {{ FORCE_LIMIT_MAX }} N，
                                    作为规划提交表单的初始值
                                </span>
                            </div>
                            <div class="field">
                                <label class="field-label" for="settings-category-select">默认分拣品类</label>
                                <select id="settings-category-select" v-model="form.default_category" class="select">
                                    <option value="">全品类</option>
                                    <option v-for="category in category_options" :key="category" :value="category">
                                        {{ get_category_label(category) }}
                                    </option>
                                </select>
                                <span class="field-hint">分拣任务控制面板的默认选中项</span>
                            </div>
                            <div class="field">
                                <label class="field-label" for="settings-speed-select">默认速度等级</label>
                                <select
                                    id="settings-speed-select"
                                    v-model.number="form.default_speed_level"
                                    class="select"
                                >
                                    <option v-for="level in speed_options" :key="level" :value="level">
                                        {{ get_speed_level_label(level) }}
                                    </option>
                                </select>
                                <span class="field-hint">分拣任务控制面板的默认速度等级</span>
                            </div>
                        </div>

                        <p v-if="form_error" class="notice notice--error">
                            <span>{{ form_error }}</span>
                        </p>
                        <p v-if="saved_tip" class="notice notice--success">
                            <span>{{ saved_tip }}</span>
                        </p>

                        <div class="btn-row">
                            <button class="btn btn--primary" type="submit">保存配置</button>
                            <button class="btn btn--ghost" type="button" @click="handle_reset">恢复默认值</button>
                        </div>
                    </form>

                    <div class="effective-preview">
                        <span class="effective-preview-label">当前生效值</span>
                        <div class="chip-row">
                            <span class="chip">
                                <span class="text-muted">轮询周期</span>
                                <strong class="text-mono">{{ effective.poll_interval_ms }} ms</strong>
                            </span>
                            <span class="chip">
                                <span class="text-muted">默认夹持力</span>
                                <strong class="text-mono">{{ effective.default_force_limit }} N</strong>
                            </span>
                            <span class="chip">
                                <span class="text-muted">默认品类</span>
                                <strong>{{ get_category_label(effective.default_category) }}</strong>
                            </span>
                            <span class="chip">
                                <span class="text-muted">默认速度</span>
                                <strong>{{ get_speed_level_label(effective.default_speed_level) }}</strong>
                            </span>
                        </div>
                    </div>

                    <p class="notice notice--info">
                        <span>
                            配置写入浏览器 localStorage（键前缀 visrl_flex_grasp:），清除浏览器站点数据后恢复默认；
                            网关与后端参数需修改 frontend/config/*.json 与 backend/config/*.json 并重启服务。
                        </span>
                    </p>
                </div>
            </section>

            <section class="panel">
                <header class="panel-header">
                    <div class="panel-heading">
                        <h2 class="panel-title">运行信息（只读）</h2>
                        <span class="panel-subtitle">来自网关配置与实时连接状态，不可在界面修改</span>
                    </div>
                </header>
                <div class="panel-body">
                    <div class="kv-list kv-list--single">
                        <div v-for="item in readonly_items" :key="item.label" class="kv-item kv-item--row">
                            <span class="kv-label">{{ item.label }}</span>
                            <span class="kv-value text-mono">{{ item.value }}</span>
                        </div>
                    </div>
                    <div class="divider"></div>
                    <p class="notice notice--warn">
                        <span>
                            第一阶段仅监听本机地址、不提供公网认证；界面不暴露任何密钥或设备私密参数。
                        </span>
                    </p>
                </div>
            </section>
        </div>
    </div>
</template>

<style scoped>
.effective-preview {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    border: 1px dashed var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-muted);
}

.effective-preview-label {
    color: var(--color-text-secondary);
    font-size: 12px;
    font-weight: 700;
}

.chip-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.kv-list--single {
    grid-template-columns: minmax(0, 1fr);
}

.kv-item--row {
    flex-direction: row;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 8px;
    border-bottom: 1px dashed var(--color-border);
}

.kv-item--row:last-child {
    border-bottom: none;
    padding-bottom: 0;
}
</style>
