// 文件功能：task_start 关联窗口管理，把后端同步拒绝的 error_report 归因回原请求（含"唯一 pending"兜底策略）
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11

import { PENDING_TASK_START_TTL_MS } from "./constants.mjs";

/**
 * task_start 关联窗口：task_id -> {request_id, client_id, timer}。
 *
 * 后端同步拒绝的 error_report 协议里没有 request_id，且当前后端实现不携带 task_id，
 * 因此需要按 task_id 或"窗口内唯一 pending"把错误定向回发起请求的浏览器客户端。
 */
export class TaskStartCorrelator {
    /**
     * 构造关联窗口管理器。
     *
     * 入参：ttl_ms 窗口保留时长（毫秒）；logger 日志器（可空）。
     */
    constructor({ ttl_ms = PENDING_TASK_START_TTL_MS, logger = null } = {}) {
        this._ttl_ms = ttl_ms;
        this._logger = logger;
        this._pending = new Map();
    }

    /** 当前窗口内待关联任务数量 */
    get size() {
        return this._pending.size;
    }

    /**
     * 登记一个 task_start 关联项；同一 task_id 重复登记时替换旧项。
     *
     * 入参：task_id 任务标识；request_id 原请求标识；client_id 发起客户端标识。
     * 返回：无。
     */
    add({ task_id, request_id, client_id }) {
        this.remove(task_id);
        const timer = setTimeout(() => {
            const entry = this._pending.get(task_id);
            if (entry !== undefined && entry.timer === timer) {
                this._pending.delete(task_id);
                this._log_debug("task_start 关联窗口到期，任务 %s 未收到后端同步拒绝", task_id);
            }
        }, this._ttl_ms);
        this._pending.set(task_id, { task_id, request_id, client_id, timer });
    }

    /**
     * 按 task_id 移除关联项并清理定时器。
     *
     * 入参：task_id 任务标识。
     * 返回：被移除的关联项 {task_id, request_id, client_id}；不存在返回 null。
     */
    remove(task_id) {
        const entry = this._pending.get(task_id);
        if (entry === undefined) {
            return null;
        }
        clearTimeout(entry.timer);
        this._pending.delete(task_id);
        return entry;
    }

    /**
     * 按 task_id 命中并取出关联项（主路径：后端 error_report 的 data.task_id 与 pending 一致）。
     *
     * 入参：task_id 任务标识。
     * 返回：关联项；不存在返回 null。
     */
    take_by_task_id(task_id) {
        return this.remove(task_id);
    }

    /**
     * 兜底路径：仅当窗口内恰好一条 pending 时取出它。
     *
     * 返回：关联项；0 条或多于 1 条时返回 null。
     */
    take_single() {
        if (this._pending.size !== 1) {
            return null;
        }
        const [task_id] = this._pending.keys();
        return this.remove(task_id);
    }

    /**
     * 清理指定客户端名下全部待关联任务（客户端断线时调用）。
     *
     * 入参：client_id 客户端标识。
     * 返回：清理数量。
     */
    clear_client(client_id) {
        let removed = 0;
        for (const [task_id, entry] of this._pending) {
            if (entry.client_id !== client_id) {
                continue;
            }
            clearTimeout(entry.timer);
            this._pending.delete(task_id);
            removed += 1;
        }
        return removed;
    }

    /**
     * 清空全部关联项与定时器（网关关闭时调用）。
     *
     * 返回：无。
     */
    clear_all() {
        for (const entry of this._pending.values()) {
            clearTimeout(entry.timer);
        }
        this._pending.clear();
    }

    /**
     * 输出调试日志，未注入日志器时静默。
     *
     * 入参：message 格式串；args 参数。
     * 返回：无。
     */
    _log_debug(message, ...args) {
        if (this._logger !== null) {
            this._logger.debug(message, ...args);
        }
    }
}
