// 文件功能：前端网关后端 HTTP 反向代理请求器，负责超时控制、不可达区分与统一错误映射
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11

import http from "node:http";

import { ERROR_CODE, HTTP_STATUS } from "./constants.mjs";

// 转发给后端的 Accept 头，后端统一返回 JSON
const PROXY_ACCEPT_HEADER = "application/json";

/**
 * 后端 HTTP 服务不可达错误（连接被拒绝、域名解析失败、连接中断等），映射 HTTP 503 + code 4000。
 */
export class BackendUnavailableError extends Error {
    /**
     * 构造不可达错误。
     *
     * 入参：message 错误描述。
     */
    constructor(message) {
        super(message);
        this.name = "BackendUnavailableError";
        this.code = ERROR_CODE.TARGET_OFFLINE;
        this.http_status = HTTP_STATUS.SERVICE_UNAVAILABLE;
    }
}

/**
 * 后端 HTTP 请求超时错误，映射 HTTP 504 + code 1002。
 */
export class BackendTimeoutError extends Error {
    /**
     * 构造超时错误。
     *
     * 入参：message 错误描述。
     */
    constructor(message) {
        super(message);
        this.name = "BackendTimeoutError";
        this.code = ERROR_CODE.REQUEST_TIMEOUT;
        this.http_status = HTTP_STATUS.GATEWAY_TIMEOUT;
    }
}

/**
 * 向既有后端 HTTP 服务发起请求并读取完整响应体。
 *
 * 入参：backend_http 后端 HTTP 地址 {host, port}；method 请求方法；path 转发路径（含查询串）；
 *      headers 需要透传的请求头（content-type 等）；body 请求体 Buffer 或 null；timeout_ms 超时毫秒数。
 * 返回：Promise<{status_code, content_type, body}>，body 为响应 Buffer。
 * 异常：连接失败抛出 BackendUnavailableError；超时抛出 BackendTimeoutError。
 */
export function request_backend({ backend_http, method, path, headers = {}, body = null, timeout_ms }) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (handler, value) => {
            if (settled) {
                return;
            }
            settled = true;
            handler(value);
        };

        const request = http.request({
            host: backend_http.host,
            port: backend_http.port,
            method,
            path,
            headers: {
                accept: PROXY_ACCEPT_HEADER,
                ...headers,
            },
        });

        const timer = setTimeout(() => {
            const error = new BackendTimeoutError(`后端请求超时（${timeout_ms} 毫秒）：${method} ${path}`);
            request.destroy(error);
            finish(reject, error);
        }, timeout_ms);

        request.on("response", (response) => {
            const chunks = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () => {
                clearTimeout(timer);
                finish(resolve, {
                    status_code: response.statusCode ?? HTTP_STATUS.INTERNAL_ERROR,
                    content_type: response.headers["content-type"] ?? null,
                    body: Buffer.concat(chunks),
                });
            });
            response.on("error", (error) => {
                clearTimeout(timer);
                finish(reject, new BackendUnavailableError(`后端响应读取失败：${error.message}`));
            });
        });

        request.on("error", (error) => {
            clearTimeout(timer);
            if (error instanceof BackendTimeoutError) {
                finish(reject, error);
                return;
            }
            finish(reject, new BackendUnavailableError(
                `后端服务不可达：${backend_http.host}:${backend_http.port}（${error.code || error.message}）`));
        });

        if (body !== null && body !== undefined) {
            request.write(body);
        }
        request.end();
    });
}
