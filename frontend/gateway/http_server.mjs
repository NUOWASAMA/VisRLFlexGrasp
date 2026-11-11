// 文件功能：前端网关 HTTP 服务，提供后端反向代理、网关配置/状态接口与静态资源托管入口
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11

import {
    API_PATH,
    ERROR_CODE,
    HTTP_METHOD,
    HTTP_STATUS,
    JSON_CONTENT_TYPE,
    MAX_HTTP_REQUEST_BODY_BYTES,
} from "./constants.mjs";
import { BackendTimeoutError, request_backend } from "./http_proxy.mjs";
import { build_unified_response } from "./protocol.mjs";

// 网关内部错误响应码，沿用全局字典中"后端内部异常"语义
const GATEWAY_INTERNAL_ERROR_CODE = ERROR_CODE.MOTION_EXEC_FAILED;

/**
 * 请求体超限错误，映射 HTTP 413 + code 1000。
 */
class RequestBodyTooLargeError extends Error {
    /**
     * 构造请求体超限错误。
     *
     * 入参：limit_bytes 允许的最大字节数。
     */
    constructor(limit_bytes) {
        super(`请求体超过 ${limit_bytes} 字节上限`);
        this.name = "RequestBodyTooLargeError";
        this.code = ERROR_CODE.INVALID_PARAM;
        this.http_status = HTTP_STATUS.PAYLOAD_TOO_LARGE;
    }
}

/**
 * 前端网关 HTTP 服务：/api 前缀下路由后端代理与网关接口，其余路径交给静态资源服务器。
 */
export class FrontendHttpServer {
    /**
     * 构造 HTTP 服务。
     *
     * 入参：config 已校验配置；logger 日志器；static_server 静态资源服务器；
     *      proxy_timeout_ms 后端 HTTP 代理超时；state_provider 网关状态与配置视图提供者
     *      （需实现 get_status_snapshot / get_config_view / record_error）。
     */
    constructor({ config, logger, static_server, proxy_timeout_ms, state_provider }) {
        this._config = config;
        this._logger = logger;
        this._static_server = static_server;
        this._proxy_timeout_ms = proxy_timeout_ms;
        this._state_provider = state_provider;
        this._api_prefix = config.gateway.api_prefix;
        this._backend_http = config.backend.http;
    }

    /**
     * 处理一条 HTTP 请求；内部异常统一转为 JSON 错误响应，不向调用方抛出。
     *
     * 入参：req Node HTTP 请求；res Node HTTP 响应。
     * 返回：Promise<void>。
     */
    async handle_request(req, res) {
        try {
            await this._route_request(req, res);
        } catch (error) {
            this._logger.error("HTTP 请求处理异常：%s", error.message);
            this._send_json(res, HTTP_STATUS.INTERNAL_ERROR, GATEWAY_INTERNAL_ERROR_CODE, "网关内部错误");
        }
    }

    /**
     * 请求路由：/api 前缀进入网关接口，其它路径交给静态资源服务器。
     *
     * 入参：req Node HTTP 请求；res Node HTTP 响应。
     * 返回：Promise<void>。
     */
    async _route_request(req, res) {
        let url;
        try {
            url = new URL(req.url ?? "/", "http://127.0.0.1");
        } catch {
            this._send_json(res, HTTP_STATUS.BAD_REQUEST, ERROR_CODE.INVALID_MESSAGE, "请求路径非法");
            return;
        }
        if (this._is_api_path(url.pathname)) {
            await this._handle_api_request(req, res, url);
            return;
        }
        await this._static_server.handle_request(req, res);
    }

    /**
     * 判断请求路径是否属于网关 API 前缀。
     *
     * 入参：pathname URL 路径。
     * 返回：属于 API 前缀返回 true。
     */
    _is_api_path(pathname) {
        return pathname === this._api_prefix || pathname.startsWith(`${this._api_prefix}/`);
    }

    /**
     * 处理 API 请求：先匹配网关自身接口，再匹配后端代理路由，未知路由返回 404。
     *
     * 入参：req Node HTTP 请求；res Node HTTP 响应；url 解析后的 URL 对象。
     * 返回：Promise<void>。
     */
    async _handle_api_request(req, res, url) {
        const method = req.method ?? HTTP_METHOD.GET;
        const relative_path = this._api_prefix === "/" ? url.pathname : url.pathname.slice(this._api_prefix.length);
        const search = url.search;

        if (method === HTTP_METHOD.GET && relative_path === API_PATH.GATEWAY_CONFIG) {
            this._send_json(res, HTTP_STATUS.OK, ERROR_CODE.SUCCESS, "success",
                this._state_provider.get_config_view());
            return;
        }
        if (method === HTTP_METHOD.GET && relative_path === API_PATH.GATEWAY_STATUS) {
            this._send_json(res, HTTP_STATUS.OK, ERROR_CODE.SUCCESS, "success",
                this._state_provider.get_status_snapshot());
            return;
        }
        if (method === HTTP_METHOD.GET && relative_path === API_PATH.HEALTH) {
            await this._proxy(req, res, HTTP_METHOD.GET, `${API_PATH.HEALTH}${search}`);
            return;
        }
        if (method === HTTP_METHOD.GET && relative_path === API_PATH.ROBOT_STATUS) {
            await this._proxy(req, res, HTTP_METHOD.GET, `${API_PATH.ROBOT_STATUS}${search}`);
            return;
        }
        if (method === HTTP_METHOD.POST && relative_path === API_PATH.ROBOT_PLAN) {
            await this._proxy_plan(req, res, `${API_PATH.ROBOT_PLAN}${search}`);
            return;
        }
        if (method === HTTP_METHOD.GET && relative_path.startsWith(API_PATH.TASKS_PREFIX)
            && relative_path.length > API_PATH.TASKS_PREFIX.length) {
            const task_path = relative_path.slice(API_PATH.TASKS_PREFIX.length);
            await this._proxy(req, res, HTTP_METHOD.GET, `${API_PATH.TASKS_PREFIX}${task_path}${search}`);
            return;
        }
        this._send_json(res, HTTP_STATUS.NOT_FOUND, ERROR_CODE.TASK_NOT_FOUND, "接口不存在");
    }

    /**
     * 转发规划提交请求：读取 JSON 请求体后透传给后端。
     *
     * 入参：req Node HTTP 请求；res Node HTTP 响应；target_path 后端目标路径（含查询串）。
     * 返回：Promise<void>。
     */
    async _proxy_plan(req, res, target_path) {
        let body;
        try {
            body = await this._read_request_body(req);
        } catch (error) {
            const status = error.http_status ?? HTTP_STATUS.BAD_REQUEST;
            const code = error.code ?? ERROR_CODE.INVALID_MESSAGE;
            this._send_json(res, status, code, error.message);
            return;
        }
        await this._proxy(req, res, HTTP_METHOD.POST, target_path, body);
    }

    /**
     * 反向代理到后端 HTTP 服务，透传状态码与响应体；不可达 503、超时 504。
     *
     * 入参：req Node HTTP 请求；res Node HTTP 响应；method 请求方法；target_path 后端路径；
     *      body 请求体 Buffer（GET 时为 null）。
     * 返回：Promise<void>。
     */
    async _proxy(req, res, method, target_path, body = null) {
        const headers = {};
        if (body !== null) {
            headers["content-type"] = req.headers["content-type"] ?? JSON_CONTENT_TYPE;
            headers["content-length"] = body.length;
        }
        try {
            const response = await request_backend({
                backend_http: this._backend_http,
                method,
                path: target_path,
                headers,
                body,
                timeout_ms: this._proxy_timeout_ms,
            });
            if (res.writableEnded) {
                return;
            }
            const response_headers = {
                "content-type": response.content_type ?? JSON_CONTENT_TYPE,
                "content-length": response.body.length,
            };
            res.writeHead(response.status_code, response_headers);
            res.end(response.body);
        } catch (error) {
            if (res.writableEnded) {
                return;
            }
            const status = error.http_status ?? HTTP_STATUS.SERVICE_UNAVAILABLE;
            const code = error.code ?? ERROR_CODE.TARGET_OFFLINE;
            const message = error instanceof BackendTimeoutError
                ? `后端请求超时：${method} ${target_path}`
                : `后端服务不可达：${method} ${target_path}`;
            this._logger.warn("%s（%s）", message, error.message);
            this._state_provider.record_error(message);
            this._send_json(res, status, code, message);
        }
    }

    /**
     * 读取请求体，超过上限时拒绝。
     *
     * 入参：req Node HTTP 请求。
     * 返回：Promise<Buffer>，请求体内容。
     * 异常：超过上限抛出 RequestBodyTooLargeError；读取失败抛出 Error。
     */
    _read_request_body(req) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            let total = 0;
            let settled = false;
            const fail = (error) => {
                if (settled) {
                    return;
                }
                settled = true;
                reject(error);
            };
            req.on("data", (chunk) => {
                if (settled) {
                    return;
                }
                total += chunk.length;
                if (total > MAX_HTTP_REQUEST_BODY_BYTES) {
                    fail(new RequestBodyTooLargeError(MAX_HTTP_REQUEST_BODY_BYTES));
                    // 丢弃剩余请求体但保持连接可写，确保 413 响应能正常送达客户端
                    req.resume();
                    return;
                }
                chunks.push(chunk);
            });
            req.on("end", () => {
                if (settled) {
                    return;
                }
                settled = true;
                resolve(Buffer.concat(chunks));
            });
            req.on("error", (error) => {
                fail(error);
            });
        });
    }

    /**
     * 输出统一 JSON 响应。
     *
     * 入参：res Node HTTP 响应；status HTTP 状态码；code 业务错误码；msg 状态说明；data 业务数据体。
     * 返回：无。
     */
    _send_json(res, status, code, msg, data = {}) {
        if (res.writableEnded) {
            return;
        }
        const body = JSON.stringify(build_unified_response(data, code, msg));
        res.writeHead(status, {
            "content-type": JSON_CONTENT_TYPE,
            "content-length": Buffer.byteLength(body, "utf8"),
        });
        res.end(body);
    }
}
