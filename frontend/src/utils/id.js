// 文件功能：前端唯一标识生成工具（分拣任务 ID、WebSocket 请求 ID），保证可编辑且满足后端长度约束
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11
import {
    REQUEST_ID_PREFIX,
    TASK_ID_MAX_LENGTH,
    TASK_ID_PREFIX,
    TASK_ID_RANDOM_LENGTH,
} from '../config/defaults.js'

const RANDOM_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/**
 * 生成指定长度的随机小写字母数字串。
 * 入参：length 随机串长度，默认取常量 TASK_ID_RANDOM_LENGTH。
 * 返回：随机字符串；crypto 不可用时降级为 Math.random。
 */
function build_random_suffix(length = TASK_ID_RANDOM_LENGTH) {
    const crypto_api = typeof crypto !== 'undefined' ? crypto : null
    let suffix = ''
    for (let index = 0; index < length; index += 1) {
        let random_value = Math.random()
        if (crypto_api && typeof crypto_api.getRandomValues === 'function') {
            const buffer = new Uint32Array(1)
            crypto_api.getRandomValues(buffer)
            random_value = buffer[0] / 0xffffffff
        }
        const position = Math.floor(random_value * RANDOM_ALPHABET.length) % RANDOM_ALPHABET.length
        suffix += RANDOM_ALPHABET[position]
    }
    return suffix
}

/**
 * 生成带时间戳的分拣任务 ID（形如 sort-20261111-120715-a1b2），可在界面中手动编辑。
 * 返回：不超过后端长度约束的任务 ID 字符串。
 */
export function generate_task_id() {
    const now = new Date()
    const pad = (value) => String(value).padStart(2, '0')
    const date_part = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    const time_part = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    const task_id = `${TASK_ID_PREFIX}-${date_part}-${time_part}-${build_random_suffix()}`
    return task_id.slice(0, TASK_ID_MAX_LENGTH)
}

/**
 * 生成 WebSocket 请求关联 ID：用于 task_start 的 ack/error 回流匹配。
 * 返回：形如 req-<时间戳>-<随机串> 的请求 ID。
 */
export function generate_request_id() {
    return `${REQUEST_ID_PREFIX}-${Date.now()}-${build_random_suffix()}`
}
