// 文件功能：HTTP 请求封装（fetch 超时、统一响应解包、错误类型与可注入 baseURL），供所有后端接口复用
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11
import { API_PREFIX, ERROR_CODES, HTTP_TIMEOUT_MS } from '../config/defaults.js'

// JSON 请求头，所有接口均为 application/json
const JSON_HEADERS = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
}

/**
 * 前端统一接口错误：携带业务错误码、HTTP 状态与原始数据，便于界面分类提示。
 */
export class ApiError extends Error {
    constructor({ code = ERROR_CODES.TARGET_OFFLINE, msg = '请求失败', status = 0, data = null, cause = null } = {}) {
        super(msg)
        this.name = 'ApiError'
        this.code = code
        this.status = status
        this.data = data
        this.cause = cause
    }
}

/**
 * 规范化 baseURL：去掉末尾多余斜杠，空串表示同源。
 * 入参：base_url 原始地址前缀。
 * 返回：规范化后的前缀。
 */
function normalize_base_url(base_url) {
    if (!base_url || base_url === '/') {
        return ''
    }
    return base_url.endsWith('/') ? base_url.slice(0, -1) : base_url
}

/**
 * 读取响应体并尽力解析为 JSON。
 * 入参：response fetch Response 对象。
 * 返回：解析后的 JSON；非 JSON 或空响应返回 null。
 */
async function read_response_payload(response) {
    const text = await response.text()
    if (!text) {
        return null
    }
    try {
        return JSON.parse(text)
    } catch (error) {
        return null
    }
}

/**
 * 创建 HTTP 客户端实例。
 * 入参：options.base_url 接口前缀（默认 /api）；options.timeout_ms 默认超时（默认 3000）；
 *       options.fetch_impl 注入 fetch 实现（默认全局 fetch，便于测试替换）。
 * 返回：{ get, post, request, get_base_url } 客户端对象。
 */
export function create_http_client(options = {}) {
    const base_url = normalize_base_url(options.base_url === undefined ? API_PREFIX : options.base_url)
    const default_timeout_ms = Number(options.timeout_ms) > 0 ? Number(options.timeout_ms) : HTTP_TIMEOUT_MS
    const fetch_impl = options.fetch_impl || (typeof fetch === 'function' ? fetch : null)

    /**
     * 发起一次请求并解包统一响应结构。
     * 入参：method HTTP 方法；path 以 / 开头的接口路径；options.body 请求体对象；options.timeout_ms 本次超时。
     * 返回：统一响应中的 data 字段。
     * 异常：网络失败、超时、HTTP 非 2xx、code != 0、响应结构非法时抛出 ApiError。
     */
    async function request(method, path, request_options = {}) {
        if (!fetch_impl) {
            throw new ApiError({ code: ERROR_CODES.TARGET_OFFLINE, msg: '当前环境不支持 fetch，无法访问前端网关' })
        }
        const timeout_ms = Number(request_options.timeout_ms) > 0
            ? Number(request_options.timeout_ms)
            : default_timeout_ms
        const controller = new AbortController()
        const timeout_timer = setTimeout(() => controller.abort(), timeout_ms)
        try {
            let response
            try {
                response = await fetch_impl(`${base_url}${path}`, {
                    method,
                    headers: JSON_HEADERS,
                    body: request_options.body === undefined ? undefined : JSON.stringify(request_options.body),
                    signal: controller.signal,
                })
            } catch (error) {
                if (error && error.name === 'AbortError') {
                    throw new ApiError({
                        code: ERROR_CODES.REQUEST_TIMEOUT,
                        msg: `请求超时（${timeout_ms} ms）`,
                        cause: error,
                    })
                }
                throw new ApiError({
                    code: ERROR_CODES.TARGET_OFFLINE,
                    msg: '无法连接前端网关，请确认网关已启动',
                    cause: error,
                })
            }
            const payload = await read_response_payload(response)
            const has_envelope = payload !== null
                && typeof payload === 'object'
                && typeof payload.code === 'number'
            if (has_envelope && payload.code !== ERROR_CODES.SUCCESS) {
                throw new ApiError({
                    code: payload.code,
                    msg: payload.msg || `请求失败（HTTP ${response.status}）`,
                    status: response.status,
                    data: payload.data,
                })
            }
            if (!response.ok) {
                throw new ApiError({
                    code: has_envelope ? payload.code : ERROR_CODES.TARGET_OFFLINE,
                    msg: (has_envelope && payload.msg) || `网关返回异常状态（HTTP ${response.status}）`,
                    status: response.status,
                    data: has_envelope ? payload.data : payload,
                })
            }
            if (!has_envelope) {
                throw new ApiError({
                    code: ERROR_CODES.INVALID_MESSAGE,
                    msg: '网关响应格式非法，缺少统一响应字段',
                    status: response.status,
                    data: payload,
                })
            }
            return payload.data
        } finally {
            clearTimeout(timeout_timer)
        }
    }

    return {
        get(path, request_options = {}) {
            return request('GET', path, request_options)
        },
        post(path, body, request_options = {}) {
            return request('POST', path, { ...request_options, body })
        },
        request,
        get_base_url() {
            return base_url
        },
    }
}
