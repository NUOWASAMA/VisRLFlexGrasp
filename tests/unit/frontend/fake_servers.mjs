// 文件功能：前端网关 Node 测试用假后端服务（假 TCP 后端接口与假 HTTP 后端接口）
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11

import http from "node:http";
import net from "node:net";

import { DEFAULT_WAIT_TIMEOUT_MS, wait_for } from "./helpers.mjs";

/**
 * 假后端 TCP 服务：模拟后端调度服务的注册、心跳与业务报文，供 TCP 客户端与网关测试使用。
 */
export class FakeTcpBackend {
    /**
     * 构造假后端。
     *
     * 入参：auto_register 收到 register 是否自动回 register_ack；auto_heartbeat 收到 heartbeat 是否回 heartbeat_ack；
     *      register_error_code 非 0 时收到 register 回该错误码的 error_report；
     *      on_message 自定义报文回调 (message, socket, backend)。
     */
    constructor({
        auto_register = true,
        auto_heartbeat = true,
        register_error_code = 0,
        on_message = null,
    } = {}) {
        this.auto_register = auto_register;
        this.auto_heartbeat = auto_heartbeat;
        this.register_error_code = register_error_code;
        this.on_message = on_message;
        this.received = [];
        this.invalid_lines = [];
        this.sockets = new Set();
        this.port = 0;
        this._server = null;
    }

    /** 当前已建立连接的第一个 socket（无连接时为 null） */
    get first_socket() {
        for (const socket of this.sockets) {
            return socket;
        }
        return null;
    }

    /**
     * 启动监听，缺省由操作系统分配端口。
     *
     * 入参：port 监听端口，0 表示自动分配。
     * 返回：Promise<FakeTcpBackend> 自身。
     */
    async start(port = 0) {
        this._server = net.createServer((socket) => {
            this._handle_connection(socket);
        });
        await new Promise((resolve, reject) => {
            this._server.once("error", reject);
            this._server.listen(port, "127.0.0.1", resolve);
        });
        this.port = this._server.address().port;
        return this;
    }

    /**
     * 处理新连接：按行解析 NDJSON 并回复注册/心跳。
     *
     * 入参：socket 客户端连接。
     * 返回：无。
     */
    _handle_connection(socket) {
        this.sockets.add(socket);
        socket.setEncoding("utf8");
        let buffer = "";
        socket.on("data", (chunk) => {
            buffer += chunk;
            let index = buffer.indexOf("\n");
            while (index >= 0) {
                const line = buffer.slice(0, index);
                buffer = buffer.slice(index + 1);
                if (line.trim()) {
                    this._handle_line(line, socket);
                }
                index = buffer.indexOf("\n");
            }
        });
        socket.on("error", () => {
            // 测试中连接被强制关闭属正常现象
        });
        socket.on("close", () => {
            this.sockets.delete(socket);
        });
    }

    /**
     * 处理单行报文并触发自动回复。
     *
     * 入参：line 单行文本；socket 来源连接。
     * 返回：无。
     */
    _handle_line(line, socket) {
        let message;
        try {
            message = JSON.parse(line);
        } catch {
            this.invalid_lines.push(line);
            return;
        }
        this.received.push(message);
        if (message.msg_type === "register") {
            if (this.register_error_code !== 0) {
                this.send(socket, {
                    msg_type: "error_report",
                    source: "backend",
                    target: "frontend",
                    code: this.register_error_code,
                    msg: "注册被拒绝",
                    data: {},
                    timestamp: Date.now(),
                });
            } else if (this.auto_register) {
                this.send(socket, this._build_message("register_ack", "backend", "frontend", {}));
            }
        } else if (message.msg_type === "heartbeat" && this.auto_heartbeat) {
            this.send(socket, this._build_message("heartbeat_ack", "backend", "frontend", {}));
        }
        if (this.on_message !== null) {
            this.on_message(message, socket, this);
        }
    }

    /**
     * 构造标准 TCP 报文。
     *
     * 入参：msg_type 类型；source 发送方；target 接收方；data 数据体；code 错误码；msg 描述。
     * 返回：报文字典。
     */
    _build_message(msg_type, source, target, data, code = 0, msg = "success") {
        return { msg_type, source, target, code, msg, data, timestamp: Date.now() };
    }

    /**
     * 向指定连接发送报文。
     *
     * 入参：socket 目标连接；message 报文字典。
     * 返回：无。
     */
    send(socket, message) {
        if (socket !== null && !socket.destroyed) {
            socket.write(`${JSON.stringify(message)}\n`);
        }
    }

    /**
     * 向所有连接广播报文。
     *
     * 入参：message 报文字典。
     * 返回：无。
     */
    broadcast(message) {
        for (const socket of this.sockets) {
            this.send(socket, message);
        }
    }

    /**
     * 发送后端 task_result 报文。
     *
     * 入参：data 业务数据体；socket 目标连接（缺省广播）。
     * 返回：无。
     */
    send_task_result(data, socket = this.first_socket) {
        this.send(socket, this._build_message("task_result", "backend", "frontend", data));
    }

    /**
     * 发送后端 error_report 报文。
     *
     * 入参：code 错误码；msg 描述；data 数据体；socket 目标连接（缺省广播）。
     * 返回：无。
     */
    send_error_report(code, msg, data = {}, socket = this.first_socket) {
        this.send(socket, this._build_message("error_report", "backend", "frontend", data, code, msg));
    }

    /**
     * 等待出现满足条件的接收报文。
     *
     * 入参：predicate 判定函数；timeout_ms 超时。
     * 返回：Promise<报文对象>。
     */
    async wait_for_message(predicate, timeout_ms = DEFAULT_WAIT_TIMEOUT_MS) {
        let matched = null;
        await wait_for(() => {
            matched = this.received.find(predicate) ?? null;
            return matched !== null;
        }, { timeout_ms, label: "假后端接收报文" });
        return matched;
    }

    /**
     * 主动关闭指定连接（模拟后端断开）。
     *
     * 入参：socket 连接（缺省全部）。
     * 返回：无。
     */
    close_sockets(socket = null) {
        const targets = socket === null ? [...this.sockets] : [socket];
        for (const target of targets) {
            target.destroy();
        }
    }

    /**
     * 停止监听并断开所有连接。
     *
     * 返回：Promise<void>。
     */
    async stop() {
        this.close_sockets();
        if (this._server === null) {
            return;
        }
        await new Promise((resolve) => {
            this._server.close(() => resolve());
        });
        this._server = null;
    }
}

/**
 * 假后端 HTTP 服务：记录请求并按 handler 返回响应，供反向代理测试使用。
 */
export class FakeHttpBackend {
    /**
     * 构造假后端。
     *
     * 入参：handler 处理函数 (record, req) => {status_code, body, content_type} | Promise | "hang"。
     */
    constructor(handler) {
        this._handler = handler;
        this.requests = [];
        this.port = 0;
        this._server = null;
    }

    /**
     * 启动监听，端口由操作系统分配。
     *
     * 返回：Promise<FakeHttpBackend> 自身。
     */
    async start() {
        this._server = http.createServer((req, res) => {
            const chunks = [];
            req.on("data", (chunk) => chunks.push(chunk));
            req.on("end", () => {
                void this._handle_request(req, res, Buffer.concat(chunks));
            });
        });
        await new Promise((resolve, reject) => {
            this._server.once("error", reject);
            this._server.listen(0, "127.0.0.1", resolve);
        });
        this.port = this._server.address().port;
        return this;
    }

    /**
     * 处理一条请求：记录请求后调用 handler 输出响应。
     *
     * 入参：req Node 请求；res Node 响应；body 请求体。
     * 返回：Promise<void>。
     */
    async _handle_request(req, res, body) {
        const record = {
            method: req.method,
            url: req.url,
            headers: req.headers,
            body: body.toString("utf8"),
        };
        this.requests.push(record);
        let result;
        try {
            result = await this._handler(record, req);
        } catch (error) {
            if (!res.destroyed) {
                res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ code: 3001, msg: error.message }));
            }
            return;
        }
        if (result === "hang" || res.destroyed || res.writableEnded) {
            return;
        }
        const payload = result.body === undefined ? {} : result.body;
        const content = Buffer.isBuffer(payload)
            ? payload
            : Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload), "utf8");
        res.writeHead(result.status_code ?? 200, {
            "content-type": result.content_type ?? "application/json; charset=utf-8",
            "content-length": content.length,
        });
        res.end(content);
    }

    /**
     * 停止监听并断开连接。
     *
     * 返回：Promise<void>。
     */
    async stop() {
        if (this._server === null) {
            return;
        }
        if (typeof this._server.closeAllConnections === "function") {
            this._server.closeAllConnections();
        }
        await new Promise((resolve) => {
            this._server.close(() => resolve());
        });
        this._server = null;
    }
}
