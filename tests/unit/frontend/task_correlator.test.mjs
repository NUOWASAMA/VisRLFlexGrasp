// 文件功能：task_start 关联窗口单元测试（登记/命中/唯一兜底/客户端清理/TTL 到期）
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11

import assert from "node:assert/strict";
import { test } from "node:test";

import { TaskStartCorrelator } from "../../../frontend/gateway/task_correlator.mjs";
import { delay, wait_for } from "./helpers.mjs";

// 测试用短窗口时长（毫秒），避免等待生产配置的 10 秒
const TEST_TTL_MS = 60;

test("登记后可命中并按 task_id 取出，重复登记替换旧项", () => {
    const correlator = new TaskStartCorrelator({ ttl_ms: TEST_TTL_MS });
    correlator.add({ task_id: "t1", request_id: "r1", client_id: "client-1" });
    assert.equal(correlator.size, 1);
    correlator.add({ task_id: "t1", request_id: "r2", client_id: "client-2" });
    assert.equal(correlator.size, 1);
    const entry = correlator.take_by_task_id("t1");
    assert.equal(entry.request_id, "r2");
    assert.equal(entry.client_id, "client-2");
    assert.equal(correlator.size, 0);
    assert.equal(correlator.take_by_task_id("t1"), null);
});

test("remove 命中返回关联项，未命中返回 null", () => {
    const correlator = new TaskStartCorrelator({ ttl_ms: TEST_TTL_MS });
    correlator.add({ task_id: "t1", request_id: "r1", client_id: "client-1" });
    assert.equal(correlator.remove("t1").request_id, "r1");
    assert.equal(correlator.remove("t1"), null);
});

test("take_single 仅在恰好一条 pending 时返回", () => {
    const correlator = new TaskStartCorrelator({ ttl_ms: TEST_TTL_MS });
    assert.equal(correlator.take_single(), null);
    correlator.add({ task_id: "t1", request_id: "r1", client_id: "client-1" });
    assert.equal(correlator.take_single().task_id, "t1");
    assert.equal(correlator.size, 0);
    correlator.add({ task_id: "t1", request_id: "r1", client_id: "client-1" });
    correlator.add({ task_id: "t2", request_id: "r2", client_id: "client-2" });
    assert.equal(correlator.take_single(), null);
    assert.equal(correlator.size, 2);
});

test("clear_client 只清理指定客户端名下的关联项", () => {
    const correlator = new TaskStartCorrelator({ ttl_ms: TEST_TTL_MS });
    correlator.add({ task_id: "t1", request_id: "r1", client_id: "client-1" });
    correlator.add({ task_id: "t2", request_id: "r2", client_id: "client-1" });
    correlator.add({ task_id: "t3", request_id: "r3", client_id: "client-2" });
    assert.equal(correlator.clear_client("client-1"), 2);
    assert.equal(correlator.size, 1);
    assert.equal(correlator.take_by_task_id("t3").request_id, "r3");
});

test("clear_all 清空全部关联项", () => {
    const correlator = new TaskStartCorrelator({ ttl_ms: TEST_TTL_MS });
    correlator.add({ task_id: "t1", request_id: "r1", client_id: "client-1" });
    correlator.add({ task_id: "t2", request_id: "r2", client_id: "client-2" });
    correlator.clear_all();
    assert.equal(correlator.size, 0);
});

test("超过 TTL 未命中的关联项自动过期清理", async () => {
    const correlator = new TaskStartCorrelator({ ttl_ms: TEST_TTL_MS });
    correlator.add({ task_id: "t1", request_id: "r1", client_id: "client-1" });
    assert.equal(correlator.size, 1);
    await wait_for(() => correlator.size === 0, { timeout_ms: 1000, label: "关联窗口自动过期" });
    await delay(10);
    assert.equal(correlator.take_by_task_id("t1"), null);
});
