<!--
    文件功能：运行环境入口页：项目介绍 + 仿真 / 真实两个环境按钮，调用后端切换环境并进入可视化界面
    作者：VisRLFlexGrasp 项目组
    创建日期：2026-11-14
-->
<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import EnvironmentCard from '../components/EnvironmentCard.vue'
import {
    APP_NAME,
    APP_TITLE,
    APP_VERSION,
    ENV_MODES,
    ENV_MODE_OPTIONS,
    PORTAL_EYEBROW,
    PORTAL_FACTS,
    PORTAL_FOOTER_LEFT,
    PORTAL_FOOTER_RIGHT,
    PORTAL_HINT,
    PORTAL_LEDE,
    PORTAL_TITLE,
} from '../config/defaults.js'
import {
    apply_local_environment_mode,
    load_environment_mode,
    switch_environment_mode,
    use_environment_mode,
} from '../composables/use_environment_mode.js'
import { format_error } from '../utils/format.js'

const router = useRouter()
const environment = use_environment_mode()

// 当前正在切换的目标模式（空串表示空闲），用于禁用按钮与展示进入状态
const switching_mode = ref('')
// 切换失败提示：后端不可达时本地降级进入，并保留可读说明
const switch_error = ref('')

const is_busy = computed(() => switching_mode.value !== '')

/**
 * 计算某个环境的按钮状态文案。
 * 入参：option 环境选项。
 * 返回：{ available, status_text, is_current }。
 */
function describe_option(option) {
    const available = option.key === ENV_MODES.SIM || Boolean(environment.hardware.available)
    return {
        available,
        status_text: available ? option.status_available : option.status_unavailable,
        is_current: environment.loaded && environment.mode === option.key,
    }
}

/**
 * 选择环境：调用后端持久化模式，成功后进入总览；后端不可达时本地降级并提示。
 * 入参：option 环境选项。
 * 返回：Promise<void>。
 */
async function choose_environment(option) {
    if (is_busy.value) {
        return
    }
    switching_mode.value = option.key
    switch_error.value = ''
    try {
        await switch_environment_mode(option.key)
    } catch (error) {
        apply_local_environment_mode(option.key)
        switch_error.value = `后端环境接口不可用，已按本地模式进入（${format_error(error)}）`
        await new Promise((resolve) => setTimeout(resolve, 620))
    } finally {
        switching_mode.value = ''
    }
    await router.push({ name: 'dashboard' })
}

onMounted(() => {
    // 进入入口页时刷新一次后端状态，用于展示硬件可用性与上次选择
    void load_environment_mode()
})
</script>

<template>
    <div class="portal">
        <div class="portal__ambience" aria-hidden="true">
            <div class="portal__aura portal__aura--sim"></div>
            <div class="portal__aura portal__aura--real"></div>
            <div class="portal__grid"></div>
            <svg class="portal__grain" aria-hidden="true">
                <defs>
                    <filter id="portal-noise" x="0" y="0" width="100%" height="100%">
                        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
                    </filter>
                </defs>
                <rect width="100%" height="100%" filter="url(#portal-noise)"></rect>
            </svg>
            <div class="portal__vignette"></div>
        </div>

        <div class="portal__frame">
            <header class="portal__top">
                <div class="portal__brand">
                    <svg class="portal__logo" viewBox="0 0 64 64" role="img" :aria-label="APP_NAME">
                        <defs>
                            <linearGradient id="portal-logo-gradient" x1="0" y1="0" x2="1" y2="1">
                                <stop offset="0%" stop-color="#69d043" />
                                <stop offset="100%" stop-color="#4f9dff" />
                            </linearGradient>
                        </defs>
                        <rect
                            x="2"
                            y="2"
                            width="60"
                            height="60"
                            rx="15"
                            fill="#0b1218"
                            stroke="url(#portal-logo-gradient)"
                            stroke-width="1.4"
                        />
                        <path
                            d="M18 21 L32 45 L46 21"
                            fill="none"
                            stroke="url(#portal-logo-gradient)"
                            stroke-width="4.6"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        />
                        <path
                            d="M32 21 C34 13 42 11 47 13 C44 19 38 22 32 21 Z"
                            fill="url(#portal-logo-gradient)"
                            opacity="0.9"
                        />
                    </svg>
                    <div class="portal__brand-text">
                        <span class="portal__wordmark">{{ APP_NAME }}</span>
                        <span class="portal__wordmark-sub">{{ APP_TITLE }}</span>
                    </div>
                </div>
                <div class="portal__top-meta">
                    <span class="portal__meta-version">{{ APP_VERSION }}</span>
                    <span class="portal__meta-chip">仅规划 · PLAN ONLY</span>
                </div>
            </header>

            <main class="portal__main">
                <section class="portal__intro" aria-labelledby="portal-title">
                    <p class="portal__eyebrow">{{ PORTAL_EYEBROW }}</p>
                    <h1 id="portal-title" class="portal__title">{{ PORTAL_TITLE }}</h1>
                    <p class="portal__lede">{{ PORTAL_LEDE }}</p>
                    <ul class="portal__facts">
                        <li v-for="fact in PORTAL_FACTS" :key="fact.index" class="portal__fact">
                            <span class="portal__fact-index">{{ fact.index }}</span>
                            <span class="portal__fact-label">{{ fact.label }}</span>
                            <span class="portal__fact-detail">{{ fact.detail }}</span>
                        </li>
                    </ul>
                </section>

                <section class="portal__choices" aria-label="运行环境选择">
                    <template v-for="(option, index) in ENV_MODE_OPTIONS" :key="option.key">
                        <EnvironmentCard
                            :option="option"
                            :available="describe_option(option).available"
                            :status-text="describe_option(option).status_text"
                            :is-current="describe_option(option).is_current"
                            :busy="is_busy"
                            :switching="switching_mode === option.key"
                            @choose="choose_environment(option)"
                        />
                        <div v-if="index === 0" class="portal__divider" aria-hidden="true">
                            <span class="portal__divider-orb"></span>
                        </div>
                    </template>
                </section>

                <p v-if="switch_error" class="portal__error" role="status">{{ switch_error }}</p>
                <p class="portal__hint">{{ PORTAL_HINT }}</p>
            </main>

            <footer class="portal__footer">
                <span>{{ PORTAL_FOOTER_LEFT }}</span>
                <span>{{ PORTAL_FOOTER_RIGHT }}</span>
            </footer>
        </div>
    </div>
</template>
