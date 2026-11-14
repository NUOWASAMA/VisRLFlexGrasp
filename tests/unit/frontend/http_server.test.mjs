// 文件功能：前端网关 HTTP 服务集成测试（反代透传、网关配置/状态接口、运行环境模式代理、未知 API 404、不可达 503、超时 504）
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11

import assert from "node:assert/strict";
import { test } from "node:test";

import { FrontendGateway } from "../../../frontend/gateway/gateway.mjs";
import {
    create_test_config,
    get_unused_port,
    http_request,
    make_quiet_logger,
    REPO_ROOT,
} from "./helpers.mjs";
import { FakeHttpBackend, FakeTcpBackend } from "./fake_servers.mjs";

/**
 * 构造模拟后端 HTTP 服务的路由处理函数。
 *
 * 入参：overrides 按路径覆盖的响应（键为 URL 路径）。
 * 返回：handler 函数。
 */
function make_backend_handler(overrides = {}) {
    return (record) => {
        if (overrides[record.url] !== undefined) {
            return overrides[record.url];
        }
        const request_path = record.url.split("?")[0];
        if (record.url === "/health") {
            return { status_code: 200, body: { code: 0, msg: "success", data: { status: "ok" }, timestamp: 1 } };
        }
        if (record.url === "/robot/status") {
            return {
                status_code: 200,
                body: { code: 0, msg: "success", data: { motion_online: false }, timestamp: 2 },
            };
        }
        if (record.url === "/robot/plan" && record.method === "POST") {
            return {
                status_code: 202,
                body: { code: 0, msg: "success", data: { task_id: "task-1", status: "planning" }, timestamp: 3 },
            };
        }
        if (record.url.startsWith("/tasks/")) {
            return { status_code: 200, body: { code: 0, msg: "success", data: { task_id: "x" }, timestamp: 4 } };
        }
        if (request_path === "/system/mode" && record.method === "GET") {
            return {
                status_code: 200,
                body: {
                    code: 0,
                    msg: "success",
                    data: {
                        mode: "sim",
                        available_modes: ["sim", "real"],
                        hardware: { available: false },
                        degraded: false,
                        updated_at: 1700000000000,
                    },
                    timestamp: 6,
                },
            };
        }
        if (request_path === "/system/mode" && record.method === "POST") {
            return {
                status_code: 200,
                body: { code: 0, msg: "success", data: { mode: "real", degraded: true }, timestamp: 7 },
            };
        }
        return { status_code: 404, body: { code: 1004, msg: "后端未知路径", data: {}, timestamp: 5 } };
    };
}

/**
 * 启动被测网关（HTTP 端口由操作系统分配），并注册测试清理。
 *
 * 入参：t 测试上下文；options 配置选项（start_backend 是否启动假后端 HTTP；
 *      use_tcp_backend 是否启动假后端 TCP，用于避免 TCP 重连错误干扰 last_error 断言）。
 * 返回：Promise<{gateway, port, http_backend}>。
 */
async function setup_http_gateway(t, {
    backend_handler = make_backend_handler(),
    gateway_overrides = {},
    backend_http_port = null,
    start_backend = true,
    use_tcp_backend = false,
} = {}) {
    let http_backend = null;
    if (start_backend) {
        http_backend = await new FakeHttpBackend(backend_handler).start();
    }
    let tcp_backend = null;
    if (use_tcp_backend) {
        tcp_backend = await new FakeTcpBackend().start();
    }
    const http_port = backend_http_port ?? (http_backend === null ? await get_unused_port() : http_backend.port);
    const tcp_port = tcp_backend === null ? await get_unused_port() : tcp_backend.port;
    const { config, paths } = create_test_config({
        gateway: { port: 0, reconnect_intervals_sec: [0.1], send_timeout_sec: 3, ...gateway_overrides },
        backend: { http: { port: http_port }, tcp: { port: tcp_port } },
    });
    const gateway = new FrontendGateway({
        config,
        repo_root: REPO_ROOT,
        logger: make_quiet_logger("gateway"),
        paths,
    });
    const address = await gateway.start();
    t.after(async () => {
        await gateway.stop().catch(() => {});
        if (http_backend !== null) {
            await http_backend.stop().catch(() => {});
        }
        if (tcp_backend !== null) {
            await tcp_backend.stop().catch(() => {});
        }
    });
    return { gateway, port: address.port, http_backend, tcp_backend };
}

test("GET /api/health 透传后端响应", async (t) => {
    const { port, http_backend } = await setup_http_gateway(t);
    const response = await http_request({ port, path: "/api/health" });
    assert.equal(response.status, 200);
    assert.deepEqual(response.json, { code: 0, msg: "success", data: { status: "ok" }, timestamp: 1 });
    assert.equal(http_backend.requests.length, 1);
    assert.equal(http_backend.requests[0].method, "GET");
    assert.equal(http_backend.requests[0].url, "/health");
});

test("GET /api/robot/status 透传后端响应", async (t) => {
    const { port, http_backend } = await setup_http_gateway(t);
    const response = await http_request({ port, path: "/api/robot/status" });
    assert.equal(response.status, 200);
    assert.deepEqual(response.json.data, { motion_online: false });
    assert.equal(http_backend.requests[0].url, "/robot/status");
});

test("POST /api/robot/plan 透传 JSON 请求体与后端 202 响应", async (t) => {
    const { port, http_backend } = await setup_http_gateway(t);
    const request_body = JSON.stringify({
        grasp_pose: { position: [0.8, 0, 0.5], orientation: [0, 0, 0, 1] },
        force_limit: 5,
    });
    const response = await http_request({
        port,
        path: "/api/robot/plan",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: request_body,
    });
    assert.equal(response.status, 202);
    assert.deepEqual(response.json.data, { task_id: "task-1", status: "planning" });
    const record = http_backend.requests[0];
    assert.equal(record.method, "POST");
    assert.equal(record.url, "/robot/plan");
    assert.equal(record.body, request_body);
    assert.equal(record.headers["content-type"], "application/json");
});

test("GET /api/tasks/{id} 透传到后端 /tasks/{id}", async (t) => {
    const { port, http_backend } = await setup_http_gateway(t);
    const response = await http_request({ port, path: "/api/tasks/abc-123" });
    assert.equal(response.status, 200);
    assert.equal(response.json.code, 0);
    assert.equal(http_backend.requests[0].url, "/tasks/abc-123");
});

test("POST /api/robot/plan 透传后端 409 业务错误", async (t) => {
    const handler = make_backend_handler({
        "/robot/plan": {
            status_code: 409,
            body: { code: 3003, msg: "已有规划任务，不排队、不抢占", data: {}, timestamp: 9 },
        },
    });
    const { port } = await setup_http_gateway(t, { backend_handler: handler });
    const response = await http_request({
        port,
        path: "/api/robot/plan",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
    });
    assert.equal(response.status, 409);
    assert.equal(response.json.code, 3003);
});

test("未知 /api/* 返回 404 与统一错误码 1004", async (t) => {
    const { port } = await setup_http_gateway(t);
    const response = await http_request({ port, path: "/api/not-exists" });
    assert.equal(response.status, 404);
    assert.equal(response.json.code, 1004);
    assert.equal(response.json.msg, "接口不存在");
    assert.equal(Number.isInteger(response.json.timestamp), true);
});

test("GET /api/gateway/config 返回环境、UI、网关与后端 HTTP 信息", async (t) => {
    const { port, http_backend } = await setup_http_gateway(t);
    const response = await http_request({ port, path: "/api/gateway/config" });
    assert.equal(response.status, 200);
    assert.equal(response.json.code, 0);
    assert.equal(response.json.msg, "success");
    const data = response.json.data;
    assert.equal(data.env, "sim");
    assert.equal(typeof data.ui, "object");
    assert.ok(Array.isArray(data.ui.categories));
    assert.equal(data.gateway.port, port);
    assert.equal(data.gateway.host, "127.0.0.1");
    assert.equal(data.gateway.ws_path, "/ws");
    assert.equal(data.backend.http.port, http_backend.port);
    assert.equal(data.backend.http.host, "127.0.0.1");
    assert.equal(Number.isInteger(response.json.timestamp), true);
});

test("GET /api/gateway/status 返回 TCP/后端在线状态与客户端数", async (t) => {
    const { port } = await setup_http_gateway(t);
    const response = await http_request({ port, path: "/api/gateway/status" });
    assert.equal(response.status, 200);
    assert.equal(response.json.code, 0);
    const data = response.json.data;
    assert.equal(data.tcp_connected, false);
    assert.equal(data.registered, false);
    assert.equal(data.backend_online, false);
    assert.equal(data.clients, 0);
    assert.ok(data.last_error === null || typeof data.last_error === "string");
    assert.deepEqual(Object.keys(data).sort(),
        ["backend_online", "clients", "last_error", "registered", "tcp_connected"]);
});

test("后端不可达时返回 503 与错误码 4000", async (t) => {
    const closed_port = await get_unused_port();
    const { port, gateway } = await setup_http_gateway(t, {
        start_backend: false,
        backend_http_port: closed_port,
        use_tcp_backend: true,
    });
    const response = await http_request({ port, path: "/api/health" });
    assert.equal(response.status, 503);
    assert.equal(response.json.code, 4000);
    assert.match(response.json.msg, /后端服务不可达/);
    assert.match(gateway.get_status_snapshot().last_error, /后端服务不可达/);
});

test("后端请求超时返回 504 与错误码 1002", async (t) => {
    const handler = (record) => (record.url === "/health" ? "hang" : make_backend_handler()(record));
    const { port } = await setup_http_gateway(t, {
        backend_handler: handler,
        gateway_overrides: { send_timeout_sec: 0.1 },
    });
    const started_at = Date.now();
    const response = await http_request({ port, path: "/api/health", timeout_ms: 3000 });
    assert.equal(response.status, 504);
    assert.equal(response.json.code, 1002);
    assert.match(response.json.msg, /后端请求超时/);
    assert.ok(Date.now() - started_at < 3000);
});

test("已知路径的方法不匹配时回退为 404", async (t) => {
    const { port } = await setup_http_gateway(t);
    const response = await http_request({ port, path: "/api/gateway/config", method: "POST", body: "{}" });
    assert.equal(response.status, 404);
    assert.equal(response.json.code, 1004);
});

test("POST /api/robot/plan 请求体超过上限返回 413", async (t) => {
    const { port, http_backend } = await setup_http_gateway(t);
    const oversized_body = JSON.stringify({ payload: "a".repeat(1048576 + 16) });
    const response = await http_request({
        port,
        path: "/api/robot/plan",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: oversized_body,
        timeout_ms: 5000,
    });
    assert.equal(response.status, 413);
    assert.equal(response.json.code, 1000);
    assert.equal(http_backend.requests.length, 0);
});

test("GET /api/system/mode 透传后端模式状态与查询串", async (t) => {
    const { port, http_backend } = await setup_http_gateway(t);
    const response = await http_request({ port, path: "/api/system/mode?detail=1" });
    assert.equal(response.status, 200);
    assert.equal(response.json.code, 0);
    assert.equal(response.json.data.mode, "sim");
    assert.deepEqual(response.json.data.available_modes, ["sim", "real"]);
    assert.equal(response.json.data.degraded, false);
    assert.equal(http_backend.requests.length, 1);
    assert.equal(http_backend.requests[0].method, "GET");
    assert.equal(http_backend.requests[0].url, "/system/mode?detail=1");
});

test("POST /api/system/mode 透传 JSON 请求体与后端 200 响应", async (t) => {
    const { port, http_backend } = await setup_http_gateway(t);
    const request_body = JSON.stringify({ mode: "real" });
    const response = await http_request({
        port,
        path: "/api/system/mode",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: request_body,
    });
    assert.equal(response.status, 200);
    assert.equal(response.json.code, 0);
    assert.equal(response.json.data.mode, "real");
    assert.equal(response.json.data.degraded, true);
    const record = http_backend.requests[0];
    assert.equal(record.method, "POST");
    assert.equal(record.url, "/system/mode");
    assert.equal(record.body, request_body);
    assert.match(record.headers["content-type"], /application\/json/);
});

test("POST /api/system/mode 非法 JSON 请求体返回 400 与 1001", async (t) => {
    const { port, http_backend } = await setup_http_gateway(t);
    const response = await http_request({
        port,
        path: "/api/system/mode",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json",
    });
    assert.equal(response.status, 400);
    assert.equal(response.json.code, 1001);
    assert.match(response.json.msg, /非法 JSON/);
    assert.equal(http_backend.requests.length, 0);
});

test("POST /api/system/mode 透传后端 422 参数错误", async (t) => {
    const handler = make_backend_handler({
        "/system/mode": { status_code: 422, body: { code: 1000, msg: "请求参数非法", data: {}, timestamp: 8 } },
    });
    const { port } = await setup_http_gateway(t, { backend_handler: handler });
    const response = await http_request({
        port,
        path: "/api/system/mode",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "hardware" }),
    });
    assert.equal(response.status, 422);
    assert.equal(response.json.code, 1000);
});

test("POST /api/system/mode 后端不可达返回 503 与 4000", async (t) => {
    const closed_port = await get_unused_port();
    const { port } = await setup_http_gateway(t, {
        start_backend: false,
        backend_http_port: closed_port,
        use_tcp_backend: true,
    });
    const response = await http_request({
        port,
        path: "/api/system/mode",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "sim" }),
    });
    assert.equal(response.status, 503);
    assert.equal(response.json.code, 4000);
    assert.match(response.json.msg, /后端服务不可达/);
});

