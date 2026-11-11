// 文件功能：前端网关 Node 测试公共辅助（临时目录、配置构造、假 TCP/HTTP 后端、WebSocket 测试客户端、等待工具）
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11

import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { deep_merge, load_config, validate_config } from "../../../frontend/gateway/config_loader.mjs";
import { Logger } from "../../../frontend/gateway/log_util.mjs";

// 测试用缺省日志级别：仅记录 ERROR，避免污染测试输出
const TEST_LOG_LEVEL = "ERROR";

// 轮询与等待缺省参数（毫秒）
export const DEFAULT_WAIT_TIMEOUT_MS = 3000;
const DEFAULT_POLL_INTERVAL_MS = 20;

// 当前测试文件所在目录与仓库根目录
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(TEST_DIR, "..", "..", "..");
export const FRONTEND_DIR = path.join(REPO_ROOT, "frontend");

/**
 * 等待若干毫秒。
 *
 * 入参：ms 毫秒数。
 * 返回：Promise<void>。
 */
export function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

/**
 * 轮询等待条件成立。
 *
 * 入参：predicate 同步或异步判定函数；timeout_ms 超时；interval_ms 轮询间隔；label 超时提示。
 * 返回：Promise<void>，条件成立即返回。
 * 异常：超时抛出 Error。
 */
export async function wait_for(predicate, {
    timeout_ms = DEFAULT_WAIT_TIMEOUT_MS,
    interval_ms = DEFAULT_POLL_INTERVAL_MS,
    label = "条件",
} = {}) {
    const deadline = Date.now() + timeout_ms;
    while (Date.now() < deadline) {
        if (await predicate()) {
            return;
        }
        await delay(interval_ms);
    }
    throw new Error(`等待${label}超时（${timeout_ms} 毫秒）`);
}

/**
 * 创建并返回临时目录绝对路径。
 *
 * 入参：prefix 目录名前缀。
 * 返回：临时目录绝对路径。
 */
export function make_tmp_dir(prefix = "tmp_visrl_gateway_test_") {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * 递归删除临时目录，失败不抛出（测试清理用）。
 *
 * 入参：dir_path 目录绝对路径。
 * 返回：无。
 */
export function remove_dir(dir_path) {
    try {
        fs.rmSync(dir_path, { recursive: true, force: true });
    } catch {
        // 清理失败不影响测试结论
    }
}

/**
 * 创建一个静默日志器（只输出 ERROR，便于失败时定位）。
 *
 * 入参：name 模块名。
 * 返回：Logger 实例。
 */
export function make_quiet_logger(name = "test") {
    return new Logger({ name, level: TEST_LOG_LEVEL, console_enabled: false });
}

/**
 * 获取一个当前空闲的本地端口（用于构造"后端不可达"场景）。
 *
 * 返回：Promise<number> 端口号。
 */
export async function get_unused_port() {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const port = server.address().port;
    await new Promise((resolve) => {
        server.close(() => resolve());
    });
    return port;
}

/**
 * 基于仓库真实 base.json + sim 环境构造测试配置，可深度覆盖后校验。
 *
 * 入参：overrides 覆盖配置片段。
 * 返回：{config, paths}，与 validate_config 返回值一致。
 */
export function create_test_config(overrides = {}) {
    const loaded = load_config({ repo_root: REPO_ROOT, env_value: "sim" });
    const merged = deep_merge(loaded.config, overrides);
    return validate_config(merged, { repo_root: REPO_ROOT });
}

/**
 * 向本地 HTTP 服务发起请求并读取完整响应。
 *
 * 入参：port 端口；request_path 请求路径；method 方法；headers 请求头；body 请求体；timeout_ms 超时。
 * 返回：Promise<{status, headers, text, json}>。
 */
export function http_request({
    port,
    path: request_path = "/",
    method = "GET",
    headers = {},
    body = null,
    timeout_ms = DEFAULT_WAIT_TIMEOUT_MS,
}) {
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
            host: "127.0.0.1",
            port,
            method,
            path: request_path,
            headers,
        }, (response) => {
            const chunks = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () => {
                const text = Buffer.concat(chunks).toString("utf8");
                let json = null;
                try {
                    json = JSON.parse(text);
                } catch {
                    json = null;
                }
                finish(resolve, { status: response.statusCode, headers: response.headers, text, json });
            });
        });
        const timer = setTimeout(() => {
            request.destroy(new Error("HTTP 请求超时"));
            finish(reject, new Error("HTTP 请求超时"));
        }, timeout_ms);
        request.on("error", (error) => {
            clearTimeout(timer);
            finish(reject, error);
        });
        request.on("response", () => {
            clearTimeout(timer);
        });
        if (body !== null) {
            request.write(body);
        }
        request.end();
    });
}

/**
 * WebSocket 测试客户端：缓存收到的报文并支持按条件等待。
 */
export class TestWsClient {
    /**
     * 构造测试客户端（不建连，使用 connect 静态方法）。
     *
     * 入参：socket 已打开的 WebSocket。
     */
    constructor(socket) {
        this.socket = socket;
        this.messages = [];
        this.closed = false;
        this._new_message_waiters = [];
        socket.addEventListener("message", (event) => {
            const text = typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8");
            let parsed;
            try {
                parsed = JSON.parse(text);
            } catch {
                parsed = { raw: text };
            }
            this.messages.push(parsed);
            for (const waiter of this._new_message_waiters.splice(0)) {
                waiter.resolve();
            }
        });
        socket.addEventListener("close", () => {
            this.closed = true;
            for (const waiter of this._new_message_waiters.splice(0)) {
                waiter.reject(new Error("WebSocket 已关闭"));
            }
        });
        socket.addEventListener("error", () => {
            // 错误同时会触发 close，由 close 统一处理
        });
    }

    /**
     * 建立并等待 WebSocket 连接打开。
     *
     * 入参：url ws:// 地址。
     * 返回：Promise<TestWsClient>。
     */
    static async connect(url) {
        const socket = new WebSocket(url);
        await new Promise((resolve, reject) => {
            socket.addEventListener("open", resolve, { once: true });
            socket.addEventListener("error", () => reject(new Error(`WebSocket 连接失败：${url}`)), { once: true });
        });
        return new TestWsClient(socket);
    }

    /**
     * 发送 JSON 报文。
     *
     * 入参：payload 报文对象。
     * 返回：无。
     */
    send_json(payload) {
        this.socket.send(JSON.stringify(payload));
    }

    /**
     * 发送原始文本帧。
     *
     * 入参：text 文本内容。
     * 返回：无。
     */
    send_raw(text) {
        this.socket.send(text);
    }

    /**
     * 等待缓存中出现下一条报文（缓存为空时等待新报文）。
     *
     * 入参：timeout_ms 超时。
     * 返回：Promise<报文对象>。
     */
    async next_message(timeout_ms = DEFAULT_WAIT_TIMEOUT_MS) {
        if (this.messages.length === 0) {
            await this._wait_for_new_message(timeout_ms);
        }
        return this.messages.shift();
    }

    /**
     * 等待满足条件的报文（不匹配的历史报文留在缓存中，不阻塞后续等待）。
     *
     * 入参：predicate 判定函数；timeout_ms 超时。
     * 返回：Promise<报文对象>。
     */
    async wait_for_message(predicate, timeout_ms = DEFAULT_WAIT_TIMEOUT_MS) {
        const deadline = Date.now() + timeout_ms;
        let scan_index = 0;
        while (true) {
            while (scan_index < this.messages.length) {
                if (predicate(this.messages[scan_index])) {
                    return this.messages.splice(scan_index, 1)[0];
                }
                scan_index += 1;
            }
            const remaining = deadline - Date.now();
            if (remaining <= 0) {
                throw new Error("等待 WebSocket 消息超时");
            }
            await this._wait_for_new_message(remaining);
        }
    }

    /**
     * 等待下一条新报文到达（只发信号，不改动缓存）。
     *
     * 入参：timeout_ms 超时。
     * 返回：Promise<void>。
     * 异常：超时或连接关闭时抛出 Error。
     */
    _wait_for_new_message(timeout_ms) {
        if (this.closed) {
            return Promise.reject(new Error("WebSocket 已关闭"));
        }
        return new Promise((resolve, reject) => {
            const waiter = {
                resolve: () => {},
                reject: () => {},
            };
            const timer = setTimeout(() => {
                const index = this._new_message_waiters.indexOf(waiter);
                if (index >= 0) {
                    this._new_message_waiters.splice(index, 1);
                }
                reject(new Error("等待 WebSocket 消息超时"));
            }, timeout_ms);
            waiter.resolve = () => {
                clearTimeout(timer);
                resolve();
            };
            waiter.reject = (error) => {
                clearTimeout(timer);
                reject(error);
            };
            this._new_message_waiters.push(waiter);
        });
    }

    /**
     * 关闭连接并等待关闭事件。
     *
     * 返回：Promise<void>。
     */
    async close() {
        if (this.socket.readyState === WebSocket.CLOSED) {
            return;
        }
        if (this.socket.readyState === WebSocket.CLOSING) {
            await delay(10);
            return;
        }
        await new Promise((resolve) => {
            this.socket.addEventListener("close", resolve, { once: true });
            this.socket.close();
        });
    }
}

/**
 * 连接前端网关 WebSocket。
 *
 * 入参：port 网关 HTTP 端口；ws_path WebSocket 路径。
 * 返回：Promise<TestWsClient>。
 */
export function connect_ws(port, ws_path = "/ws") {
    return TestWsClient.connect(`ws://127.0.0.1:${port}${ws_path}`);
}
