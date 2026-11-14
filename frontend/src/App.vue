<!--
    文件功能：应用根组件：入口页使用沉浸式布局，其余页面组装顶栏、路由视图与页脚，
              并在应用生命周期内维护全局 WebSocket 与网关状态轮询
    作者：VisRLFlexGrasp 项目组
    创建日期：2026-11-11
-->
<script setup>
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useRoute } from 'vue-router'

import AppHeader from './components/AppHeader.vue'
import { APP_FOOTER, APP_VERSION } from './config/defaults.js'
import { refresh_gateway_status } from './composables/use_gateway_status.js'
import { init_gateway_ws, shutdown_gateway_ws } from './composables/use_gateway_ws.js'
import { use_polling } from './composables/use_polling.js'
import { use_settings } from './composables/use_settings.js'

const route = useRoute()
const { effective } = use_settings()
const poll_interval_ms = computed(() => effective.value.poll_interval_ms)
// 入口页为沉浸式布局：不显示顶栏、页脚与内容边距
const is_immersive = computed(() => Boolean(route.meta && route.meta.immersive))

// 顶栏连接状态轮询：整个应用生命周期内保持网关状态新鲜，周期可被参数配置页修改
const { start: start_status_polling } = use_polling(refresh_gateway_status, {
    interval_ms: poll_interval_ms,
    immediate: true,
})

onMounted(() => {
    init_gateway_ws()
    start_status_polling()
})

onBeforeUnmount(() => {
    shutdown_gateway_ws()
})
</script>

<template>
    <RouterView v-if="is_immersive" />
    <div v-else class="app-shell">
        <AppHeader />
        <main class="app-main">
            <RouterView v-slot="{ Component }">
                <Transition name="page-fade" mode="out-in">
                    <component :is="Component" />
                </Transition>
            </RouterView>
        </main>
        <footer class="app-footer">
            {{ APP_FOOTER }} · {{ APP_VERSION }}
        </footer>
    </div>
</template>

<style scoped>
.page-fade-enter-active,
.page-fade-leave-active {
    transition: opacity 0.18s ease, transform 0.18s ease;
}

.page-fade-enter-from {
    opacity: 0;
    transform: translateY(6px);
}

.page-fade-leave-to {
    opacity: 0;
    transform: translateY(-4px);
}
</style>
