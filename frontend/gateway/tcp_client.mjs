// 文件功能：前端网关 TCP 客户端，连接后端调度服务完成 frontend 模块注册、心跳保活、任务下发与断线递增重连
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11

import { EventEmitter } from "node:events";
import net from "node:net";

import {
    LOG_TEXT_PREVIEW_LENGTH,
    MODULE_ID,
    MSG_TYPE,
} from "./constants.mjs";
import { build_tcp_message, decode_ndjson_line, encode_ndjson, truncate_text } from "./protocol.mjs";

// 连接关闭事件的最长等待时间（毫秒），避免优雅停止时无限等待
const STOP_CLOSE_TIMEOUT_MS = 1000;

/**
 * 前端网关与后端调度服务之间的 TCP 长连接客户端。
 *
 * 职责边界：只负责传输层（连接、注册、心跳、重连、收发报文），业务关联由网关判断。
 */
export class TcpFrontendClient extends EventEmitter {
    /**
     * 构造 TCP 客户端，所有间隔与超时参数均来自配置。
     *
     * 入参：host/port 后端 TCP 地址；heartbeat_interval_sec 心跳间隔；
     *      heartbeat_timeout_sec 心跳超时判定；reconnect_intervals_sec 递增重连间隔数组；
     *      send_timeout_sec 单次发送超时；max_frame_bytes 单帧长度上限；logger 日志器。
     */
    constructor({
        host,
        port,
        heartbeat_interval_sec,
        heartbeat_timeout_sec,
        reconnect_intervals_sec,
        send_timeout_sec,
        max_frame_bytes,
        logger,
    }) {
        super();
        this._host = host;
        this._port = port;
        this._heartbeat_interval_sec = heartbeat_interval_sec;
        this._heartbeat_timeout_sec = heartbeat_timeout_sec;
        this._reconnect_intervals_sec = reconnect_intervals_sec;
        this._send_timeout_sec = send_timeout_sec;
        this._max_frame_bytes = max_frame_bytes;
        this._logger = logger;

        this._socket = null;
        this._running = false;
        this._stopping = false;
        this._connected = false;
        this._registered = false;
        this._receive_buffer = "";
        this._last_received_at = 0;
        this._reconnect_index = 0;
        this._reconnect_timer = null;
        this._heartbeat_timer = null;
        this._write_timers = new Set();
        this._last_error = null;
        this._last_error_at = 0;
    }

    /** 底层 socket 是否已连接 */
    get is_connected() {
        return this._connected;
    }

    /** 是否已收到后端 register_ack */
    get is_registered() {
        return this._registered;
    }

    /** 最近一次连接错误描述，正常注册后清空 */
    get last_error() {
        return this._last_error;
    }

    /** 最近一次连接错误发生时间（毫秒时间戳），无错误时为 0 */
    get last_error_at() {
        return this._last_error_at;
    }

    /**
     * 当前连接状态快照，供状态接口与 WebSocket 广播使用。
     *
     * 返回：{tcp_connected, registered, backend_online}。
     */
    get state() {
        return {
            tcp_connected: this._connected,
            registered: this._registered,
            backend_online: this._registered,
        };
    }

    /**
     * 启动客户端：发起首次连接，失败后按配置的递增间隔持续重连，永不主动退出。
     *
     * 返回：无。
     */
    start() {
        if (this._running) {
            return;
        }
        this._running = true;
        this._stopping = false;
        this._reconnect_index = 0;
        this._logger.info("后端 TCP 客户端启动，目标 %s:%d", this._host, this._port);
        this._connect();
    }

    /**
     * 停止客户端：取消全部定时器并关闭连接，不再重连。
     *
     * 返回：Promise<void>，连接关闭后返回。
     */
    async stop() {
        if (this._stopping) {
            return;
        }
        this._stopping = true;
        this._running = false;
        this._clear_reconnect_timer();
        this._stop_heartbeat();
        this._clear_write_timers();
        const socket = this._socket;
        this._socket = null;
        this._connected = false;
        this._registered = false;
        this._receive_buffer = "";
        if (socket === null || socket.destroyed) {
            this._logger.info("后端 TCP 客户端已停止");
            return;
        }
        await new Promise((resolve) => {
            const timer = setTimeout(resolve, STOP_CLOSE_TIMEOUT_MS);
            socket.once("close", () => {
                clearTimeout(timer);
                resolve();
            });
            socket.destroy();
        });
        this._logger.info("后端 TCP 客户端已停止");
    }

    /**
     * 下发分拣任务报文（source=frontend，target=backend）。
     *
     * 入参：task_id 任务标识；category 分拣品类；speed_level 速度档位。
     * 返回：发送成功返回 true；未注册或连接不可写返回 false。
     */
    send_task_start({ task_id, category = "", speed_level = null }) {
        if (!this._registered) {
            return false;
        }
        const message = build_tcp_message(
            MSG_TYPE.TASK_START,
            MODULE_ID.FRONTEND,
            MODULE_ID.BACKEND,
            { task_id, category, speed_level },
        );
        return this._write_message(message);
    }

    /**
     * 发起一次 TCP 连接（内部使用，外部通过 start/stop 控制生命周期）。
     *
     * 返回：无。
     */
    _connect() {
        if (!this._running || this._stopping) {
            return;
        }
        this._logger.debug("正在连接后端 TCP %s:%d", this._host, this._port);
        const socket = net.createConnection({ host: this._host, port: this._port });
        socket.setEncoding("utf8");
        socket.setNoDelay(true);
        this._receive_buffer = "";
        this._socket = socket;
        socket.on("connect", () => {
            if (socket !== this._socket) {
                return;
            }
            this._on_connected();
        });
        socket.on("data", (chunk) => {
            if (socket !== this._socket) {
                return;
            }
            this._on_data(chunk);
        });
        socket.on("error", (error) => {
            this._set_last_error(`TCP 连接错误：${error.message}`);
            this._logger.warn("后端 TCP 连接错误：%s", error.message);
        });
        socket.on("close", () => {
            if (socket !== this._socket) {
                return;
            }
            this._on_closed();
        });
    }

    /**
     * 连接建立后发送注册报文，等待 register_ack。
     *
     * 返回：无。
     */
    _on_connected() {
        this._connected = true;
        this._registered = false;
        this._receive_buffer = "";
        this._last_received_at = Date.now();
        this._logger.info("已连接后端 TCP %s:%d，发送 frontend 模块注册报文", this._host, this._port);
        this._emit_state_change();
        this._write_message(build_tcp_message(
            MSG_TYPE.REGISTER,
            MODULE_ID.FRONTEND,
            MODULE_ID.BACKEND,
            { module: MODULE_ID.FRONTEND },
        ));
    }

    /**
     * 处理收到的文本数据：按换行符切分 NDJSON 并逐条校验分发。
     *
     * 入参：chunk 文本分片。
     * 返回：无。
     */
    _on_data(chunk) {
        this._receive_buffer += chunk;
        if (this._receive_buffer.length > this._max_frame_bytes) {
            this._set_last_error("后端 TCP 报文超长，连接已重置");
            this._logger.warn("后端 TCP 报文超过单帧上限 %d 字节，断开重连", this._max_frame_bytes);
            if (this._socket !== null) {
                this._socket.destroy();
            }
            return;
        }
        let newline_index = this._receive_buffer.indexOf("\n");
        while (newline_index >= 0) {
            const line = this._receive_buffer.slice(0, newline_index);
            this._receive_buffer = this._receive_buffer.slice(newline_index + 1);
            if (line.trim()) {
                this._on_line(line);
            }
            newline_index = this._receive_buffer.indexOf("\n");
        }
    }

    /**
     * 处理单行报文：校验失败仅告警并丢弃，合法报文更新活跃时间后分发。
     *
     * 入参：line 单行 NDJSON 文本。
     * 返回：无。
     */
    _on_line(line) {
        const message = decode_ndjson_line(line);
        if (message === null) {
            this._logger.warn("忽略非法 TCP 报文：%s", truncate_text(line.trim(), LOG_TEXT_PREVIEW_LENGTH));
            return;
        }
        this._last_received_at = Date.now();
        this._on_message(message);
    }

    /**
     * 按报文类型处理后端消息：注册确认与心跳应答本地消费，其余交给网关转发。
     *
     * 入参：message 合法 TCP 报文。
     * 返回：无。
     */
    _on_message(message) {
        if (message.msg_type === MSG_TYPE.REGISTER_ACK) {
            if (this._registered) {
                this._logger.debug("重复收到 register_ack，已忽略");
                return;
            }
            this._registered = true;
            this._reconnect_index = 0;
            this._last_error = null;
            this._last_error_at = 0;
            this._logger.info("frontend 模块注册成功（后端 %s:%d）", this._host, this._port);
            this._start_heartbeat();
            this._emit_state_change();
            return;
        }
        if (message.msg_type === MSG_TYPE.HEARTBEAT_ACK) {
            this._logger.debug("收到后端 heartbeat_ack");
            return;
        }
        if (!this._registered) {
            if (message.msg_type === MSG_TYPE.ERROR_REPORT) {
                // 注册阶段的错误（如 3003 同名 frontend 已有在线连接）：只告警并退避重连，不广播给浏览器。
                this._set_last_error(`注册被后端拒绝：${message.code} ${message.msg}`);
                this._logger.warn("注册阶段后端返回错误：code=%d msg=%s，将退避重连", message.code, message.msg);
                if (this._socket !== null) {
                    this._socket.destroy();
                }
                return;
            }
            this._logger.warn("未注册阶段收到非注册报文 %s，已忽略", message.msg_type);
            return;
        }
        this.emit("message", message);
    }

    /**
     * 启动心跳定时器：周期发送 heartbeat，并检查后端报文是否超时。
     *
     * 返回：无。
     */
    _start_heartbeat() {
        this._stop_heartbeat();
        const interval_ms = this._heartbeat_interval_sec * 1000;
        this._heartbeat_timer = setInterval(() => {
            this._heartbeat_tick();
        }, interval_ms);
        this._logger.debug("心跳定时器已启动，间隔 %s 秒", this._heartbeat_interval_sec);
    }

    /**
     * 停止心跳定时器。
     *
     * 返回：无。
     */
    _stop_heartbeat() {
        if (this._heartbeat_timer !== null) {
            clearInterval(this._heartbeat_timer);
            this._heartbeat_timer = null;
        }
    }

    /**
     * 单次心跳处理：超时则判定断线并重连，否则发送 heartbeat。
     *
     * 返回：无。
     */
    _heartbeat_tick() {
        if (!this._registered || !this._connected || this._socket === null) {
            return;
        }
        const silent_ms = Date.now() - this._last_received_at;
        if (silent_ms > this._heartbeat_timeout_sec * 1000) {
            this._set_last_error(`后端心跳超时（${this._heartbeat_timeout_sec} 秒未收到报文）`);
            this._logger.warn("后端心跳超时（%s 秒未收到报文），断开重连", this._heartbeat_timeout_sec);
            this._socket.destroy();
            return;
        }
        this._write_message(build_tcp_message(
            MSG_TYPE.HEARTBEAT,
            MODULE_ID.FRONTEND,
            MODULE_ID.BACKEND,
        ));
        this._logger.debug("已发送心跳报文");
    }

    /**
     * 连接关闭处理：清理状态并按递增间隔安排重连。
     *
     * 返回：无。
     */
    _on_closed() {
        const was_active = this._connected || this._registered;
        this._socket = null;
        this._connected = false;
        this._registered = false;
        this._receive_buffer = "";
        this._stop_heartbeat();
        this._clear_write_timers();
        if (!this._running || this._stopping) {
            return;
        }
        if (was_active) {
            this._logger.warn("后端 TCP 连接断开，准备重连");
        }
        this._emit_state_change();
        this._schedule_reconnect();
    }

    /**
     * 按配置的递增间隔安排下一次重连；超过最后一项后保持最后一项间隔。
     *
     * 返回：无。
     */
    _schedule_reconnect() {
        if (!this._running || this._stopping || this._reconnect_timer !== null) {
            return;
        }
        const intervals = this._reconnect_intervals_sec;
        const index = Math.min(this._reconnect_index, intervals.length - 1);
        const delay_sec = intervals[index];
        this._reconnect_index += 1;
        this._logger.info("将在 %s 秒后进行第 %d 次重连", delay_sec, this._reconnect_index);
        this._reconnect_timer = setTimeout(() => {
            this._reconnect_timer = null;
            this._connect();
        }, delay_sec * 1000);
    }

    /**
     * 取消待执行的重连定时器。
     *
     * 返回：无。
     */
    _clear_reconnect_timer() {
        if (this._reconnect_timer !== null) {
            clearTimeout(this._reconnect_timer);
            this._reconnect_timer = null;
        }
    }

    /**
     * 发送一条 TCP 报文，带发送超时保护；连接不可写时返回 false。
     *
     * 入参：message 报文字典。
     * 返回：写入成功返回 true，连接不可用返回 false。
     */
    _write_message(message) {
        const socket = this._socket;
        if (socket === null || socket.destroyed || !socket.writable) {
            return false;
        }
        let finished = false;
        const timer = setTimeout(() => {
            if (finished) {
                return;
            }
            finished = true;
            this._write_timers.delete(timer);
            this._set_last_error("TCP 报文发送超时，连接已重置");
            this._logger.warn("TCP 报文发送超时（%s 秒），断开重连", this._send_timeout_sec);
            socket.destroy();
        }, this._send_timeout_sec * 1000);
        this._write_timers.add(timer);
        try {
            socket.write(encode_ndjson(message), (error) => {
                finished = true;
                clearTimeout(timer);
                this._write_timers.delete(timer);
                if (error) {
                    this._logger.warn("TCP 报文发送失败：%s", error.message);
                }
            });
            return true;
        } catch (error) {
            finished = true;
            clearTimeout(timer);
            this._write_timers.delete(timer);
            this._logger.warn("TCP 报文写入异常：%s", error.message);
            return false;
        }
    }

    /**
     * 清理所有发送超时定时器。
     *
     * 返回：无。
     */
    _clear_write_timers() {
        for (const timer of this._write_timers) {
            clearTimeout(timer);
        }
        this._write_timers.clear();
    }

    /**
     * 记录最近一次连接错误（同时记录时间戳，供网关状态接口取最新错误）。
     *
     * 入参：text 错误描述。
     * 返回：无。
     */
    _set_last_error(text) {
        this._last_error = truncate_text(text, LOG_TEXT_PREVIEW_LENGTH);
        this._last_error_at = Date.now();
    }

    /**
     * 通知监听方连接状态发生变化。
     *
     * 返回：无。
     */
    _emit_state_change() {
        this.emit("state_change", this.state);
    }
}
