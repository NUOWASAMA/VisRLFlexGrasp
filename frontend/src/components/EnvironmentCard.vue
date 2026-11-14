<!--
    文件功能：运行环境入口页的环境按钮：深色玻璃卡面、指针倾斜与跟随高光、扫光与辉光效果（样式见 assets/env-card.css）
    作者：VisRLFlexGrasp 项目组
    创建日期：2026-11-14
-->
<script setup>
import { ENV_MODES } from '../config/defaults.js'

defineProps({
    // 环境选项：{ key, index, en, label, description, spec, enter_label, status_available, status_unavailable }
    option: {
        type: Object,
        required: true,
    },
    // 该环境当前是否可用（仿真恒可用；真实取决于硬件适配器）
    available: {
        type: Boolean,
        default: true,
    },
    // 状态文案（可用 / 未接入预览）
    statusText: {
        type: String,
        default: '',
    },
    // 是否为后端当前记录的环境
    isCurrent: {
        type: Boolean,
        default: false,
    },
    // 是否禁止点击（有环境正在切换）
    busy: {
        type: Boolean,
        default: false,
    },
    // 是否正在进入该环境
    switching: {
        type: Boolean,
        default: false,
    },
})

const emit = defineEmits(['choose'])

/**
 * 鼠标移动时更新卡面 3D 倾斜与跟随高光位置（CSS 自定义属性由卡面继承）。
 * 入参：event pointermove 事件。
 * 返回：无。
 */
function handle_pointer_move(event) {
    const element = event.currentTarget
    if (!element) {
        return
    }
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
        return
    }
    const relative_x = (event.clientX - rect.left) / rect.width
    const relative_y = (event.clientY - rect.top) / rect.height
    element.style.setProperty('--tilt-x', `${(relative_x - 0.5) * 7}`)
    element.style.setProperty('--tilt-y', `${(relative_y - 0.5) * -7}`)
    element.style.setProperty('--glow-x', `${relative_x * 100}%`)
    element.style.setProperty('--glow-y', `${relative_y * 100}%`)
}

/**
 * 鼠标离开时复位倾斜与高光。
 * 入参：event pointerleave 事件。
 * 返回：无。
 */
function handle_pointer_leave(event) {
    const element = event.currentTarget
    if (!element) {
        return
    }
    element.style.setProperty('--tilt-x', '0')
    element.style.setProperty('--tilt-y', '0')
    element.style.setProperty('--glow-x', '50%')
    element.style.setProperty('--glow-y', '0%')
}
</script>

<template>
    <button
        class="env-card"
        :class="[`env-card--${option.key}`, { 'env-card--current': isCurrent }]"
        type="button"
        :disabled="busy"
        :aria-busy="switching"
        :aria-label="`${option.enter_label}：${option.description}`"
        @pointermove="handle_pointer_move"
        @pointerleave="handle_pointer_leave"
        @click="emit('choose')"
    >
        <span class="env-card__surface">
            <span class="env-card__sheen" aria-hidden="true"></span>

            <svg
                v-if="option.key === ENV_MODES.SIM"
                class="env-card__glyph"
                viewBox="0 0 120 120"
                aria-hidden="true"
            >
                <ellipse cx="56" cy="97" rx="33" ry="9" />
                <path d="M56 97 L56 70 L78 56 L92 64" />
                <path d="M92 64 L99 74" />
                <circle cx="56" cy="70" r="3.4" />
                <circle cx="78" cy="56" r="3.4" />
                <circle cx="92" cy="64" r="3" />
                <path d="M34 38 C38 32 46 32 50 38" class="env-card__glyph-wave" />
                <path d="M28 30 C35 21 49 21 56 30" class="env-card__glyph-wave" />
            </svg>
            <svg v-else class="env-card__glyph" viewBox="0 0 120 120" aria-hidden="true">
                <path d="M23 97 H97" class="env-card__glyph-dash" />
                <ellipse cx="56" cy="97" rx="33" ry="9" />
                <path d="M56 97 L56 70 L78 56 L92 64" />
                <path d="M92 64 L92 76 M87 78 L97 78 M89 84 L95 84" />
                <circle cx="56" cy="70" r="3.4" />
                <circle cx="78" cy="56" r="3.4" />
                <circle cx="92" cy="64" r="3" />
                <path d="M100 30 C104 36 104 44 100 50" class="env-card__glyph-wave" />
                <path d="M106 24 C113 34 113 46 106 56" class="env-card__glyph-wave" />
            </svg>

            <span class="env-card__meta">
                <span class="env-card__index">{{ option.index }}</span>
                <span class="env-card__en">{{ option.en }}</span>
                <span class="env-card__spec">{{ option.spec }}</span>
            </span>
            <span class="env-card__body">
                <span class="env-card__label">{{ option.label }}</span>
                <span class="env-card__description">{{ option.description }}</span>
            </span>
            <span class="env-card__status" :class="{ 'env-card__status--offline': !available }">
                <span class="env-card__status-dot" aria-hidden="true"></span>
                <span>{{ statusText }}</span>
            </span>
            <span class="env-card__foot">
                <span class="env-card__cta">
                    <template v-if="switching">正在进入…</template>
                    <template v-else>{{ option.enter_label }}</template>
                </span>
                <span v-if="isCurrent && !switching" class="env-card__current">当前环境</span>
                <span v-else class="env-card__arrow" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                        <path d="M4 12 H19 M13 6 L19 12 L13 18" />
                    </svg>
                </span>
            </span>
        </span>
    </button>
</template>
