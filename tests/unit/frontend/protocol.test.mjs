// 文件功能：前端网关协议编解码与校验单元测试（TCP NDJSON、WebSocket 报文、统一响应结构）
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    ERROR_CODE,
    ERROR_MESSAGE,
    MODULE_ID,
    MSG_TYPE,
    TASK_ID_MAX_LENGTH,
    WS_TYPE,
} from "../../../frontend/gateway/constants.mjs";
import {
    build_ack_message,
    build_backend_message,
    build_connection_message,
    build_pong_message,
    build_task_result_message,
    build_tcp_message,
    build_unified_response,
    build_ws_error,
    build_ws_message,
    decode_ndjson_line,
    encode_ndjson,
    is_plain_object,
    parse_client_message,
    truncate_text,
    validate_task_start_data,
} from "../../../frontend/gateway/protocol.mjs";

/**
 * 构造一条合法 TCP 报文，并按需覆盖字段。
 *
 * 入参：overrides 字段覆盖。
 * 返回：报文字典。
 */
function make_message(overrides = {}) {
    return {
        msg_type: MSG_TYPE.TASK_RESULT,
        source: MODULE_ID.BACKEND,
        target: MODULE_ID.FRONTEND,
        code: ERROR_CODE.SUCCESS,
        msg: "success",
        data: {},
        timestamp: 1700000000000,
        ...overrides,
    };
}

test("build_tcp_message 生成协议规范第 2 章完整结构", () => {
    const message = build_tcp_message(MSG_TYPE.TASK_START, MODULE_ID.FRONTEND, MODULE_ID.BACKEND, { task_id: "t1" });
    assert.equal(message.msg_type, "task_start");
    assert.equal(message.source, "frontend");
    assert.equal(message.target, "backend");
    assert.equal(message.code, 0);
    assert.equal(message.msg, "success");
    assert.deepEqual(message.data, { task_id: "t1" });
    assert.equal(Number.isInteger(message.timestamp), true);
    assert.ok(message.timestamp > 0);
});

test("build_tcp_message 缺省 data 为空对象且空 msg_type 抛错", () => {
    const message = build_tcp_message(MSG_TYPE.HEARTBEAT, MODULE_ID.FRONTEND, MODULE_ID.BACKEND);
    assert.deepEqual(message.data, {});
    assert.throws(() => build_tcp_message("", MODULE_ID.FRONTEND, MODULE_ID.BACKEND), /不允许为空/);
});

test("encode_ndjson 输出单行且以换行结尾", () => {
    const line = encode_ndjson(make_message({ msg: "含中文\n换行的说明" }));
    assert.equal(line.endsWith("\n"), true);
    assert.equal(line.indexOf("\n"), line.length - 1);
    assert.equal(JSON.parse(line.trim()).msg, "含中文\n换行的说明");
});

test("decode_ndjson_line 解析合法报文（字符串与 Buffer）", () => {
    const line = encode_ndjson(make_message({ data: { task_id: "t1", sorted_count: 2 } }));
    const from_string = decode_ndjson_line(line);
    assert.equal(from_string.msg_type, "task_result");
    assert.deepEqual(from_string.data, { task_id: "t1", sorted_count: 2 });
    const from_buffer = decode_ndjson_line(Buffer.from(line, "utf8"));
    assert.deepEqual(from_buffer, from_string);
    assert.equal(decode_ndjson_line(`  ${line.trim()}  `).msg_type, "task_result");
    assert.equal(decode_ndjson_line(""), null);
});

test("decode_ndjson_line 拒绝非法 JSON 与根节点非对象", () => {
    assert.equal(decode_ndjson_line("not json"), null);
    assert.equal(decode_ndjson_line("[1, 2, 3]"), null);
    assert.equal(decode_ndjson_line("null"), null);
    assert.equal(decode_ndjson_line("\"text\""), null);
});

test("decode_ndjson_line 拒绝缺失必填字段", () => {
    for (const field of ["msg_type", "source", "target", "code", "msg", "data", "timestamp"]) {
        const message = make_message();
        delete message[field];
        assert.equal(decode_ndjson_line(JSON.stringify(message)), null, `缺失字段 ${field} 应被拒绝`);
    }
});

test("decode_ndjson_line 拒绝字段类型非法", () => {
    const invalid_cases = [
        { msg_type: "" },
        { source: "robot" },
        { target: "unknown" },
        { code: -1 },
        { code: 5000 },
        { code: 1.5 },
        { code: "0" },
        { msg: 123 },
        { data: [] },
        { timestamp: -1 },
        { timestamp: 1.5 },
        { timestamp: "1700000000000" },
    ];
    for (const invalid of invalid_cases) {
        assert.equal(decode_ndjson_line(JSON.stringify(make_message(invalid))), null,
            `${JSON.stringify(invalid)} 应被拒绝`);
    }
});

test("build_unified_response 返回 code/msg/data/timestamp", () => {
    const response = build_unified_response({ status: "ok" });
    assert.equal(response.code, 0);
    assert.equal(response.msg, "success");
    assert.deepEqual(response.data, { status: "ok" });
    assert.equal(Number.isInteger(response.timestamp), true);
    assert.deepEqual(build_unified_response(undefined, 1004, "不存在").data, {});
});

test("build_ws_message 与 build_ws_error 结构正确", () => {
    const message = build_ws_message(WS_TYPE.PONG, {}, { request_id: 7 });
    assert.equal(message.type, "pong");
    assert.equal(message.code, 0);
    assert.equal(message.msg, "success");
    assert.equal(message.request_id, 7);
    assert.equal(Number.isInteger(message.timestamp), true);
    const error = build_ws_error("req-1", ERROR_CODE.INVALID_PARAM, "参数错误", { task_id: "t1" });
    assert.equal(error.type, "error");
    assert.equal(error.request_id, "req-1");
    assert.equal(error.code, 1000);
    assert.equal(error.msg, "参数错误");
    assert.deepEqual(error.data, { task_id: "t1" });
    assert.equal(build_ws_error(undefined, 1001, "x").request_id, null);
});

test("parse_client_message 接受 ping 与合法 task_start", () => {
    const ping = parse_client_message(JSON.stringify({ type: "ping", request_id: 1 }));
    assert.equal(ping.error, undefined);
    assert.equal(ping.message.type, "ping");
    const task = parse_client_message(JSON.stringify({
        type: "task_start",
        request_id: "req-1",
        data: { task_id: "t1", category: "apple", speed_level: 2 },
    }));
    assert.equal(task.error, undefined);
    assert.equal(task.message.data.task_id, "t1");
});

test("parse_client_message 非法 JSON 返回 1001", () => {
    assert.equal(parse_client_message("not-json").error.code, ERROR_CODE.INVALID_MESSAGE);
    assert.equal(parse_client_message("[]").error.code, ERROR_CODE.INVALID_MESSAGE);
    assert.equal(parse_client_message(Buffer.from("x")).error.code, ERROR_CODE.INVALID_MESSAGE);
    assert.equal(parse_client_message("not-json").error.request_id, null);
});

test("parse_client_message 未知类型返回 1000 并携带 request_id", () => {
    const parsed = parse_client_message(JSON.stringify({ type: "task_stop", request_id: "req-9" }));
    assert.equal(parsed.error.code, ERROR_CODE.INVALID_PARAM);
    assert.equal(parsed.error.request_id, "req-9");
    assert.match(parsed.error.msg, /未知报文类型/);
    assert.equal(parse_client_message(JSON.stringify({ request_id: 1 })).error.code, ERROR_CODE.INVALID_PARAM);
});

test("parse_client_message 校验 task_id 空值与超长", () => {
    const empty = parse_client_message(JSON.stringify({
        type: "task_start",
        data: { task_id: "", category: "apple", speed_level: 1 },
    }));
    assert.equal(empty.error.code, ERROR_CODE.INVALID_PARAM);
    assert.equal(empty.error.msg, ERROR_MESSAGE.EMPTY_TASK_ID);
    const max_ok = parse_client_message(JSON.stringify({
        type: "task_start",
        data: { task_id: "a".repeat(TASK_ID_MAX_LENGTH), category: "apple", speed_level: 1 },
    }));
    assert.equal(max_ok.error, undefined);
    const too_long = parse_client_message(JSON.stringify({
        type: "task_start",
        data: { task_id: "a".repeat(TASK_ID_MAX_LENGTH + 1) },
    }));
    assert.equal(too_long.error.code, ERROR_CODE.INVALID_PARAM);
    assert.equal(too_long.error.msg, ERROR_MESSAGE.TASK_ID_TOO_LONG);
});

test("parse_client_message 校验 data/category/speed_level/request_id 类型", () => {
    const invalid_messages = [
        { type: "task_start", request_id: "r", data: [] },
        { type: "task_start", request_id: "r", data: { task_id: 123 } },
        { type: "task_start", request_id: "r", data: { task_id: "t1", category: 1 } },
        { type: "task_start", request_id: "r", data: { task_id: "t1", category: "a".repeat(65) } },
        { type: "task_start", request_id: "r", data: { task_id: "t1", speed_level: "fast" } },
        { type: "task_start", request_id: "r", data: { task_id: "t1", speed_level: [] } },
        { type: "task_start", request_id: { nested: true }, data: { task_id: "t1" } },
        { type: "task_start", request_id: "", data: { task_id: "t1" } },
    ];
    for (const message of invalid_messages) {
        const parsed = parse_client_message(JSON.stringify(message));
        assert.equal(parsed.error.code, ERROR_CODE.INVALID_PARAM, `${JSON.stringify(message)} 应被拒绝`);
    }
});

test("parse_client_message 允许省略 request_id、category、speed_level", () => {
    const parsed = parse_client_message(JSON.stringify({ type: "task_start", data: { task_id: "t1" } }));
    assert.equal(parsed.error, undefined);
    assert.equal(validate_task_start_data({ task_id: "t1" }), null);
});

test("build_connection_message 输出连接状态字段", () => {
    const message = build_connection_message({ tcp_connected: 1, registered: 0, backend_online: true }, "client-1");
    assert.equal(message.type, "connection");
    assert.deepEqual(message.data, {
        tcp_connected: true,
        registered: false,
        backend_online: true,
        client_id: "client-1",
    });
});

test("ack/pong/task_result/backend_message 报文构造", () => {
    const ack = build_ack_message("req-1", "t1");
    assert.equal(ack.type, "ack");
    assert.equal(ack.request_id, "req-1");
    assert.deepEqual(ack.data, { task_id: "t1" });
    const pong = build_pong_message();
    assert.equal(pong.type, "pong");
    assert.equal(pong.request_id, null);
    const result = build_task_result_message(make_message({ data: { task_id: "t1", sorted_count: 3 } }));
    assert.equal(result.type, "task_result");
    assert.deepEqual(result.data, { task_id: "t1", sorted_count: 3 });
    const backend = build_backend_message(make_message({
        msg_type: MSG_TYPE.ERROR_REPORT,
        code: 4000,
        msg: "算法模块离线",
        data: { detail: "x" },
    }));
    assert.equal(backend.type, "backend_message");
    assert.equal(backend.msg_type, "error_report");
    assert.equal(backend.source, "backend");
    assert.equal(backend.code, 4000);
    assert.equal(backend.msg, "算法模块离线");
    assert.deepEqual(backend.data, { detail: "x" });
});

test("is_plain_object 与 truncate_text 辅助函数", () => {
    assert.equal(is_plain_object({}), true);
    assert.equal(is_plain_object([]), false);
    assert.equal(is_plain_object(null), false);
    assert.equal(is_plain_object("x"), false);
    assert.equal(truncate_text("abcdef", 3), "abc");
    assert.equal(truncate_text("ab", 3), "ab");
    assert.equal(truncate_text(null, 3), "");
});
