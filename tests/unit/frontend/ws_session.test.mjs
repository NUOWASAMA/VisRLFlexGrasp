// 文件功能：前端网关 WebSocket 会话集成测试（连接快照、校验错误码、ack、task_result 广播、error_report 关联与广播）
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11

import assert from "node:assert/strict";
import { test } from "node:test";

import { FrontendGateway } from "../../../frontend/gateway/gateway.mjs";
import {
    connect_ws,
    create_test_config,
    delay,
    get_unused_port,
    make_quiet_logger,
    REPO_ROOT,
    TestWsClient,
    wait_for,
} from "./helpers.mjs";
import { FakeTcpBackend } from "./fake_servers.mjs";

// 测试用快速时间参数：心跳、重连间隔远小于生产配置
const FAST_TIMING = {
    heartbeat_interval_sec: 0.05,
    heartbeat_timeout_sec: 0.5,
    reconnect_intervals_sec: [0.05, 0.1],
    send_timeout_sec: 0.2,
};

/**
 * 启动被测网关（HTTP 端口由操作系统分配），并注册测试清理。
 *
 * 入参：t 测试上下文；gateway_overrides 网关配置覆盖；auto_backend 是否自动启动假 TCP 后端；
 *      tcp_port 后端 TCP 端口（auto_backend 为 false 时使用）。
 * 返回：Promise<{gateway, backend, port, clients}>。
 */
async function setup_session(t, { gateway_overrides = {}, auto_backend = true, tcp_port = null } = {}) {
    const backend = auto_backend ? await new FakeTcpBackend().start() : null;
    const backend_port = backend === null ? (tcp_port ?? await get_unused_port()) : backend.port;
    const { config, paths } = create_test_config({
        gateway: { port: 0, ...FAST_TIMING, ...gateway_overrides },
        backend: { tcp: { port: backend_port } },
    });
    const gateway = new FrontendGateway({
        config,
        repo_root: REPO_ROOT,
        logger: make_quiet_logger("gateway"),
        paths,
    });
    const address = await gateway.start();
    const context = { gateway, backend, backend_port, port: address.port, clients: [] };
    t.after(async () => {
        for (const client of context.clients) {
            try {
                await client.close();
            } catch {
                // 连接可能已被服务端关闭
            }
        }
        await gateway.stop().catch(() => {});
        if (backend !== null) {
            await backend.stop().catch(() => {});
        }
    });
    return context;
}

/**
 * 建立 WebSocket 连接并等待 connection 快照报文。
 *
 * 入参：context setup_session 返回的上下文。
 * 返回：Promise<{client, connection}>。
 */
async function connect_client(context) {
    const client = await connect_ws(context.port);
    context.clients.push(client);
    const connection = await client.wait_for_message((message) => message.type === "connection");
    return { client, connection };
}

/**
 * 等待网关完成 TCP 注册（保证 task_start 可下发）。
 *
 * 入参：context 上下文；timeout_ms 超时。
 * 返回：Promise<void>。
 */
async function wait_registered(context, timeout_ms = 3000) {
    await wait_for(() => context.gateway.get_status_snapshot().registered, {
        timeout_ms,
        label: "网关完成前端模块注册",
    });
}

/**
 * 发送合法 task_start 并等待 ack。
 *
 * 入参：client WebSocket 测试客户端；task_id 任务标识；request_id 请求标识。
 * 返回：Promise<ack 报文>。
 */
async function send_task_start(client, task_id, request_id = "req-1") {
    client.send_json({
        type: "task_start",
        request_id,
        data: { task_id, category: "apple", speed_level: 2 },
    });
    return client.wait_for_message((message) => message.type === "ack" && message.request_id === request_id);
}

test("连接即下发 connection 快照，多客户端 client_id 唯一", async (t) => {
    const context = await setup_session(t);
    await wait_registered(context);
    const first = await connect_client(context);
    assert.equal(first.connection.code, 0);
    assert.equal(first.connection.msg, "success");
    assert.match(first.connection.data.client_id, /^client-\d+$/);
    assert.deepEqual(first.connection.data, {
        tcp_connected: true,
        registered: true,
        backend_online: true,
        client_id: first.connection.data.client_id,
    });
    const second = await connect_client(context);
    assert.notEqual(second.connection.data.client_id, first.connection.data.client_id);
    await wait_for(() => context.gateway.get_status_snapshot().clients === 2, { label: "两个在线客户端" });
});

test("ping 返回 pong 且沿用 request_id", async (t) => {
    const context = await setup_session(t);
    const { client } = await connect_client(context);
    client.send_json({ type: "ping", request_id: "ping-1" });
    const pong = await client.wait_for_message((message) => message.type === "pong");
    assert.equal(pong.request_id, "ping-1");
    assert.equal(pong.code, 0);
    assert.equal(Number.isInteger(pong.timestamp), true);
});

test("非法 JSON 与未知报文类型返回 1001/1000", async (t) => {
    const context = await setup_session(t);
    const { client } = await connect_client(context);
    client.send_raw("不是 JSON");
    const invalid_json = await client.wait_for_message((message) => message.type === "error");
    assert.equal(invalid_json.code, 1001);
    assert.equal(invalid_json.request_id, null);
    client.send_json({ type: "task_stop", request_id: "r-2" });
    const unknown = await client.wait_for_message(
        (message) => message.type === "error" && message.request_id === "r-2");
    assert.equal(unknown.code, 1000);
    assert.match(unknown.msg, /未知报文类型/);
});

test("task_start 校验：task_id 为空或超长返回 1000 且不发往后端", async (t) => {
    const context = await setup_session(t);
    await wait_registered(context);
    const { client } = await connect_client(context);
    client.send_json({ type: "task_start", request_id: "r-1", data: { task_id: "" } });
    const empty = await client.wait_for_message((message) => message.type === "error");
    assert.equal(empty.code, 1000);
    assert.equal(empty.request_id, "r-1");
    client.send_json({
        type: "task_start",
        request_id: "r-2",
        data: { task_id: "a".repeat(257), category: "apple", speed_level: 1 },
    });
    const too_long = await client.wait_for_message(
        (message) => message.type === "error" && message.request_id === "r-2");
    assert.equal(too_long.code, 1000);
    await delay(100);
    assert.equal(context.backend.received.some((message) => message.msg_type === "task_start"), false);
});

test("合法 task_start 立即 ack 并下发到后端 TCP", async (t) => {
    const context = await setup_session(t);
    await wait_registered(context);
    const { client } = await connect_client(context);
    const ack = await send_task_start(client, "task-1", "req-1");
    assert.deepEqual(ack.data, { task_id: "task-1" });
    assert.equal(ack.request_id, "req-1");
    const task_start = await context.backend.wait_for_message(
        (message) => message.msg_type === "task_start" && message.data.task_id === "task-1");
    assert.equal(task_start.source, "frontend");
    assert.equal(task_start.target, "backend");
    assert.deepEqual(task_start.data, { task_id: "task-1", category: "apple", speed_level: 2 });
});

test("TCP 未注册时 task_start 直接本地返回 4000 且不回 ack", async (t) => {
    const context = await setup_session(t, {
        auto_backend: false,
        gateway_overrides: { reconnect_intervals_sec: [0.2] },
    });
    const { client, connection } = await connect_client(context);
    assert.equal(connection.data.tcp_connected, false);
    client.send_json({ type: "task_start", request_id: "r-1", data: { task_id: "t1" } });
    const error = await client.wait_for_message((message) => message.type === "error");
    assert.equal(error.code, 4000);
    assert.equal(error.request_id, "r-1");
    await delay(150);
    assert.equal(client.messages.some((message) => message.type === "ack"), false);
});

test("task_result 广播到所有在线客户端且 data 原样", async (t) => {
    const context = await setup_session(t);
    await wait_registered(context);
    const first = (await connect_client(context)).client;
    const second = (await connect_client(context)).client;
    await wait_for(() => context.gateway.get_status_snapshot().clients === 2, { label: "两个在线客户端" });
    const data = { task_id: "task-9", sorted_count: 3, is_finished: false, phase: "sorting" };
    context.backend.send_task_result(data);
    const first_result = await first.wait_for_message((message) => message.type === "task_result");
    const second_result = await second.wait_for_message((message) => message.type === "task_result");
    assert.deepEqual(first_result.data, data);
    assert.deepEqual(second_result.data, data);
});

test("error_report 带 task_id 命中 pending 时定向回原请求并清 pending", async (t) => {
    const context = await setup_session(t);
    await wait_registered(context);
    const other = (await connect_client(context)).client;
    const requester = (await connect_client(context)).client;
    await send_task_start(requester, "task-1", "req-1");
    context.backend.send_error_report(3003, "已有任务正在运行", { task_id: "task-1" });
    const error = await requester.wait_for_message((message) => message.type === "error");
    assert.equal(error.code, 3003);
    assert.equal(error.msg, "已有任务正在运行");
    assert.equal(error.request_id, "req-1");
    assert.equal(error.data.task_id, "task-1");
    await delay(200);
    assert.equal(other.messages.length, 0);
    assert.equal(context.gateway.pending_task_start_count, 0);
});

test("error_report 不带 task_id 且仅一个 pending 时按兜底定向返回", async (t) => {
    const context = await setup_session(t);
    await wait_registered(context);
    const { client } = await connect_client(context);
    await send_task_start(client, "task-1", "req-fallback");
    context.backend.send_error_report(4000, "算法模块离线");
    const error = await client.wait_for_message((message) => message.type === "error");
    assert.equal(error.code, 4000);
    assert.equal(error.msg, "算法模块离线");
    assert.equal(error.request_id, "req-fallback");
    assert.equal(context.gateway.pending_task_start_count, 0);
});

test("error_report 不带 task_id 且多个 pending 时广播 backend_message", async (t) => {
    const context = await setup_session(t);
    await wait_registered(context);
    const first = (await connect_client(context)).client;
    const second = (await connect_client(context)).client;
    await send_task_start(first, "task-1", "req-1");
    await send_task_start(second, "task-2", "req-2");
    await wait_for(
        () => context.backend.received.filter((message) => message.msg_type === "task_start").length === 2,
        { label: "后端收到两个 task_start" },
    );
    context.backend.send_error_report(1000, "参数非法");
    const first_message = await first.wait_for_message((message) => message.type === "backend_message");
    const second_message = await second.wait_for_message((message) => message.type === "backend_message");
    assert.equal(first_message.msg_type, "error_report");
    assert.equal(first_message.code, 1000);
    assert.equal(second_message.msg_type, "error_report");
    assert.equal(context.gateway.pending_task_start_count, 2);
});

test("无 pending 时 error_report 广播 backend_message", async (t) => {
    const context = await setup_session(t);
    await wait_registered(context);
    const { client } = await connect_client(context);
    context.backend.send_error_report(3002, "紧急停止已触发", { detail: "estop" });
    const message = await client.wait_for_message((item) => item.type === "backend_message");
    assert.equal(message.msg_type, "error_report");
    assert.equal(message.code, 3002);
    assert.deepEqual(message.data, { detail: "estop" });
});

test("task_result 命中 pending 时清除关联，后续 error_report 走广播", async (t) => {
    const context = await setup_session(t);
    await wait_registered(context);
    const { client } = await connect_client(context);
    await send_task_start(client, "task-9", "req-9");
    context.backend.send_task_result({ task_id: "task-9", sorted_count: 1, is_finished: false });
    await client.wait_for_message((message) => message.type === "task_result");
    await wait_for(() => context.gateway.pending_task_start_count === 0, { label: "pending 已清除" });
    context.backend.send_error_report(3001, "运动执行失败", {});
    const message = await client.wait_for_message((item) => item.type === "backend_message");
    assert.equal(message.msg_type, "error_report");
    assert.equal(message.code, 3001);
});

test("TCP 连接状态变化向在线客户端广播 connection", async (t) => {
    const context = await setup_session(t);
    await wait_registered(context);
    const { client } = await connect_client(context);
    context.backend.close_sockets();
    const connection = await client.wait_for_message(
        (message) => message.type === "connection" && message.data.tcp_connected === false);
    assert.equal(connection.data.registered, false);
    assert.equal(connection.data.backend_online, false);
});

test("超过单帧上限的客户端帧导致连接被关闭", async (t) => {
    const context = await setup_session(t, { gateway_overrides: { max_frame_bytes: 1024 } });
    const { client } = await connect_client(context);
    client.send_raw("x".repeat(4096));
    await wait_for(() => client.closed, { timeout_ms: 3000, label: "超限帧关闭连接" });
});

test("非 ws_path 的升级请求被拒绝", async (t) => {
    const context = await setup_session(t);
    const url = `ws://127.0.0.1:${context.port}/not-ws`;
    await assert.rejects(TestWsClient.connect(url), /WebSocket 连接失败/);
});
