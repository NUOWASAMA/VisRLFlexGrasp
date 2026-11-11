// 文件功能：通用轮询组合式函数：按响应式周期定时执行异步任务，支持启动/停止/手动执行与组件卸载自动清理
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11
import { onBeforeUnmount, readonly, ref, unref, watch } from 'vue'
import { MIN_POLL_INTERVAL_MS } from '../config/defaults.js'

/**
 * 创建轮询控制器。
 * 入参：poll_callback 每次轮询执行的异步函数；options.interval_ms 响应式周期（ms）；
 *       options.immediate 启动时是否立即执行一次（默认 true）。
 * 返回：{ is_running, last_run_ms, start, stop, run_once }。
 */
export function use_polling(poll_callback, options = {}) {
    const interval_source = options.interval_ms
    const immediate = options.immediate !== false
    const is_running = ref(false)
    const last_run_ms = ref(0)
    let timer = null
    let in_flight = false

    /**
     * 解析当前轮询周期，非法值回退最小周期。
     * 返回：毫秒整数。
     */
    function resolve_interval_ms() {
        const numeric_value = Number(unref(interval_source))
        if (!Number.isFinite(numeric_value) || numeric_value < MIN_POLL_INTERVAL_MS) {
            return MIN_POLL_INTERVAL_MS
        }
        return Math.round(numeric_value)
    }

    /**
     * 清理定时器。
     * 返回：无。
     */
    function clear_timer() {
        if (timer !== null) {
            clearTimeout(timer)
            timer = null
        }
    }

    /**
     * 执行一次轮询；同一时刻只允许一个请求在飞，避免慢接口叠加。
     * 返回：Promise<void>。
     */
    async function run_once() {
        if (in_flight) {
            return
        }
        in_flight = true
        try {
            await poll_callback()
        } catch (error) {
            console.error('[use_polling] 轮询回调异常', error)
        } finally {
            in_flight = false
            last_run_ms.value = Date.now()
        }
    }

    /**
     * 重新安排下一次轮询（周期变化时调用）。
     * 返回：无。
     */
    function schedule() {
        clear_timer()
        if (!is_running.value) {
            return
        }
        timer = setTimeout(async () => {
            if (!is_running.value) {
                return
            }
            await run_once()
            schedule()
        }, resolve_interval_ms())
    }

    /**
     * 启动轮询。
     * 返回：无。
     */
    function start() {
        if (is_running.value) {
            return
        }
        is_running.value = true
        if (immediate) {
            run_once()
        }
        schedule()
    }

    /**
     * 停止轮询。
     * 返回：无。
     */
    function stop() {
        is_running.value = false
        clear_timer()
    }

    // 周期被设置页修改后立即按新周期重新排期
    watch(() => unref(interval_source), () => {
        if (is_running.value) {
            schedule()
        }
    })

    onBeforeUnmount(stop)

    return {
        is_running: readonly(is_running),
        last_run_ms: readonly(last_run_ms),
        start,
        stop,
        run_once,
    }
}
