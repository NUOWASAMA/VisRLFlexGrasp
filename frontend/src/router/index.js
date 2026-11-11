// 文件功能：前端路由定义（总览 / 机器人状态 / 任务查询 / 参数配置），使用 hash 模式兼容静态托管与刷新
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11
import { createRouter, createWebHashHistory } from 'vue-router'
import { APP_NAME } from '../config/defaults.js'

// 路由名固定，与顶栏 NAV_ITEMS 的 name 字段一一对应
const routes = [
    {
        path: '/',
        name: 'dashboard',
        component: () => import('../views/DashboardView.vue'),
        meta: { title: '总览' },
    },
    {
        path: '/robot',
        name: 'robot',
        component: () => import('../views/RobotStatusView.vue'),
        meta: { title: '机器人状态' },
    },
    {
        path: '/tasks',
        name: 'tasks',
        component: () => import('../views/TaskQueryView.vue'),
        meta: { title: '任务查询' },
    },
    {
        path: '/settings',
        name: 'settings',
        component: () => import('../views/SettingsView.vue'),
        meta: { title: '参数配置' },
    },
    {
        path: '/:path_match(.*)*',
        redirect: '/',
    },
]

const router = createRouter({
    history: createWebHashHistory(),
    routes,
    scrollBehavior() {
        return { top: 0 }
    },
})

// 路由切换时同步浏览器标签页标题，便于多标签区分
router.afterEach((to) => {
    const page_title = to.meta && to.meta.title ? to.meta.title : ''
    document.title = page_title ? `${page_title} · ${APP_NAME}` : APP_NAME
})

export default router
