// 文件功能：前端开发服务器与构建配置；开发环境把 /api 与 /ws 代理至前端网关，避免跨域改动后端
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11
import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// 开发代理目标：前端网关默认监听地址，可用环境变量覆盖
const GATEWAY_ORIGIN = process.env.VISRL_GATEWAY_ORIGIN || 'http://127.0.0.1:8080'
// WebSocket 代理目标：与 HTTP 同一网关，仅协议不同
const GATEWAY_WS_ORIGIN = GATEWAY_ORIGIN.replace(/^http/, 'ws')

export default defineConfig({
    plugins: [vue()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    server: {
        host: '127.0.0.1',
        port: 5173,
        proxy: {
            '/api': { target: GATEWAY_ORIGIN, changeOrigin: true },
            '/ws': { target: GATEWAY_WS_ORIGIN, ws: true },
        },
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
})
