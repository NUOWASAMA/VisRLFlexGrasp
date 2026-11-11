<!--
    文件功能：应用顶栏组件：系统标识、路由导航与连接状态（WebSocket / 后端 / 执行模式 / 环境）
    作者：VisRLFlexGrasp 项目组
    创建日期：2026-11-11
-->
<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { NAV_ITEMS, WS_STATE } from '../config/defaults.js'
import { use_app_config } from '../composables/use_app_config.js'
import { use_app_status } from '../composables/use_app_status.js'
import { WS_STATE_LABELS } from '../utils/format.js'

const route = useRoute()
const app_config = use_app_config()
const { app_status, backend_online, gateway_registered, gateway_tcp_connected } = use_app_status()

// WebSocket 状态：已连接为绿色、连接中为黄色、断开为红色
const ws_tone = computed(() => {
    if (app_status.ws_state === WS_STATE.CONNECTED) {
        return 'ok'
    }
    if (app_status.ws_state === WS_STATE.CONNECTING) {
        return 'warn'
    }
    return 'error'
})

const ws_label = computed(() => WS_STATE_LABELS[app_status.ws_state] || '未知')

const ws_title = computed(() => {
    if (app_status.ws_state === WS_STATE.CONNECTED) {
        return 'WebSocket 实时通道已建立，断线后按 1s/3s/5s 递增重连'
    }
    if (app_status.ws_state === WS_STATE.CONNECTING) {
        return `正在连接前端网关 WebSocket（第 ${app_status.ws_reconnect_attempt} 次尝试）`
    }
    return `WebSocket 未连接，正在自动重连（第 ${app_status.ws_reconnect_attempt} 次尝试）`
})

const backend_tone = computed(() => (backend_online.value ? 'ok' : 'error'))
const backend_label = computed(() => (backend_online.value ? '后端在线' : '后端离线'))
const backend_title = computed(() => (
    `网关内部 TCP ${gateway_tcp_connected.value ? '已连接' : '未连接'}`
    + ` · 模块注册${gateway_registered.value ? '已完成' : '未完成'}`
))

const env_label = computed(() => (app_config.env ? app_config.env.toUpperCase() : '环境未知'))
const env_tone = computed(() => (app_config.env === 'real' ? 'warn' : 'idle'))

/**
 * 判断导航项是否为当前激活路由。
 * 入参：item 导航项 { name }。
 * 返回：布尔值。
 */
function is_active_nav(item) {
    return route.name === item.name
}
</script>

<template>
    <header class="app-header">
        <div class="header-inner">
            <div class="brand">
                <svg class="brand-logo" viewBox="0 0 64 64" role="img" aria-label="VisRLFlexGrasp 标志">
                    <rect x="2" y="2" width="60" height="60" rx="14" fill="#12483a" />
                    <path
                        d="M18 20 L32 46 L46 20"
                        fill="none"
                        stroke="#69d043"
                        stroke-width="6"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    />
                    <path d="M32 20 C34 12 42 10 48 12 C44 18 38 21 32 20 Z" fill="#69d043" />
                </svg>
                <div class="brand-text">
                    <span class="brand-name">VisRLFlexGrasp</span>
                    <span class="brand-sub">自适应柔性抓取果蔬分拣系统</span>
                </div>
            </div>

            <nav class="app-nav" aria-label="主导航">
                <RouterLink
                    v-for="item in NAV_ITEMS"
                    :key="item.name"
                    :to="item.path"
                    class="nav-link"
                    :class="{ 'nav-link--active': is_active_nav(item) }"
                >
                    {{ item.label }}
                </RouterLink>
            </nav>

            <div class="header-status">
                <span class="status-pill" :title="ws_title">
                    <span
                        class="dot"
                        :class="['dot--' + ws_tone, { 'dot--pulse': app_status.ws_state === 'connecting' }]"
                    ></span>
                    WS {{ ws_label }}
                </span>
                <span class="status-pill" :title="backend_title">
                    <span class="dot" :class="'dot--' + backend_tone"></span>
                    {{ backend_label }}
                </span>
                <span class="mode-badge" title="第一阶段仅规划，不执行真实抓取">仅规划模式</span>
                <span class="env-badge" :class="'env-badge--' + env_tone" :title="`当前环境：${env_label}`">
                    {{ env_label }}
                </span>
            </div>
        </div>
    </header>
</template>

<style scoped>
.app-header {
    position: sticky;
    top: 0;
    z-index: 30;
    background:
        radial-gradient(circle at 88% -40%, rgba(105, 208, 67, 0.22), transparent 55%),
        linear-gradient(118deg, #0d3527 0%, #14503c 52%, #1d6b50 100%);
    box-shadow: 0 10px 30px -20px rgba(0, 0, 0, 0.55);
}

.app-header::after {
    content: "";
    display: block;
    height: 2px;
    background: linear-gradient(90deg, var(--color-accent) 0%, rgba(105, 208, 67, 0.35) 38%, transparent 82%);
}

.header-inner {
    display: flex;
    align-items: center;
    gap: 24px;
    max-width: var(--content-max-width);
    margin: 0 auto;
    padding: 12px 24px;
    flex-wrap: wrap;
}

.brand {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
}

.brand-logo {
    width: 42px;
    height: 42px;
    flex: none;
    filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.28));
}

.brand-text {
    display: flex;
    flex-direction: column;
    line-height: 1.25;
    min-width: 0;
}

.brand-name {
    color: #f3fbf6;
    font-size: 17px;
    font-weight: 700;
    letter-spacing: 0.6px;
}

.brand-sub {
    color: rgba(226, 245, 234, 0.72);
    font-size: 11.5px;
    letter-spacing: 0.3px;
}

.app-nav {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
}

.nav-link {
    padding: 7px 15px;
    border-radius: var(--radius-pill);
    color: rgba(232, 248, 239, 0.78);
    font-size: 13.5px;
    font-weight: 600;
    white-space: nowrap;
    transition: background-color var(--transition-fast), color var(--transition-fast);
}

.nav-link:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #ffffff;
}

.nav-link--active {
    background: rgba(255, 255, 255, 0.18);
    color: #ffffff;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.22);
}

.header-status {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.status-pill {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 5px 12px;
    border-radius: var(--radius-pill);
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.16);
    color: #eaf7ef;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
}

.mode-badge {
    padding: 5px 12px;
    border-radius: var(--radius-pill);
    background: rgba(105, 208, 67, 0.16);
    border: 1px solid rgba(105, 208, 67, 0.45);
    color: #bdf29f;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
}

.env-badge {
    padding: 5px 10px;
    border-radius: var(--radius-pill);
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.14);
    color: rgba(232, 248, 239, 0.66);
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.6px;
    white-space: nowrap;
}

.env-badge--warn {
    background: rgba(253, 243, 220, 0.14);
    border-color: rgba(240, 196, 100, 0.5);
    color: #f7d894;
}

@media (max-width: 1024px) {
    .header-inner {
        gap: 14px;
        padding: 10px 16px;
    }

    .app-nav {
        order: 3;
        flex-basis: 100%;
        overflow-x: auto;
        padding-bottom: 2px;
    }

    .nav-link {
        padding: 6px 12px;
        font-size: 13px;
    }
}

@media (max-width: 640px) {
    .brand-sub {
        display: none;
    }

    .brand-name {
        font-size: 15px;
    }

    .brand-logo {
        width: 36px;
        height: 36px;
    }
}
</style>
