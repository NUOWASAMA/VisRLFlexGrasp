// 文件功能：前端网关核心编排层，串联 TCP 客户端、WebSocket 会话与 HTTP 服务，并负责 task_start 与后端报文的关联
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11

import http from "node:http";

import {
    CUSTOM_ENV,
    ERROR_CODE,
    ERROR_MESSAGE,
    LAST_ERROR_MAX_LENGTH,
    MSG_TYPE,
    WS_TYPE,
} from "./constants.mjs";
import { resolve_runtime_paths } from "./config_loader.mjs";
import { FrontendHttpServer } from "./http_server.mjs";
import {
    build_ack_message,
    build_backend_message,
    build_connection_message,
    build_pong_message,
    build_task_result_message,
    build_ws_error,
    is_plain_object,
    parse_client_message,
    truncate_text,
} from "./protocol.mjs";
import { StaticFileServer } from "./static_files.mjs";
import { TaskStartCorrelator } from "./task_correlator.mjs";
import { TcpFrontendClient } from "./tcp_client.mjs";
import { WsClientHub } from "./ws_server.mjs";

// 仅支持 JSON 文本帧的错误提示
const BINARY_FRAME_MESSAGE = "仅支持 JSON 文本帧";

/**
 * 前端网关：浏览器与既有后端调度服务之间的唯一桥梁。
 *
 * 职责边界：HTTP 反向代理与静态托管、WebSocket 推送、TCP frontend 模块客户端；
 * 不修改 backend/ 任何代码，只使用其既有 HTTP 与内部 TCP 接口。
 */
export class FrontendGateway {
    /**
     * 构造网关实例（构造阶段不监听端口，调用 start 才真正启动）。
     *
     * 入参：config 已校验配置；repo_root 仓库根绝对路径；logger 日志器；
     *      paths 可选，已解析的 {static_dir, log_file} 绝对路径。
     */
    constructor({ config, repo_root, logger, paths = null }) {
        this._config = config;
        this._repo_root = repo_root;
        this._logger = logger;
        this._paths = paths ?? resolve_runtime_paths(config, repo_root);
        this._listen_address = null;
        this._last_http_error = null;
        this._last_http_error_at = 0;
        this._started = false;
        this._stopping = false;
        this._task_correlator = new TaskStartCorrelator({ logger: logger.child("task") });

        const static_server = new StaticFileServer({
            static_root: this._paths.static_dir,
            logger: logger.child("static"),
        });
        this._http_frontend = new FrontendHttpServer({
            config,
            logger: logger.child("http"),
            static_server,
            proxy_timeout_ms: config.gateway.send_timeout_sec * 1000,
            state_provider: {
                get_status_snapshot: () => this.get_status_snapshot(),
                get_config_view: () => this.get_config_view(),
                record_error: (message) => this.record_error(message),
            },
        });
        this._http_server = http.createServer((req, res) => {
            void this._http_frontend.handle_request(req, res);
        });
        this._http_server.on("error", (error) => {
            this._logger.error("HTTP 服务异常：%s", error.message);
        });

        this._ws_hub = new WsClientHub({
            http_server: this._http_server,
            ws_path: config.gateway.ws_path,
            max_frame_bytes: config.gateway.max_frame_bytes,
            logger: logger.child("ws"),
            on_client_connected: (client) => this._on_ws_connected(client),
            on_client_message: (client, text, is_binary) => this._on_ws_message(client, text, is_binary),
            on_client_disconnected: (client) => this._on_ws_disconnected(client),
        });

        this._tcp_client = new TcpFrontendClient({
            host: config.backend.tcp.host,
            port: config.backend.tcp.port,
            heartbeat_interval_sec: config.gateway.heartbeat_interval_sec,
            heartbeat_timeout_sec: config.gateway.heartbeat_timeout_sec,
            reconnect_intervals_sec: config.gateway.reconnect_intervals_sec,
            send_timeout_sec: config.gateway.send_timeout_sec,
            max_frame_bytes: config.gateway.max_frame_bytes,
            logger: logger.child("tcp"),
        });
        this._tcp_client.on("state_change", () => this._on_tcp_state_change());
        this._tcp_client.on("message", (message) => this._on_backend_message(message));
    }

    /** 实际监听地址 {host, port}，未启动时为 null */
    get listen_address() {
        return this._listen_address;
    }

    /** 待关联 task_start 数量（测试与诊断用） */
    get pending_task_start_count() {
        return this._task_correlator.size;
    }

    /** 网关配置（只读引用） */
    get config() {
        return this._config;
    }

    /**
     * 启动网关：接管 WebSocket 升级、启动 TCP 客户端并监听 HTTP 端口。
     *
     * 返回：Promise<{host, port}> 实际监听地址。
     * 异常：端口被占用等监听失败时抛出，由入口打印明确错误并退出。
     */
    async start() {
        if (this._started) {
            return this._listen_address;
        }
        this._started = true;
        this._ws_hub.start();
        this._tcp_client.start();
        await new Promise((resolve, reject) => {
            const on_error = (error) => {
                this._http_server.off("listening", on_listening);
                reject(error);
            };
            const on_listening = () => {
                this._http_server.off("error", on_error);
                resolve();
            };
            this._http_server.once("error", on_error);
            this._http_server.once("listening", on_listening);
            this._http_server.listen(this._config.gateway.port, this._config.gateway.host);
        });
        const address = this._http_server.address();
        const actual_port = address !== null && typeof address === "object" ? address.port : this._config.gateway.port;
        this._listen_address = { host: this._config.gateway.host, port: actual_port };
        const tcp_state = this._tcp_client.state;
        this._logger.info("前端网关 HTTP 服务已监听 http://%s:%d（WebSocket %s）",
            this._listen_address.host, this._listen_address.port, this._config.gateway.ws_path);
        this._logger.info("静态资源目录：%s", this._paths.static_dir);
        this._logger.info("后端 HTTP 目标：%s:%d；后端 TCP 目标：%s:%d",
            this._config.backend.http.host, this._config.backend.http.port,
            this._config.backend.tcp.host, this._config.backend.tcp.port);
        this._logger.info("后端连接状态：TCP %s，注册 %s",
            tcp_state.tcp_connected ? "已连接" : "未连接", tcp_state.registered ? "已完成" : "未完成");
        return this._listen_address;
    }

    /**
     * 优雅关闭网关：先关闭 WebSocket 客户端，再停止 TCP 客户端与 HTTP 服务。
     *
     * 返回：Promise<void>，全部资源释放后返回。
     */
    async stop() {
        if (this._stopping) {
            return;
        }
        this._stopping = true;
        this._logger.info("前端网关开始优雅关闭");
        this._task_correlator.clear_all();
        await this._ws_hub.close_all();
        await this._tcp_client.stop();
        await new Promise((resolve) => {
            this._http_server.close(() => {
                resolve();
            });
            if (typeof this._http_server.closeAllConnections === "function") {
                this._http_server.closeAllConnections();
            }
        });
        this._listen_address = null;
        this._logger.info("前端网关已关闭");
    }

    /**
     * 状态快照：供 GET /api/gateway/status 与诊断使用。
     *
     * 返回：{tcp_connected, registered, backend_online, clients, last_error}。
     */
    get_status_snapshot() {
        const state = this._tcp_client.state;
        return {
            tcp_connected: state.tcp_connected,
            registered: state.registered,
            backend_online: state.backend_online,
            clients: this._ws_hub.client_count,
            last_error: this._resolve_last_error(),
        };
    }

    /**
     * 配置视图：供 GET /api/gateway/config 使用，只暴露前端需要的字段。
     *
     * 返回：{env, ui, gateway:{host,port,ws_path}, backend:{http:{host,port}}}。
     */
    get_config_view() {
        const address = this._listen_address;
        return {
            env: this._config.env ?? CUSTOM_ENV,
            ui: this._config.ui ?? {},
            gateway: {
                host: address === null ? this._config.gateway.host : address.host,
                port: address === null ? this._config.gateway.port : address.port,
                ws_path: this._config.gateway.ws_path,
            },
            backend: {
                http: {
                    host: this._config.backend.http.host,
                    port: this._config.backend.http.port,
                },
            },
        };
    }

    /**
     * 记录最近一次对外通信错误，供状态接口展示（HTTP 代理失败等）。
     *
     * 入参：message 错误描述。
     * 返回：无。
     */
    record_error(message) {
        this._last_http_error = truncate_text(String(message ?? ""), LAST_ERROR_MAX_LENGTH);
        this._last_http_error_at = Date.now();
    }

    /**
     * 解析最近错误：取 TCP 连接错误与 HTTP 代理错误中时间更新的一条。
     *
     * 返回：错误文本或 null。
     */
    _resolve_last_error() {
        const tcp_error = this._tcp_client.last_error;
        if (tcp_error === null || tcp_error === undefined) {
            return this._format_last_error(this._last_http_error);
        }
        if (this._last_http_error === null || this._last_http_error === undefined) {
            return this._format_last_error(tcp_error);
        }
        const tcp_at = this._tcp_client.last_error_at ?? 0;
        return this._format_last_error(tcp_at >= this._last_http_error_at ? tcp_error : this._last_http_error);
    }

    /**
     * 截断错误文本用于状态接口展示。
     *
     * 入参：error_text 错误文本。
     * 返回：截断后的文本；空文本返回 null。
     */
    _format_last_error(error_text) {
        if (error_text === null || error_text === undefined || error_text === "") {
            return null;
        }
        return truncate_text(error_text, LAST_ERROR_MAX_LENGTH);
    }

    /**
     * 新客户端接入：立即下发当前连接状态快照。
     *
     * 入参：client WebSocket 客户端对象。
     * 返回：无。
     */
    _on_ws_connected(client) {
        this._ws_hub.send(client, this._build_connection_message(client.id));
    }

    /**
     * 客户端断开：清理其名下待关联任务，避免后端迟到响应投递到已离线客户端。
     *
     * 入参：client WebSocket 客户端对象。
     * 返回：无。
     */
    _on_ws_disconnected(client) {
        const removed = this._task_correlator.clear_client(client.id);
        if (removed > 0) {
            this._logger.debug("客户端 %s 断开，清理 %d 个待关联任务", client.id, removed);
        }
    }

    /**
     * 处理客户端文本帧：校验后分发 ping / task_start，非法报文回明确错误码。
     *
     * 入参：client 客户端对象；text 文本帧内容；is_binary 是否为二进制帧。
     * 返回：无。
     */
    _on_ws_message(client, text, is_binary) {
        if (is_binary) {
            this._ws_hub.send(client, build_ws_error(null, ERROR_CODE.INVALID_MESSAGE, BINARY_FRAME_MESSAGE));
            return;
        }
        const parsed = parse_client_message(text);
        if (parsed.error) {
            this._ws_hub.send(client, build_ws_error(
                parsed.error.request_id, parsed.error.code, parsed.error.msg));
            return;
        }
        const message = parsed.message;
        if (message.type === WS_TYPE.PING) {
            this._ws_hub.send(client, build_pong_message(message.request_id ?? null));
            return;
        }
        if (message.type === WS_TYPE.TASK_START) {
            this._handle_task_start(client, message);
        }
    }

    /**
     * 处理 task_start：TCP 未就绪直接本地回 4000；成功写入后端后立即 ack 并登记关联窗口。
     *
     * 入参：client 客户端对象；message 已校验的 task_start 报文。
     * 返回：无。
     */
    _handle_task_start(client, message) {
        const request_id = message.request_id ?? null;
        const data = message.data;
        const state = this._tcp_client.state;
        if (!state.tcp_connected || !state.registered) {
            this._ws_hub.send(client, build_ws_error(
                request_id, ERROR_CODE.TARGET_OFFLINE, ERROR_MESSAGE.BACKEND_OFFLINE));
            return;
        }
        const task_id = data.task_id;
        const sent = this._tcp_client.send_task_start({
            task_id,
            category: data.category ?? "",
            speed_level: data.speed_level ?? null,
        });
        if (!sent) {
            this._ws_hub.send(client, build_ws_error(
                request_id, ERROR_CODE.TARGET_OFFLINE, ERROR_MESSAGE.TASK_SEND_FAILED));
            return;
        }
        this._task_correlator.add({ task_id, request_id, client_id: client.id });
        this._ws_hub.send(client, build_ack_message(request_id, task_id));
        this._logger.info("已下发分拣任务：%s（request_id=%s，客户端 %s）", task_id, String(request_id), client.id);
    }

    /**
     * TCP 状态变化：记录日志并向全部 WebSocket 客户端广播 connection 报文。
     *
     * 返回：无。
     */
    _on_tcp_state_change() {
        const state = this._tcp_client.state;
        this._logger.info("后端 TCP 状态变更：TCP %s，注册 %s",
            state.tcp_connected ? "已连接" : "未连接", state.registered ? "已注册" : "未注册");
        this._ws_hub.broadcast((client) => this._build_connection_message(client.id));
    }

    /**
     * 处理后端发往前端的报文：task_result 广播、error_report 关联或广播、其余转发 backend_message。
     *
     * 入参：message 合法 TCP 报文。
     * 返回：无。
     */
    _on_backend_message(message) {
        if (message.msg_type === MSG_TYPE.TASK_RESULT) {
            this._handle_task_result(message);
            return;
        }
        if (message.msg_type === MSG_TYPE.ERROR_REPORT) {
            this._handle_backend_error_report(message);
            return;
        }
        if (message.msg_type === MSG_TYPE.REGISTER_ACK || message.msg_type === MSG_TYPE.HEARTBEAT_ACK) {
            // 传输层已消费的报文，防御性忽略
            return;
        }
        this._logger.debug("广播后端报文：%s", message.msg_type);
        this._ws_hub.broadcast(build_backend_message(message));
    }

    /**
     * 处理 task_result：命中 pending 时清除关联，并向所有客户端广播原样 data。
     *
     * 入参：message 后端 task_result 报文。
     * 返回：无。
     */
    _handle_task_result(message) {
        const data = is_plain_object(message.data) ? message.data : {};
        const task_id = typeof data.task_id === "string" ? data.task_id : "";
        if (task_id) {
            this._task_correlator.remove(task_id);
        }
        const sent = this._ws_hub.broadcast(build_task_result_message(message));
        this._logger.info("向 %d 个客户端广播 task_result（task_id=%s）", sent, task_id || "-");
    }

    /**
     * 处理后端 error_report：优先按 task_id 定向回原请求；后端同步拒绝不带 task_id 时按唯一 pending 兜底；
     * 其余情况广播 backend_message。
     *
     * 入参：message 后端 error_report 报文。
     * 返回：无。
     */
    _handle_backend_error_report(message) {
        const data = is_plain_object(message.data) ? message.data : {};
        const task_id = typeof data.task_id === "string" && data.task_id ? data.task_id : "";
        let pending = null;
        let matched_by = "";
        if (task_id) {
            pending = this._task_correlator.take_by_task_id(task_id);
            if (pending !== null) {
                matched_by = "task_id";
            }
        }
        if (task_id === "" && pending === null) {
            // 后端同步拒绝的 error_report 不携带 task_id（后端硬约束），唯一 pending 时按窗口归因。
            pending = this._task_correlator.take_single();
            if (pending !== null) {
                matched_by = "唯一 pending 兜底";
            }
        }
        if (pending !== null) {
            const client = this._ws_hub.get_client(pending.client_id);
            const delivered = client === undefined
                ? false
                : this._ws_hub.send(client, build_ws_error(pending.request_id, message.code, message.msg, data));
            if (delivered) {
                this._logger.warn("后端拒绝任务 %s（%s，request_id=%s）：%s",
                    task_id || pending.task_id, matched_by, String(pending.request_id), message.msg);
                return;
            }
            this._logger.warn("后端拒绝任务时客户端已离线，改为广播错误：%s", message.msg);
        } else if (task_id === "" && this._task_correlator.size > 1) {
            this._logger.warn("后端 error_report 未携带 task_id 且存在多个待关联任务，按广播处理：%s", message.msg);
        }
        this._ws_hub.broadcast(build_backend_message(message));
        this._logger.warn("广播后端 error_report（code=%s）：%s", message.code, message.msg);
    }

    /**
     * 构建当前连接状态报文。
     *
     * 入参：client_id 客户端标识。
     * 返回：connection 报文对象。
     */
    _build_connection_message(client_id) {
        return build_connection_message(this._tcp_client.state, client_id);
    }
}
