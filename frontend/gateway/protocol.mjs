// 文件功能：前端网关协议编解码与校验，统一 TCP NDJSON 报文、WebSocket 报文与 HTTP 统一响应结构
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11

import {
    CATEGORY_MAX_LENGTH,
    ERROR_CODE,
    ERROR_MESSAGE,
    MAX_ERROR_CODE,
    MODULE_ID,
    REQUIRED_MESSAGE_FIELDS,
    TASK_ID_MAX_LENGTH,
    WS_TYPE,
} from "./constants.mjs";

// 合法模块标识集合，用于 TCP 报文 source/target 校验
const VALID_MODULE_IDS = new Set(Object.values(MODULE_ID));

// 各模块允许接收的业务场景不做区分，本网关只做协议层校验

/**
 * 判断是否为普通对象（排除 null、数组与其它类型）。
 *
 * 入参：value 待判断值。
 * 返回：是普通对象返回 true，否则返回 false。
 */
export function is_plain_object(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 构建统一响应结构（STYLEGUIDE 4.2）：code / msg / data / timestamp。
 *
 * 入参：data 业务数据体，默认空对象；code 错误码；msg 状态说明。
 * 返回：统一响应对象，timestamp 为发送端毫秒时间戳。
 */
export function build_unified_response(data = {}, code = ERROR_CODE.SUCCESS, msg = "success") {
    return {
        code,
        msg,
        data: data === undefined || data === null ? {} : data,
        timestamp: Date.now(),
    };
}

/**
 * 构建 WebSocket 报文，统一携带 code / msg / data / timestamp 字段。
 *
 * 入参：type WebSocket 报文类型；data 业务数据体；extra 附加字段（如 request_id、msg_type），不得覆盖核心字段。
 * 返回：可直接 JSON 序列化的 WebSocket 报文对象。
 */
export function build_ws_message(type, data = {}, extra = {}) {
    return {
        type,
        code: ERROR_CODE.SUCCESS,
        msg: "success",
        data: data === undefined || data === null ? {} : data,
        timestamp: Date.now(),
        ...extra,
    };
}

/**
 * 构建 WebSocket 错误报文。
 *
 * 入参：request_id 原请求标识，无法解析时为 null；code 错误码；msg 错误描述；data 附加数据体。
 * 返回：{"type":"error", request_id, code, msg, data, timestamp} 报文对象。
 */
export function build_ws_error(request_id, code, msg, data = {}) {
    return {
        type: WS_TYPE.ERROR,
        request_id: request_id === undefined ? null : request_id,
        code,
        msg,
        data: data === undefined || data === null ? {} : data,
        timestamp: Date.now(),
    };
}

/**
 * 构建 TCP 标准报文（协议规范第 2 章）。
 *
 * 入参：msg_type 报文类型；source 发送方模块标识；target 接收方模块标识；data 业务数据体；
 *      code 错误码；msg 状态说明。
 * 返回：符合协议规范的报文字典。
 * 异常：msg_type / source / target 为空时抛出 Error（调用方参数错误）。
 */
export function build_tcp_message(msg_type, source, target, data = {}, code = ERROR_CODE.SUCCESS, msg = "success") {
    if (!msg_type || !source || !target) {
        throw new Error("msg_type / source / target 不允许为空");
    }
    return {
        msg_type,
        source,
        target,
        code,
        msg,
        data: data === undefined || data === null ? {} : data,
        timestamp: Date.now(),
    };
}

/**
 * 将报文字典编码为一行 NDJSON 文本（含结尾换行符，UTF-8 文本帧）。
 *
 * 入参：message 报文字典。
 * 返回：以 \n 结尾的 JSON 字符串。
 * 异常：message 含循环引用时 JSON.stringify 抛出 TypeError。
 */
export function encode_ndjson(message) {
    return `${JSON.stringify(message)}\n`;
}

/**
 * 校验并解析一行 NDJSON 报文，规则与 common/protocol.py 的 decode_message 保持一致。
 *
 * 入参：line 单行报文（Buffer 或字符串，可含结尾换行符）。
 * 返回：合法报文返回对象；JSON 解析失败、字段缺失或字段类型非法返回 null。
 */
export function decode_ndjson_line(line) {
    if (line === undefined || line === null) {
        return null;
    }
    let text = "";
    try {
        text = typeof line === "string" ? line : Buffer.from(line).toString("utf8");
    } catch {
        return null;
    }
    const trimmed = text.trim();
    if (!trimmed) {
        return null;
    }
    let message;
    try {
        message = JSON.parse(trimmed);
    } catch {
        return null;
    }
    if (!is_plain_object(message)) {
        return null;
    }
    for (const field of REQUIRED_MESSAGE_FIELDS) {
        if (!(field in message)) {
            return null;
        }
    }
    for (const field of ["msg_type", "source", "target"]) {
        if (typeof message[field] !== "string" || !message[field]) {
            return null;
        }
    }
    if (typeof message.msg !== "string") {
        return null;
    }
    if (!VALID_MODULE_IDS.has(message.source) || !VALID_MODULE_IDS.has(message.target)) {
        return null;
    }
    if (!Number.isInteger(message.code) || message.code < 0 || message.code > MAX_ERROR_CODE) {
        return null;
    }
    if (!Number.isInteger(message.timestamp) || message.timestamp < 0) {
        return null;
    }
    if (!is_plain_object(message.data)) {
        return null;
    }
    return message;
}

/**
 * 校验 task_start 报文业务数据。
 *
 * 入参：data 客户端下发的业务数据体。
 * 返回：校验通过返回 null；失败返回 {code, msg} 错误描述。
 */
export function validate_task_start_data(data) {
    if (!is_plain_object(data)) {
        return { code: ERROR_CODE.INVALID_PARAM, msg: ERROR_MESSAGE.INVALID_DATA };
    }
    if (typeof data.task_id !== "string" || !data.task_id) {
        return { code: ERROR_CODE.INVALID_PARAM, msg: ERROR_MESSAGE.EMPTY_TASK_ID };
    }
    if (data.task_id.length > TASK_ID_MAX_LENGTH) {
        return { code: ERROR_CODE.INVALID_PARAM, msg: ERROR_MESSAGE.TASK_ID_TOO_LONG };
    }
    if (data.category !== undefined && data.category !== null) {
        if (typeof data.category !== "string" || data.category.length > CATEGORY_MAX_LENGTH) {
            return { code: ERROR_CODE.INVALID_PARAM, msg: ERROR_MESSAGE.INVALID_CATEGORY };
        }
    }
    if (data.speed_level !== undefined && data.speed_level !== null) {
        if (typeof data.speed_level !== "number" || !Number.isFinite(data.speed_level)) {
            return { code: ERROR_CODE.INVALID_PARAM, msg: ERROR_MESSAGE.INVALID_SPEED_LEVEL };
        }
    }
    return null;
}

/**
 * 校验 WebSocket 客户端入站报文（仅允许 task_start 与 ping 两种类型）。
 *
 * 入参：raw_text 客户端发送的原始文本帧。
 * 返回：{message} 校验通过；{error:{code, msg, request_id}} 校验失败，request_id 无法解析时为 null。
 */
export function parse_client_message(raw_text) {
    const invalid_json = {
        error: { code: ERROR_CODE.INVALID_MESSAGE, msg: ERROR_MESSAGE.INVALID_JSON, request_id: null },
    };
    if (typeof raw_text !== "string") {
        return invalid_json;
    }
    let message;
    try {
        message = JSON.parse(raw_text);
    } catch {
        return invalid_json;
    }
    if (!is_plain_object(message)) {
        return { error: { code: ERROR_CODE.INVALID_MESSAGE, msg: ERROR_MESSAGE.INVALID_MESSAGE, request_id: null } };
    }
    const request_id = message.request_id === undefined ? null : message.request_id;
    if (request_id !== null && !is_valid_request_id(request_id)) {
        return { error: { code: ERROR_CODE.INVALID_PARAM, msg: ERROR_MESSAGE.INVALID_REQUEST_ID, request_id: null } };
    }
    if (typeof message.type !== "string" || !message.type) {
        return { error: { code: ERROR_CODE.INVALID_PARAM, msg: ERROR_MESSAGE.UNKNOWN_TYPE, request_id } };
    }
    if (message.type === WS_TYPE.PING) {
        return { message };
    }
    if (message.type === WS_TYPE.TASK_START) {
        const task_error = validate_task_start_data(message.data);
        if (task_error !== null) {
            return { error: { code: task_error.code, msg: task_error.msg, request_id } };
        }
        return { message };
    }
    return {
        error: {
            code: ERROR_CODE.INVALID_PARAM,
            msg: `${ERROR_MESSAGE.UNKNOWN_TYPE}：${message.type}`,
            request_id,
        },
    };
}

/**
 * 判断 request_id 是否合法：允许非空字符串或有限数值，其余类型拒绝。
 *
 * 入参：value 待校验值。
 * 返回：合法返回 true。
 */
function is_valid_request_id(value) {
    if (typeof value === "string") {
        return value.length > 0;
    }
    return typeof value === "number" && Number.isFinite(value);
}

/**
 * 构建 WebSocket 连接状态报文。
 *
 * 入参：state 连接状态快照 {tcp_connected, registered, backend_online}；client_id 客户端标识。
 * 返回：connection 报文对象。
 */
export function build_connection_message(state, client_id) {
    return build_ws_message(WS_TYPE.CONNECTION, {
        tcp_connected: Boolean(state.tcp_connected),
        registered: Boolean(state.registered),
        backend_online: Boolean(state.backend_online),
        client_id,
    });
}

/**
 * 构建 ack 报文。
 *
 * 入参：request_id 原请求标识；task_id 任务标识。
 * 返回：ack 报文对象。
 */
export function build_ack_message(request_id, task_id) {
    return build_ws_message(WS_TYPE.ACK, { task_id }, { request_id });
}

/**
 * 构建 pong 报文。
 *
 * 入参：request_id 可选原请求标识。
 * 返回：pong 报文对象。
 */
export function build_pong_message(request_id = null) {
    return build_ws_message(WS_TYPE.PONG, {}, { request_id });
}

/**
 * 构建 task_result 推送报文，data 保持后端原样。
 *
 * 入参：message 后端 task_result 报文。
 * 返回：WebSocket task_result 报文对象。
 */
export function build_task_result_message(message) {
    return {
        type: WS_TYPE.TASK_RESULT,
        code: typeof message.code === "number" ? message.code : ERROR_CODE.SUCCESS,
        msg: typeof message.msg === "string" ? message.msg : "success",
        data: is_plain_object(message.data) ? message.data : {},
        timestamp: Date.now(),
    };
}

/**
 * 构建 backend_message 转发报文（后端发往前端但网关不单独处理的报文）。
 *
 * 入参：message 后端原始 TCP 报文。
 * 返回：WebSocket backend_message 报文对象。
 */
export function build_backend_message(message) {
    return {
        type: WS_TYPE.BACKEND_MESSAGE,
        msg_type: message.msg_type,
        source: message.source,
        target: message.target,
        code: typeof message.code === "number" ? message.code : ERROR_CODE.SUCCESS,
        msg: typeof message.msg === "string" ? message.msg : "success",
        data: is_plain_object(message.data) ? message.data : {},
        timestamp: Date.now(),
    };
}

/**
 * 截断文本，用于状态接口 last_error 等展示字段，避免超长错误文本撑大响应。
 *
 * 入参：text 原始文本；max_length 最大字符数。
 * 返回：截断后的字符串。
 */
export function truncate_text(text, max_length) {
    const value = typeof text === "string" ? text : String(text ?? "");
    if (value.length <= max_length) {
        return value;
    }
    return value.slice(0, max_length);
}
