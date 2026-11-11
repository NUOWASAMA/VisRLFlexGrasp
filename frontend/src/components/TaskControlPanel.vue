<!--
    文件功能：分拣任务控制面板：填写 task_id/品类/速度等级，经 WebSocket 下发 task_start，
              实时展示 sorted_count/phase/is_finished/planning_task_id/error，并支持一键查看规划任务详情
    作者：VisRLFlexGrasp 项目组
    创建日期：2026-11-11
-->
<script setup>
import { computed, onBeforeUnmount, onMounted, reactive } from 'vue'

import { ws_client } from '../api/ws_client.js'
import { ERROR_CODES, TASK_ID_MAX_LENGTH, WS_STATE } from '../config/defaults.js'
import { use_app_config } from '../composables/use_app_config.js'
import { use_app_status } from '../composables/use_app_status.js'
import { use_event_log } from '../composables/use_event_log.js'
import { use_settings } from '../composables/use_settings.js'
import {
    format_error,
    format_time_ms,
    get_category_label,
    get_error_code_label,
    get_phase_label,
    get_speed_level_label,
} from '../utils/format.js'
import { generate_task_id } from '../utils/id.js'

const emit = defineEmits(['view-task'])

const app_config = use_app_config()
const { effective } = use_settings()
const { app_status, ws_connected } = use_app_status()
const { push_event } = use_event_log()

// 面板运行态枚举：空 -> 下发中 -> 运行中 -> 结束/失败
const RUN_STATUS = {
    IDLE: 'idle',
    SUBMITTING: 'submitting',
    RUNNING: 'running',
    FINISHED: 'finished',
    FAILED: 'failed',
}

const category_options = computed(() => app_config.ui.categories || [])
const speed_options = computed(() => app_config.ui.speed_levels || [])

const form = reactive({
    task_id: generate_task_id(),
    category: effective.value.default_category,
    speed_level: effective.value.default_speed_level,
})

const errors = reactive({
    task_id: '',
    category: '',
    speed_level: '',
})

const run = reactive({
    status: RUN_STATUS.IDLE,
    request_id: '',
    task_id: '',
    sorted_count: 0,
    task_phase: '',
    is_finished: false,
    planning_task_id: '',
    error: '',
    last_event_at: 0,
})

const is_active = computed(() => run.status === RUN_STATUS.SUBMITTING || run.status === RUN_STATUS.RUNNING)
const can_submit = computed(() => ws_connected.value && !is_active.value)

const run_badge = computed(() => {
    const map = {
        [RUN_STATUS.IDLE]: { label: '空闲', tone: 'idle' },
        [RUN_STATUS.SUBMITTING]: { label: '下发中', tone: 'info' },
        [RUN_STATUS.RUNNING]: { label: '运行中', tone: 'ok' },
        [RUN_STATUS.FINISHED]: { label: '已结束', tone: 'info' },
        [RUN_STATUS.FAILED]: { label: '失败', tone: 'error' },
    }
    return map[run.status] || map[RUN_STATUS.IDLE]
})

const category_hint = computed(() => {
    if (!form.category) {
        return '全品类：后端将处理检测到的全部目标'
    }
    return `品类标识：${form.category}（${get_category_label(form.category)}）`
})

// 结束标记文案：后端同步拒绝时任务根本没有启动，避免误显示为「进行中」
const finish_state_text = computed(() => {
    if (run.status === RUN_STATUS.FAILED) {
        return '下发失败（未启动）'
    }
    if (run.is_finished) {
        return 'is_finished = true'
    }
    if (run.status === RUN_STATUS.RUNNING || run.status === RUN_STATUS.SUBMITTING) {
        return '进行中'
    }
    return '—'
})

let unsubscribe = null

/**
 * 重置面板运行状态，不影响当前表单内容。
 * 返回：无。
 */
function reset_run_state() {
    run.status = RUN_STATUS.IDLE
    run.request_id = ''
    run.task_id = ''
    run.sorted_count = 0
    run.task_phase = ''
    run.is_finished = false
    run.planning_task_id = ''
    run.error = ''
    run.last_event_at = 0
}

/**
 * 校验分拣任务表单。
 * 返回：true 表示全部合法；否则在 errors 中写入中文提示。
 */
function validate_form() {
    errors.task_id = ''
    errors.category = ''
    errors.speed_level = ''
    const task_id = String(form.task_id || '').trim()
    if (!task_id) {
        errors.task_id = '任务 ID 不能为空'
    } else if (task_id.length > TASK_ID_MAX_LENGTH) {
        errors.task_id = `任务 ID 长度不能超过 ${TASK_ID_MAX_LENGTH} 个字符`
    }
    if (category_options.value.length > 0 && form.category && !category_options.value.includes(form.category)) {
        errors.category = '品类不在网关配置的品类列表内'
    }
    if (speed_options.value.length > 0 && !speed_options.value.includes(Number(form.speed_level))) {
        errors.speed_level = '速度等级不在网关配置的速度等级列表内'
    }
    return !errors.task_id && !errors.category && !errors.speed_level
}

/**
 * 把下发失败信息写入面板并记录事件日志。
 * 入参：message 中文错误提示。
 * 返回：无。
 */
function mark_submit_failed(message) {
    run.status = RUN_STATUS.FAILED
    run.error = message
    run.request_id = ''
    push_event({ source: 'ws', level: 'error', message: `分拣任务下发失败：${message}` })
}

/**
 * 构造 task_start 被网关/后端拒绝时的中文提示。
 * 区分两类失败（与前端网关契约一致）：
 *   1) 本地网关拒绝（TCP 未连接/未注册）→「后端未连接，任务未下发」；
 *   2) 后端调度拒绝（3003 忙碌 / 4000 算法模块离线 / 1000 参数非法）→ 展示后端原因。
 * 入参：event WS error 报文。
 * 返回：中文提示文本。
 */
function build_start_error_message(event) {
    const gateway_not_ready = !app_status.gateway.tcp_connected || !app_status.gateway.registered
    if (event.code === ERROR_CODES.TARGET_OFFLINE && (gateway_not_ready || !event.request_id)) {
        const detail = event.msg ? `（${event.msg}）` : ''
        return `后端未连接，任务未下发${detail}`
    }
    if (event.code === ERROR_CODES.ROBOT_BUSY) {
        return '已有任务正在运行，任务未下发（3003）'
    }
    if (event.code === ERROR_CODES.INVALID_PARAM) {
        return `任务参数非法，任务未下发：${event.msg || '参数校验失败'}（1000）`
    }
    const reason = event.msg || get_error_code_label(event.code)
    return `${reason}（错误码 ${event.code}）`
}

/**
 * 处理网关 error 报文：request_id 匹配的同步拒绝，或未连接时的 4000 本地拒绝。
 * 入参：event WS error 报文。
 * 返回：无。
 */
function handle_ws_error(event) {
    if (!is_active.value) {
        return
    }
    const matched = Boolean(event.request_id) && event.request_id === run.request_id
    const offline_rejection = event.code === ERROR_CODES.TARGET_OFFLINE && !event.request_id
    if (!matched && !offline_rejection) {
        return
    }
    mark_submit_failed(build_start_error_message(event))
}

/**
 * 处理 task_result 报文：按 data.task_id 匹配当前任务并更新进度。
 * 入参：event WS task_result 报文。
 * 返回：无。
 */
function handle_task_result(event) {
    const data = event && event.data && typeof event.data === 'object' ? event.data : {}
    if (!data.task_id || data.task_id !== run.task_id) {
        return
    }
    if (!is_active.value) {
        return
    }
    run.sorted_count = Number.isFinite(Number(data.sorted_count)) ? Number(data.sorted_count) : 0
    run.task_phase = typeof data.phase === 'string' ? data.phase : ''
    run.is_finished = data.is_finished === true
    if (typeof data.planning_task_id === 'string' && data.planning_task_id) {
        run.planning_task_id = data.planning_task_id
    }
    run.error = data.error ? format_error(data.error) : ''
    run.last_event_at = Date.now()
    if (data.is_finished) {
        run.status = run.error ? RUN_STATUS.FAILED : RUN_STATUS.FINISHED
        const level = run.status === RUN_STATUS.FINISHED ? 'success' : 'error'
        const message = run.error
            ? `分拣任务 ${run.task_id} 结束，失败原因：${run.error}`
            : `分拣任务 ${run.task_id} 已结束（仅规划模式，未执行真实抓取）`
        push_event({ source: 'ws', level, message })
        if (run.planning_task_id) {
            emit('view-task', run.planning_task_id)
        }
    } else if (run.status === RUN_STATUS.SUBMITTING) {
        run.status = RUN_STATUS.RUNNING
    }
}

/**
 * WS 事件统一入口：仅处理与分拣任务控制相关的事件。
 * 入参：event WsClient 下发的事件对象。
 * 返回：无。
 */
function handle_ws_event(event) {
    if (!event || typeof event.type !== 'string') {
        return
    }
    if (event.type === 'ack') {
        if (event.request_id && event.request_id === run.request_id) {
            run.status = RUN_STATUS.RUNNING
            run.last_event_at = Date.now()
            push_event({ source: 'ws', level: 'success', message: `网关已受理分拣任务：${run.task_id}` })
        }
        return
    }
    if (event.type === 'error') {
        handle_ws_error(event)
        return
    }
    if (event.type === 'task_result') {
        handle_task_result(event)
        return
    }
    if (event.type === 'state' && event.state === WS_STATE.DISCONNECTED && is_active.value) {
        push_event({
            source: 'ws',
            level: 'warn',
            message: '实时通道断开，任务进度更新可能延迟；重连后将恢复推送',
        })
    }
}

/**
 * 重新生成任务 ID。
 * 返回：无。
 */
function handle_regenerate_task_id() {
    form.task_id = generate_task_id()
    errors.task_id = ''
}

/**
 * 重置面板：清空运行态并生成新任务 ID。
 * 返回：无。
 */
function handle_reset() {
    reset_run_state()
    form.task_id = generate_task_id()
    errors.task_id = ''
    errors.category = ''
    errors.speed_level = ''
    push_event({ source: 'system', level: 'info', message: '已重置分拣任务控制面板' })
}

/**
 * 下发分拣任务：通过 WebSocket 发送 task_start。
 * 返回：无。
 */
function handle_submit() {
    if (is_active.value) {
        return
    }
    if (!validate_form()) {
        return
    }
    reset_run_state()
    run.task_id = String(form.task_id).trim()
    run.status = RUN_STATUS.SUBMITTING
    run.request_id = ''
    const send_result = ws_client.send_task_start({
        task_id: run.task_id,
        category: form.category,
        speed_level: Number(form.speed_level),
    })
    if (!send_result.sent) {
        mark_submit_failed('WebSocket 未连接，任务未下发')
        return
    }
    run.request_id = send_result.request_id
    push_event({
        source: 'ws',
        level: 'info',
        message: `已下发分拣任务 ${run.task_id}（品类：${get_category_label(form.category)}，`
            + `速度：${get_speed_level_label(form.speed_level)}），等待网关受理`,
    })
}

/**
 * 请求父组件加载 planning_task_id 对应的规划任务详情。
 * 返回：无。
 */
function handle_view_planning_task() {
    if (!run.planning_task_id) {
        return
    }
    emit('view-task', run.planning_task_id)
}

onMounted(() => {
    unsubscribe = ws_client.subscribe(handle_ws_event)
})

onBeforeUnmount(() => {
    if (unsubscribe) {
        unsubscribe()
        unsubscribe = null
    }
})
</script>

<template>
    <section class="panel">
        <header class="panel-header">
            <div class="panel-heading">
                <h2 class="panel-title">分拣任务控制</h2>
                <span class="panel-subtitle">经 WebSocket 下发 task_start，由后端调度算法与规划服务</span>
            </div>
            <div class="panel-actions">
                <span class="badge" :class="'badge--' + run_badge.tone">{{ run_badge.label }}</span>
                <span class="badge" :class="ws_connected ? 'badge--ok' : 'badge--error'">
                    实时通道{{ ws_connected ? '已连接' : '未连接' }}
                </span>
            </div>
        </header>
        <div class="panel-body stack-md">
            <p class="notice notice--info">
                <span>
                    第一阶段为<b>仅规划（plan_only）模式</b>：后端完成轨迹规划即结束，不执行真实抓取；
                    分拣计数仅在真实执行（placed）后递增，本阶段保持 0。
                </span>
            </p>
            <p v-if="!ws_connected" class="notice notice--warn">
                <span>WebSocket 未连接，任务无法下发；系统正在按 1s/3s/5s 递增间隔自动重连。</span>
            </p>

            <form class="stack-md" novalidate @submit.prevent="handle_submit">
                <div class="form-grid">
                    <div class="field form-grid--full">
                        <label class="field-label" for="task-id-input">
                            分拣任务 ID <span class="field-required">*</span>
                        </label>
                        <div class="field-control">
                            <input
                                id="task-id-input"
                                v-model="form.task_id"
                                class="input input--mono"
                                type="text"
                                :maxlength="TASK_ID_MAX_LENGTH"
                                placeholder="例如 sort-20261111-120715-a1b2"
                                autocomplete="off"
                            />
                            <button class="btn btn--ghost btn--sm" type="button" @click="handle_regenerate_task_id">
                                重新生成
                            </button>
                        </div>
                        <span v-if="errors.task_id" class="field-error">{{ errors.task_id }}</span>
                        <span v-else class="field-hint">可手动编辑；后端要求非空且长度不超过 256 个字符</span>
                    </div>

                    <div class="field">
                        <label class="field-label" for="task-category-select">分拣品类</label>
                        <select id="task-category-select" v-model="form.category" class="select">
                            <option value="">全品类</option>
                            <option v-for="category in category_options" :key="category" :value="category">
                                {{ get_category_label(category) }}
                            </option>
                        </select>
                        <span v-if="errors.category" class="field-error">{{ errors.category }}</span>
                        <span v-else class="field-hint">{{ category_hint }}</span>
                    </div>

                    <div class="field">
                        <label class="field-label" for="task-speed-select">速度等级</label>
                        <select id="task-speed-select" v-model.number="form.speed_level" class="select">
                            <option v-for="level in speed_options" :key="level" :value="level">
                                {{ get_speed_level_label(level) }}
                            </option>
                        </select>
                        <span v-if="errors.speed_level" class="field-error">{{ errors.speed_level }}</span>
                        <span v-else class="field-hint">速度等级随报文下发；第一阶段后端暂不参与规划计算</span>
                    </div>
                </div>

                <div class="btn-row">
                    <button class="btn btn--primary" type="submit" :disabled="!can_submit">
                        {{ is_active ? '任务进行中…' : '下发分拣任务' }}
                    </button>
                    <button class="btn btn--ghost" type="button" @click="handle_reset">重置任务</button>
                    <span class="field-hint">提交后经前端网关转发至后端内部 TCP 调度服务</span>
                </div>
            </form>

            <div v-if="run.status !== RUN_STATUS.IDLE" class="run-state">
                <div class="run-metrics">
                    <div class="run-metric">
                        <span class="run-metric-label">已分拣数量</span>
                        <span class="run-metric-value">{{ run.sorted_count }}</span>
                        <span class="run-metric-note">仅真实执行后递增</span>
                    </div>
                    <div class="run-metric">
                        <span class="run-metric-label">任务阶段</span>
                        <span class="run-metric-text">{{ get_phase_label(run.task_phase) }}</span>
                        <span class="run-metric-note">来自 task_result.phase</span>
                    </div>
                    <div class="run-metric">
                        <span class="run-metric-label">结束标记</span>
                        <span class="run-metric-text">{{ finish_state_text }}</span>
                        <span class="run-metric-note">来自 task_result.is_finished</span>
                    </div>
                    <div class="run-metric">
                        <span class="run-metric-label">最近事件</span>
                        <span class="run-metric-text text-mono text-sm">{{ format_time_ms(run.last_event_at) }}</span>
                        <span class="run-metric-note">最近一次 task_result/ack 时间</span>
                    </div>
                </div>

                <div class="run-kv">
                    <div class="run-kv-item">
                        <span class="kv-label">分拣任务 ID</span>
                        <span class="kv-value text-mono">{{ run.task_id }}</span>
                    </div>
                    <div class="run-kv-item">
                        <span class="kv-label">规划任务 ID（planning_task_id）</span>
                        <span class="kv-value text-mono">{{ run.planning_task_id || '尚未产生' }}</span>
                    </div>
                    <div class="run-kv-action">
                        <button
                            class="btn btn--ghost btn--sm"
                            type="button"
                            :disabled="!run.planning_task_id"
                            @click="handle_view_planning_task"
                        >
                            查询规划任务详情
                        </button>
                    </div>
                </div>

                <p v-if="run.error" class="notice notice--error">
                    <span>{{ run.error }}</span>
                </p>
                <p v-else-if="run.status === RUN_STATUS.FINISHED" class="notice notice--success">
                    <span>任务已结束：规划结果可在下方「任务详情 / 六轴关节轨迹」查看；本阶段未执行真实抓取。</span>
                </p>
            </div>
        </div>
    </section>
</template>

<style scoped>
.run-state {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-top: 14px;
    border-top: 1px dashed var(--color-border);
}

.run-metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 10px;
}

.run-metric {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-muted);
    min-width: 0;
}

.run-metric-label {
    color: var(--color-text-muted);
    font-size: 11.5px;
}

.run-metric-value {
    font-family: var(--font-mono);
    font-size: 26px;
    font-weight: 700;
    line-height: 1.15;
    color: var(--color-primary);
}

.run-metric-text {
    font-size: 14px;
    font-weight: 700;
    color: var(--color-text);
    word-break: break-all;
}

.run-metric-note {
    color: var(--color-text-muted);
    font-size: 11px;
}

.run-kv {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 10px 16px;
    align-items: end;
}

.run-kv-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}

.run-kv-action {
    display: flex;
    align-items: flex-end;
}

.btn-row {
    align-items: center;
}
</style>
