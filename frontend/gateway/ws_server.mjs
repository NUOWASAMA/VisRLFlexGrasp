// 文件功能：前端网关 WebSocket 会话管理，负责 /ws 升级握手、客户端登记、帧上限、广播与优雅关闭
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11

import { WebSocket, WebSocketServer } from "ws";

import {
    CLIENT_ID_PREFIX,
    WS_CLOSE_CODE,
    WS_CLOSE_POLL_INTERVAL_MS,
    WS_CLOSE_REASON_GATEWAY_STOP,
    WS_CLOSE_TIMEOUT_MS,
} from "./constants.mjs";

/**
 * WebSocket 会话中心：管理浏览器连接生命周期，业务报文处理通过回调注入（保持会话层与业务层解耦）。
 */
export class WsClientHub {
    /**
     * 构造 WebSocket 会话中心。
     *
     * 入参：http_server Node HTTP 服务（共享端口，接管 upgrade 事件）；ws_path WebSocket 路径；
     *      max_frame_bytes 单帧上限；logger 日志器；on_client_connected 客户端接入回调；
     *      on_client_message 客户端文本帧回调；on_client_disconnected 客户端断开回调。
     */
    constructor({
        http_server,
        ws_path,
        max_frame_bytes,
        logger,
        on_client_connected = () => {},
        on_client_message = () => {},
        on_client_disconnected = () => {},
    }) {
        this._http_server = http_server;
        this._ws_path = ws_path;
        this._max_frame_bytes = max_frame_bytes;
        this._logger = logger;
        this._on_client_connected = on_client_connected;
        this._on_client_message = on_client_message;
        this._on_client_disconnected = on_client_disconnected;
        this._clients = new Map();
        this._next_client_index = 0;
        this._upgrade_handler = (req, socket, head) => {
            this._handle_upgrade(req, socket, head);
        };
        this._ws_server = new WebSocketServer({ noServer: true, maxPayload: max_frame_bytes });
        this._ws_server.on("connection", (ws, req) => {
            this._handle_connection(ws, req);
        });
        this._ws_server.on("error", (error) => {
            this._logger.warn("WebSocket 服务异常：%s", error.message);
        });
    }

    /** 当前在线客户端数量 */
    get client_count() {
        return this._clients.size;
    }

    /**
     * 启动：接管 HTTP 服务的 upgrade 事件。
     *
     * 返回：无。
     */
    start() {
        this._http_server.on("upgrade", this._upgrade_handler);
        this._logger.debug("WebSocket 会话中心已接管 %s 路径升级请求", this._ws_path);
    }

    /**
     * 按客户端标识获取会话。
     *
     * 入参：client_id 客户端标识。
     * 返回：客户端对象 {id, socket, connected_at}；不存在返回 undefined。
     */
    get_client(client_id) {
        return this._clients.get(client_id);
    }

    /**
     * 向单个客户端发送 JSON 报文。
     *
     * 入参：client 客户端对象；payload 报文对象。
     * 返回：发送成功返回 true；连接不可用或发送异常返回 false。
     */
    send(client, payload) {
        if (!client || client.socket.readyState !== WebSocket.OPEN) {
            return false;
        }
        try {
            client.socket.send(JSON.stringify(payload));
            return true;
        } catch (error) {
            this._logger.warn("WebSocket 发送失败（%s）：%s", client.id, error.message);
            return false;
        }
    }

    /**
     * 广播报文：payload_factory 为函数时按客户端生成个性化报文。
     *
     * 入参：payload_factory 报文对象或 (client) => 报文对象。
     * 返回：实际发送成功的客户端数量。
     */
    broadcast(payload_factory) {
        let sent = 0;
        for (const client of this._clients.values()) {
            const payload = typeof payload_factory === "function" ? payload_factory(client) : payload_factory;
            if (this.send(client, payload)) {
                sent += 1;
            }
        }
        return sent;
    }

    /**
     * 优雅关闭所有客户端连接并停止接受新的升级请求。
     *
     * 返回：Promise<void>，全部客户端关闭或超时强制终止后返回。
     */
    async close_all() {
        this._http_server.off("upgrade", this._upgrade_handler);
        const clients = [...this._clients.values()];
        for (const client of clients) {
            try {
                client.socket.close(WS_CLOSE_CODE.GOING_AWAY, WS_CLOSE_REASON_GATEWAY_STOP);
            } catch (error) {
                this._logger.warn("关闭 WebSocket 客户端失败（%s）：%s", client.id, error.message);
            }
        }
        if (clients.length > 0) {
            await new Promise((resolve) => {
                const timer = setTimeout(() => {
                    clearInterval(poll_timer);
                    for (const client of clients) {
                        try {
                            client.socket.terminate();
                        } catch {
                            // 连接已关闭，忽略
                        }
                    }
                    resolve();
                }, WS_CLOSE_TIMEOUT_MS);
                const poll_timer = setInterval(() => {
                    if (this._clients.size === 0) {
                        clearTimeout(timer);
                        clearInterval(poll_timer);
                        resolve();
                    }
                }, WS_CLOSE_POLL_INTERVAL_MS);
            });
        }
        await new Promise((resolve) => {
            this._ws_server.close(() => resolve());
        });
        this._logger.info("WebSocket 会话中心已关闭");
    }

    /**
     * 处理 HTTP upgrade 请求：校验路径后完成握手，非法路径直接 404 并断开。
     *
     * 入参：req Node HTTP 请求；socket 原始套接字；head 升级请求头数据。
     * 返回：无。
     */
    _handle_upgrade(req, socket, head) {
        // 升级阶段客户端可能提前断开，必须捕获 socket 错误避免进程崩溃。
        socket.on("error", (error) => {
            this._logger.debug("WebSocket 升级套接字错误：%s", error.message);
        });
        let pathname;
        try {
            pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
        } catch {
            socket.destroy();
            return;
        }
        if (pathname !== this._ws_path) {
            this._logger.warn("拒绝非 %s 路径的 WebSocket 升级请求：%s", this._ws_path, pathname);
            socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
            socket.destroy();
            return;
        }
        try {
            this._ws_server.handleUpgrade(req, socket, head, (ws) => {
                this._ws_server.emit("connection", ws, req);
            });
        } catch (error) {
            this._logger.warn("WebSocket 握手失败：%s", error.message);
            socket.destroy();
        }
    }

    /**
     * 处理新客户端：分配标识、登记会话并触发接入回调。
     *
     * 入参：ws WebSocket 连接；req 原始升级请求。
     * 返回：无。
     */
    _handle_connection(ws, req) {
        this._next_client_index += 1;
        const client = {
            id: `${CLIENT_ID_PREFIX}${this._next_client_index}`,
            socket: ws,
            connected_at: Date.now(),
        };
        this._clients.set(client.id, client);
        const peer = req && req.socket ? req.socket.remoteAddress : "unknown";
        this._logger.info("WebSocket 客户端接入：%s（对端 %s，当前 %d 个）", client.id, peer, this._clients.size);

        ws.on("message", (data, is_binary) => {
            this._on_message(client, data, is_binary);
        });
        ws.on("close", () => {
            this._on_closed(client);
        });
        ws.on("error", (error) => {
            this._logger.warn("WebSocket 客户端异常（%s）：%s", client.id, error.message);
        });
        try {
            this._on_client_connected(client);
        } catch (error) {
            this._logger.error("处理客户端接入回调失败（%s）：%s", client.id, error.message);
        }
    }

    /**
     * 处理客户端文本帧，异常隔离在本客户端内，不影响其它连接。
     *
     * 入参：client 客户端对象；data 帧数据（Buffer）；is_binary 是否为二进制帧。
     * 返回：无。
     */
    _on_message(client, data, is_binary) {
        if (!this._clients.has(client.id)) {
            return;
        }
        try {
            this._on_client_message(client, data.toString("utf8"), Boolean(is_binary));
        } catch (error) {
            this._logger.error("处理 WebSocket 客户端报文失败（%s）：%s", client.id, error.message);
        }
    }

    /**
     * 处理客户端断开：从在线表移除并触发断开回调。
     *
     * 入参：client 客户端对象。
     * 返回：无。
     */
    _on_closed(client) {
        if (!this._clients.delete(client.id)) {
            return;
        }
        this._logger.info("WebSocket 客户端断开：%s（当前 %d 个）", client.id, this._clients.size);
        try {
            this._on_client_disconnected(client);
        } catch (error) {
            this._logger.error("处理客户端断开回调失败（%s）：%s", client.id, error.message);
        }
    }
}
