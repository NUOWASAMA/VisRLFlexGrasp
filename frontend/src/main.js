// 文件功能：前端应用入口：加载网关配置与本地设置后挂载 Vue 应用，并引入全局样式
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11
import { createApp } from 'vue'

import App from './App.vue'
import './assets/styles.css'
import { load_app_config } from './composables/use_app_config.js'
import { load_settings } from './composables/use_settings.js'
import { load_task_history } from './composables/use_task_history.js'
import router from './router/index.js'

/**
 * 应用启动：先取网关 ui 配置（失败降级默认值），再恢复本地设置与任务历史，最后挂载应用。
 * 返回：Promise<void>。
 */
async function bootstrap() {
    await load_app_config()
    load_settings()
    load_task_history()
    const app = createApp(App)
    app.use(router)
    app.mount('#app')
}

bootstrap()
