// 文件功能：前端网关 TCP 客户端单元测试（注册、心跳、任务下发、非法帧、断线递增重连、注册拒绝重试、停止语义）
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11

import assert from "node:assert/strict";
import { test } from "node:test";

import { TcpFrontendClient } from "../../../frontend/gateway/tcp_client.mjs";
import { create_test_config, delay, get_unused_port, make_quiet_logger, wait_for } from "./helpers.mjs";
import { FakeTcpBackend } from "./fake_servers.mjs";

// 测试用快速时间参数：心跳/重连间隔远小于生产配置，保证用例秒级完成
const FAST_TIMING = {
    heartbeat_interval_sec: 0.05,
    heartbeat_timeout_sec: 0.5,
    reconnect_intervals_sec: [0.05, 0.1],
    send_timeout_sec: 0.2,
    max_frame_bytes: 1048576,
};

/**
 * 构造连接到指定端口的 TCP 客户端。
 *
 * 入参：port 后端 TCP 端口；gateway_overrides 覆盖的网关时间参数。
 * 返回：TcpFrontendClient 实例。
 */
function make_client(port, gateway_overrides = {}) {
    const { config } = create_test_config({
        gateway: { ...FAST_TIMING, ...gateway_overrides },
        backend: { tcp: { port } },
    });
    return new TcpFrontendClient({
        host: config.backend.tcp.host,
        port,
        heartbeat_interval_sec: config.gateway.heartbeat_interval_sec,
        heartbeat_timeout_sec: config.gateway.heartbeat_timeout_sec,
        reconnect_intervals_sec: config.gateway.reconnect_intervals_sec,
        send_timeout_sec: config.gateway.send_timeout_sec,
        max_frame_bytes: config.gateway.max_frame_bytes,
        logger: make_quiet_logger("tcp"),
    });
}

test("注册、心跳、任务下发与 task_result 回传", async (t) => {
    const backend = await new FakeTcpBackend().start();
    const client = make_client(backend.port);
    t.after(async () => {
        await client.stop();
        await backend.stop();
    });
    const messages = [];
    client.on("message", (message) => messages.push(message));
    client.start();
    await wait_for(() => client.is_registered, { label: "frontend 注册成功" });

    const register = await backend.wait_for_message((message) => message.msg_type === "register");
    assert.equal(register.source, "frontend");
    assert.equal(register.target, "backend");
    assert.equal(register.data.module, "frontend");

    await wait_for(
        () => backend.received.filter((message) => message.msg_type === "heartbeat").length >= 2,
        { label: "至少两次心跳" },
    );

    assert.equal(client.send_task_start({ task_id: "t1", category: "apple", speed_level: 2 }), true);
    const task_start = await backend.wait_for_message((message) => message.msg_type === "task_start");
    assert.deepEqual(task_start.data, { task_id: "t1", category: "apple", speed_level: 2 });
    assert.equal(task_start.source, "frontend");
    assert.equal(task_start.target, "backend");

    backend.send_task_result({ task_id: "t1", sorted_count: 1, is_finished: false });
    await wait_for(() => messages.length === 1, { label: "客户端收到 task_result" });
    assert.equal(messages[0].msg_type, "task_result");
    assert.deepEqual(messages[0].data, { task_id: "t1", sorted_count: 1, is_finished: false });
});

test("未注册时 task_start 发送返回 false", async (t) => {
    const port = await get_unused_port();
    const client = make_client(port);
    t.after(() => client.stop());
    client.start();
    assert.equal(client.send_task_start({ task_id: "t1", category: "apple", speed_level: 1 }), false);
});

test("非法 TCP 帧被忽略且不影响后续合法报文", async (t) => {
    const backend = await new FakeTcpBackend().start();
    const client = make_client(backend.port);
    t.after(async () => {
        await client.stop();
        await backend.stop();
    });
    const messages = [];
    client.on("message", (message) => messages.push(message));
    client.start();
    await wait_for(() => client.is_registered, { label: "frontend 注册成功" });
    const socket = backend.first_socket;
    assert.ok(socket !== null);
    socket.write("这不是 JSON\n");
    socket.write("{\"msg_type\":\"task_result\"}\n");
    backend.send_task_result({ task_id: "t2", sorted_count: 2, is_finished: true });
    await wait_for(() => messages.length === 1, { label: "忽略非法帧后收到合法 task_result" });
    assert.equal(messages[0].data.task_id, "t2");
    assert.equal(client.is_registered, true);
});

test("连接断开后按配置间隔重连并重新注册", async (t) => {
    const backend = await new FakeTcpBackend().start();
    const client = make_client(backend.port);
    t.after(async () => {
        await client.stop();
        await backend.stop();
    });
    client.start();
    await wait_for(() => client.is_registered, { label: "首次注册成功" });
    const register_count_before = backend.received.filter((message) => message.msg_type === "register").length;
    backend.close_sockets();
    await wait_for(() => !client.is_connected, { label: "检测到连接断开" });
    await wait_for(() => client.is_registered, { label: "断线后重新注册成功" });
    const register_count_after = backend.received.filter((message) => message.msg_type === "register").length;
    assert.ok(register_count_after > register_count_before);
});

test("初次连接失败后持续重连直至后端可用", async (t) => {
    const port = await get_unused_port();
    const client = make_client(port);
    t.after(() => client.stop());
    client.start();
    await delay(150);
    assert.equal(client.is_connected, false);
    const backend = await new FakeTcpBackend().start(port);
    t.after(() => backend.stop());
    await wait_for(() => client.is_registered, { timeout_ms: 5000, label: "后端就绪后完成注册" });
    assert.equal(backend.received.filter((message) => message.msg_type === "register").length, 1);
});

test("后端 3003 拒绝注册时退避重试且不崩溃", async (t) => {
    const backend = await new FakeTcpBackend({ register_error_code: 3003 }).start();
    const client = make_client(backend.port);
    t.after(async () => {
        await client.stop();
        await backend.stop();
    });
    client.start();
    await wait_for(
        () => backend.received.filter((message) => message.msg_type === "register").length >= 2,
        { timeout_ms: 5000, label: "注册重试" },
    );
    assert.equal(client.is_registered, false);
    assert.match(client.last_error ?? "", /3003/);
});

test("心跳超时判定断线并重连", async (t) => {
    const backend = await new FakeTcpBackend({ auto_heartbeat: false }).start();
    const client = make_client(backend.port, {
        heartbeat_interval_sec: 0.03,
        heartbeat_timeout_sec: 0.12,
        reconnect_intervals_sec: [0.05],
    });
    t.after(async () => {
        await client.stop();
        await backend.stop();
    });
    client.start();
    await wait_for(() => client.is_registered, { label: "首次注册成功" });
    await wait_for(
        () => backend.received.filter((message) => message.msg_type === "register").length >= 2,
        { timeout_ms: 5000, label: "心跳超时后重新注册" },
    );
});

test("stop 后不再重连也不再发送报文", async (t) => {
    const port = await get_unused_port();
    const client = make_client(port);
    t.after(() => client.stop());
    client.start();
    await delay(80);
    await client.stop();
    const backend = await new FakeTcpBackend().start(port);
    t.after(() => backend.stop());
    await delay(300);
    assert.equal(backend.sockets.size, 0);
    assert.equal(backend.received.length, 0);
});

test("state 快照与 last_error 语义", async (t) => {
    const backend = await new FakeTcpBackend().start();
    const client = make_client(backend.port);
    t.after(async () => {
        await client.stop();
        await backend.stop();
    });
    assert.deepEqual(client.state, { tcp_connected: false, registered: false, backend_online: false });
    client.start();
    await wait_for(() => client.is_registered, { label: "frontend 注册成功" });
    assert.deepEqual(client.state, { tcp_connected: true, registered: true, backend_online: true });
    assert.equal(client.last_error, null);
});

test("未注册阶段收到非注册报文时忽略，注册确认后恢复", async (t) => {
    const backend = await new FakeTcpBackend({
        auto_register: false,
        on_message: (message, socket, backend_ref) => {
            if (message.msg_type !== "register") {
                return;
            }
            backend_ref.send(socket, backend_ref._build_message(
                "task_result", "backend", "frontend", { task_id: "t0" }));
            backend_ref.send(socket, backend_ref._build_message("register_ack", "backend", "frontend", {}));
        },
    }).start();
    const client = make_client(backend.port);
    t.after(async () => {
        await client.stop();
        await backend.stop();
    });
    const messages = [];
    client.on("message", (message) => messages.push(message));
    client.start();
    await wait_for(() => client.is_registered, { label: "注册成功" });
    await delay(80);
    assert.equal(messages.length, 0);
});
