<!--
    文件功能：规划提交面板：填写世界坐标系目标位姿与夹持力，POST /api/robot/plan 后轮询任务至终态，
              展示规划摘要并把任务详情回传给总览页用于轨迹绘制
    作者：VisRLFlexGrasp 项目组
    创建日期：2026-11-11
-->
<script setup>
import { computed, reactive, ref } from 'vue'

import { backend_api } from '../api/backend_api.js'
import { ApiError } from '../api/http_client.js'
import {
    DEFAULT_GRASP_POSE,
    ERROR_CODES,
    FORCE_LIMIT_MAX,
    FORCE_LIMIT_MIN,
    FORCE_LIMIT_STEP,
    PLAN_POLL_TIMEOUT_MS,
    POSITION_INPUT_STEP,
    QUATERNION_INPUT_STEP,
    QUATERNION_NORM_MIN,
} from '../config/defaults.js'
import { use_event_log } from '../composables/use_event_log.js'
import { use_polling } from '../composables/use_polling.js'
import { use_settings } from '../composables/use_settings.js'
import {
    format_boolean,
    format_error,
    format_number,
    format_time_ms,
    get_task_status_label,
    get_task_status_tone,
    is_task_terminal,
} from '../utils/format.js'

const emit = defineEmits(['task-loaded'])

const { effective } = use_settings()
const { push_event } = use_event_log()

const poll_interval_ms = computed(() => effective.value.poll_interval_ms)

const form = reactive({
    position: [...DEFAULT_GRASP_POSE.position],
    orientation: [...DEFAULT_GRASP_POSE.orientation],
    force_limit: effective.value.default_force_limit,
})

const errors = reactive({
    position: '',
    orientation: '',
    force_limit: '',
    submit: '',
})

const submitting = ref(false)
const planning_task_id = ref('')
const task_record = ref(null)
const poll_deadline_ms = ref(0)

const result = computed(() => (task_record.value && task_record.value.result) || null)
const result_status = computed(() => (task_record.value ? task_record.value.status : ''))
const result_tone = computed(() => (task_record.value ? get_task_status_tone(task_record.value.status) : 'idle'))
const result_summary = computed(() => {
    if (!result.value) {
        return []
    }
    const trajectory = Array.isArray(result.value.joint_trajectory) ? result.value.joint_trajectory : []
    return [
        { label: '规划时长', value: format_number(result.value.duration_sec, 3, 's') },
        { label: '轨迹点', value: String(trajectory.length) },
        { label: '可行解数量', value: format_number(result.value.solution_count, 0) },
        { label: '真实执行', value: `${format_boolean(result.value.executed)}（仅规划）` },
    ]
})

/**
 * 数值解析：空串与非有限数返回 null，便于区分 0 与未填写。
 * 入参：value 表单项原始值。
 * 返回：有限数值或 null。
 */
function parse_number(value) {
    if (value === '' || value === null || value === undefined) {
        return null
    }
    const numeric_value = Number(value)
    return Number.isFinite(numeric_value) ? numeric_value : null
}

/**
 * 校验规划请求表单。
 * 返回：true 表示合法；否则在 errors 中写入中文提示。
 */
function validate_form() {
    errors.position = ''
    errors.orientation = ''
    errors.force_limit = ''
    errors.submit = ''
    const position_values = form.position.map(parse_number)
    if (position_values.some((value) => value === null)) {
        errors.position = '目标位置需为三个有限数值（单位：米）'
    }
    const orientation_values = form.orientation.map(parse_number)
    if (orientation_values.some((value) => value === null)) {
        errors.orientation = '四元数需为四个有限数值'
    } else {
        const norm = Math.hypot(...orientation_values)
        if (!(norm > QUATERNION_NORM_MIN)) {
            errors.orientation = '四元数范数必须为正数，禁止全零输入'
        }
    }
    const force_value = parse_number(form.force_limit)
    if (force_value === null) {
        errors.force_limit = '夹持力需为有限数值'
    } else if (force_value < FORCE_LIMIT_MIN || force_value > FORCE_LIMIT_MAX) {
        errors.force_limit = `夹持力需在 ${FORCE_LIMIT_MIN} ~ ${FORCE_LIMIT_MAX} N 之间`
    }
    return !errors.position && !errors.orientation && !errors.force_limit
}

/**
 * 轮询规划任务直到终态；由 use_polling 按界面配置的轮询周期调度。
 * 返回：Promise<void>。
 */
async function poll_planning_task() {
    const task_id = planning_task_id.value
    if (!task_id) {
        stop_plan_polling()
        return
    }
    if (poll_deadline_ms.value > 0 && Date.now() > poll_deadline_ms.value) {
        stop_plan_polling()
        submitting.value = false
        errors.submit = `等待规划结果超时（${PLAN_POLL_TIMEOUT_MS / 1000} 秒），请稍后在任务查询页按任务 ID 查询`
        push_event({ source: 'http', level: 'warn', message: `规划任务 ${task_id} 轮询超时，请稍后查询终态` })
        return
    }
    try {
        const record = await backend_api.get_task(task_id)
        task_record.value = record
        if (record && is_task_terminal(record.status)) {
            stop_plan_polling()
            submitting.value = false
            const is_success = record.status === 'planned'
            const failure = record.error
                || { code: ERROR_CODES.MOTION_EXEC_FAILED, msg: get_task_status_label(record.status) }
            errors.submit = is_success ? '' : format_error(failure)
            push_event({
                source: 'http',
                level: is_success ? 'success' : 'error',
                message: `规划任务 ${task_id} 结束：${get_task_status_label(record.status)}`
                    + (record.error ? `，${format_error(record.error)}` : ''),
            })
            emit('task-loaded', record)
        }
    } catch (error) {
        stop_plan_polling()
        submitting.value = false
        errors.submit = format_error(error)
        push_event({ source: 'http', level: 'error', message: `规划任务查询失败：${format_error(error)}` })
    }
}

const { start: start_plan_polling, stop: stop_plan_polling } = use_polling(poll_planning_task, {
    interval_ms: poll_interval_ms,
    immediate: true,
})

/**
 * 提交规划请求并在成功后开始轮询任务终态。
 * 返回：Promise<void>。
 */
async function handle_submit() {
    if (submitting.value) {
        return
    }
    if (!validate_form()) {
        return
    }
    errors.submit = ''
    task_record.value = null
    planning_task_id.value = ''
    submitting.value = true
    try {
        const data = await backend_api.submit_plan({
            grasp_pose: {
                position: form.position.map((value) => Number(value)),
                orientation: form.orientation.map((value) => Number(value)),
            },
            force_limit: Number(form.force_limit),
        })
        const task_id = data && data.task_id ? String(data.task_id) : ''
        if (!task_id) {
            throw new ApiError({ code: ERROR_CODES.INVALID_MESSAGE, msg: '网关响应缺少 task_id' })
        }
        planning_task_id.value = task_id
        poll_deadline_ms.value = Date.now() + PLAN_POLL_TIMEOUT_MS
        push_event({
            source: 'http',
            level: 'success',
            message: `规划请求已受理（HTTP 202），任务 ID：${task_id}，状态 planning，开始轮询结果`,
        })
        start_plan_polling()
    } catch (error) {
        submitting.value = false
        errors.submit = format_error(error)
        push_event({ source: 'http', level: 'error', message: `规划提交失败：${format_error(error)}` })
    }
}

/**
 * 恢复仓库示例位姿与默认夹持力。
 * 返回：无。
 */
function handle_reset_pose() {
    form.position = [...DEFAULT_GRASP_POSE.position]
    form.orientation = [...DEFAULT_GRASP_POSE.orientation]
    form.force_limit = effective.value.default_force_limit
    errors.position = ''
    errors.orientation = ''
    errors.force_limit = ''
    errors.submit = ''
    push_event({ source: 'system', level: 'info', message: '已恢复示例目标位姿与默认夹持力' })
}
</script>

<template>
    <section class="panel">
        <header class="panel-header">
            <div class="panel-heading">
                <h2 class="panel-title">规划提交</h2>
                <span class="panel-subtitle">POST /api/robot/plan → 轮询 GET /api/tasks/{task_id} 至终态</span>
            </div>
            <div class="panel-actions">
                <span v-if="submitting" class="badge badge--info">
                    <span class="dot dot--info dot--pulse"></span>规划中
                </span>
                <span v-else-if="task_record" class="badge" :class="'badge--' + result_tone">
                    {{ get_task_status_label(result_status) }}
                </span>
            </div>
        </header>
        <div class="panel-body stack-md">
            <p class="notice notice--info">
                <span>
                    仅规划模式：提交世界坐标系 TCP 目标后，后端返回关节目标与连续轨迹（executed=false），
                    不驱动机械臂；示例位姿来自仓库场景基准，不承诺可达。
                </span>
            </p>

            <form class="stack-md" novalidate @submit.prevent="handle_submit">
                <div class="form-section">
                    <h3 class="form-section-title">目标位置（世界坐标系，单位：米）</h3>
                    <div class="form-grid form-grid--three">
                        <div class="field">
                            <label class="field-label" for="plan-x-input">X</label>
                            <input
                                id="plan-x-input"
                                v-model.number="form.position[0]"
                                class="input text-mono"
                                type="number"
                                :step="POSITION_INPUT_STEP"
                            />
                        </div>
                        <div class="field">
                            <label class="field-label" for="plan-y-input">Y</label>
                            <input
                                id="plan-y-input"
                                v-model.number="form.position[1]"
                                class="input text-mono"
                                type="number"
                                :step="POSITION_INPUT_STEP"
                            />
                        </div>
                        <div class="field">
                            <label class="field-label" for="plan-z-input">Z</label>
                            <input
                                id="plan-z-input"
                                v-model.number="form.position[2]"
                                class="input text-mono"
                                type="number"
                                :step="POSITION_INPUT_STEP"
                            />
                        </div>
                    </div>
                    <span v-if="errors.position" class="field-error">{{ errors.position }}</span>
                </div>

                <div class="form-section">
                    <h3 class="form-section-title">目标姿态四元数（[qx, qy, qz, qw]，后端自动归一化）</h3>
                    <div class="form-grid form-grid--four">
                        <div class="field">
                            <label class="field-label" for="plan-qx-input">QX</label>
                            <input
                                id="plan-qx-input"
                                v-model.number="form.orientation[0]"
                                class="input text-mono"
                                type="number"
                                :step="QUATERNION_INPUT_STEP"
                            />
                        </div>
                        <div class="field">
                            <label class="field-label" for="plan-qy-input">QY</label>
                            <input
                                id="plan-qy-input"
                                v-model.number="form.orientation[1]"
                                class="input text-mono"
                                type="number"
                                :step="QUATERNION_INPUT_STEP"
                            />
                        </div>
                        <div class="field">
                            <label class="field-label" for="plan-qz-input">QZ</label>
                            <input
                                id="plan-qz-input"
                                v-model.number="form.orientation[2]"
                                class="input text-mono"
                                type="number"
                                :step="QUATERNION_INPUT_STEP"
                            />
                        </div>
                        <div class="field">
                            <label class="field-label" for="plan-qw-input">QW</label>
                            <input
                                id="plan-qw-input"
                                v-model.number="form.orientation[3]"
                                class="input text-mono"
                                type="number"
                                :step="QUATERNION_INPUT_STEP"
                            />
                        </div>
                    </div>
                    <span v-if="errors.orientation" class="field-error">{{ errors.orientation }}</span>
                </div>

                <div class="form-grid">
                    <div class="field">
                        <label class="field-label" for="plan-force-input">夹持力上限（N）</label>
                        <input
                            id="plan-force-input"
                            v-model.number="form.force_limit"
                            class="input text-mono"
                            type="number"
                            :min="FORCE_LIMIT_MIN"
                            :max="FORCE_LIMIT_MAX"
                            :step="FORCE_LIMIT_STEP"
                        />
                        <span v-if="errors.force_limit" class="field-error">{{ errors.force_limit }}</span>
                        <span v-else class="field-hint">
                            取值范围 {{ FORCE_LIMIT_MIN }} ~ {{ FORCE_LIMIT_MAX }} N；仅作为规划元数据，不执行力控
                        </span>
                    </div>
                    <div class="field field--actions">
                        <span class="field-label">操作</span>
                        <div class="btn-row">
                            <button class="btn btn--primary" type="submit" :disabled="submitting">
                                {{ submitting ? '规划中…' : '提交规划请求' }}
                            </button>
                            <button class="btn btn--ghost" type="button" @click="handle_reset_pose">
                                恢复示例位姿
                            </button>
                        </div>
                    </div>
                </div>
            </form>

            <p v-if="errors.submit" class="notice notice--error">
                <span>{{ errors.submit }}</span>
            </p>

            <div v-if="planning_task_id" class="plan-progress">
                <div class="plan-progress-head">
                    <span class="kv-label">规划任务 ID</span>
                    <span class="kv-value text-mono">{{ planning_task_id }}</span>
                </div>
                <div class="kv-list">
                    <div class="kv-item">
                        <span class="kv-label">任务状态</span>
                        <span class="kv-value">
                            {{ result ? get_task_status_label(result_status) : '规划中（planning）' }}
                        </span>
                    </div>
                    <div class="kv-item">
                        <span class="kv-label">提交时间</span>
                        <span class="kv-value text-mono">
                            {{ format_time_ms(task_record ? task_record.created_at : Date.now()) }}
                        </span>
                    </div>
                    <div class="kv-item">
                        <span class="kv-label">轮询超时上限</span>
                        <span class="kv-value text-mono">{{ PLAN_POLL_TIMEOUT_MS / 1000 }} s</span>
                    </div>
                </div>
                <div v-if="result_summary.length > 0" class="chip-row">
                    <span v-for="item in result_summary" :key="item.label" class="chip">
                        <span class="text-muted">{{ item.label }}</span>
                        <strong class="text-mono">{{ item.value }}</strong>
                    </span>
                </div>
                <p v-if="!result" class="field-hint">正在按界面轮询周期查询任务终态，规划完成后轨迹将加载到下方图表。</p>
                <p v-else class="field-hint">规划完成（planned，未执行真实抓取），关节目标与轨迹已载入下方图表。</p>
            </div>
        </div>
    </section>
</template>

<style scoped>
.form-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.form-section-title {
    color: var(--color-text-secondary);
    font-size: 12.5px;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 7px;
}

.form-section-title::before {
    content: "";
    display: inline-block;
    width: 3px;
    height: 12px;
    border-radius: var(--radius-pill);
    background: var(--color-primary);
}

.field--actions {
    justify-content: flex-end;
}

.plan-progress {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px;
    border: 1px dashed var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-muted);
}

.plan-progress-head {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
}

.chip-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}
</style>
