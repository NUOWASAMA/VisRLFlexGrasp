// 文件功能：前端网关配置加载与校验单元测试（分级合并、--config 单文件、环境变量与非法配置拒绝）
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
    ConfigError,
    deep_merge,
    get_current_env,
    load_config,
    resolve_runtime_paths,
    validate_config,
} from "../../../frontend/gateway/config_loader.mjs";
import { make_tmp_dir, remove_dir, REPO_ROOT } from "./helpers.mjs";

/**
 * 在临时仓库目录中写入 JSON 配置。
 *
 * 入参：root 临时仓库根；relative_path 相对仓库根的配置文件路径；content 配置内容。
 * 返回：配置文件绝对路径。
 */
function write_config(root, relative_path, content) {
    const file_path = path.join(root, relative_path);
    fs.mkdirSync(path.dirname(file_path), { recursive: true });
    fs.writeFileSync(file_path, JSON.stringify(content), "utf8");
    return file_path;
}

/**
 * 构造最小可用前端网关配置（供校验用例按字段破坏）。
 *
 * 返回：合法配置对象。
 */
function make_valid_config() {
    return {
        env: "sim",
        gateway: {
            host: "127.0.0.1",
            port: 8080,
            ws_path: "/ws",
            api_prefix: "/api",
            static_dir: "frontend/dist",
            max_frame_bytes: 1048576,
            heartbeat_interval_sec: 3,
            heartbeat_timeout_sec: 10,
            reconnect_intervals_sec: [1, 3, 5],
            send_timeout_sec: 3,
            log_level: "INFO",
            log_file: "logs/frontend/gateway.log",
        },
        backend: {
            http: { host: "127.0.0.1", port: 8000 },
            tcp: { host: "127.0.0.1", port: 9000 },
        },
        ui: { poll_interval_ms: 2000 },
    };
}

test("get_current_env 支持显式取值、环境变量与缺省 sim", () => {
    assert.equal(get_current_env("dev", {}), "dev");
    assert.equal(get_current_env(undefined, { VISRL_ENV: "real" }), "real");
    assert.equal(get_current_env(undefined, {}), "sim");
    assert.throws(() => get_current_env("prod", {}), ConfigError);
    assert.throws(() => get_current_env(undefined, { VISRL_ENV: "production" }), /非法环境标识 production/);
    assert.throws(() => get_current_env(undefined, { VISRL_ENV: "" }), ConfigError);
});

test("load_config 从仓库 frontend/config 分级加载 sim", () => {
    const { config, env } = load_config({ repo_root: REPO_ROOT, env_value: "sim" });
    assert.equal(env, "sim");
    assert.equal(config.env, "sim");
    assert.equal(config.gateway.port, 8080);
    assert.equal(config.gateway.ws_path, "/ws");
    assert.equal(config.backend.http.port, 8000);
    assert.equal(config.backend.tcp.port, 9000);
    assert.ok(Array.isArray(config.ui.categories));
});

test("load_config 环境覆盖深度合并 base", () => {
    const loaded = load_config({ repo_root: REPO_ROOT, env_value: "dev" });
    assert.equal(loaded.config.gateway.log_level, "DEBUG");
    assert.equal(loaded.config.ui.poll_interval_ms, 1000);
    // 未覆盖的 base 字段保留
    assert.equal(loaded.config.gateway.port, 8080);
    assert.deepEqual(loaded.config.gateway.reconnect_intervals_sec, [1, 3, 5]);
});

test("load_config 支持 VISRL_ENV 环境变量与临时仓库配置目录", () => {
    const root = make_tmp_dir();
    try {
        write_config(root, "frontend/config/base.json", {
            gateway: { host: "127.0.0.1", port: 8080, reconnect_intervals_sec: [1, 3, 5] },
            backend: { http: { host: "127.0.0.1", port: 8000 } },
        });
        write_config(root, "frontend/config/sim.json", { gateway: { port: 18080 } });
        const loaded = load_config({ repo_root: root, env_source: { VISRL_ENV: "sim" } });
        assert.equal(loaded.env, "sim");
        assert.equal(loaded.config.gateway.port, 18080);
        assert.deepEqual(loaded.config.gateway.reconnect_intervals_sec, [1, 3, 5]);
        // 数组整体替换而非按元素合并
        write_config(root, "frontend/config/dev.json", { gateway: { reconnect_intervals_sec: [0.1] } });
        const dev = load_config({ repo_root: root, env_value: "dev" });
        assert.deepEqual(dev.config.gateway.reconnect_intervals_sec, [0.1]);
    } finally {
        remove_dir(root);
    }
});

test("load_config base.json 缺失或 JSON 非法时抛 ConfigError", () => {
    const root = make_tmp_dir();
    try {
        assert.throws(() => load_config({ repo_root: root, env_value: "sim" }), ConfigError);
        write_config(root, "frontend/config/base.json", { gateway: {} });
        assert.equal(load_config({ repo_root: root, env_value: "sim" }).config.gateway.port, undefined);
        fs.writeFileSync(path.join(root, "frontend/config/base.json"), "{invalid json", "utf8");
        assert.throws(() => load_config({ repo_root: root, env_value: "sim" }), /解析失败/);
        assert.throws(() => load_config({ repo_root: "", env_value: "sim" }), ConfigError);
    } finally {
        remove_dir(root);
    }
});

test("load_config --config 单文件模式读取 env 字段或标记 custom", () => {
    const root = make_tmp_dir();
    try {
        const with_env = write_config(root, "merged.json", { ...make_valid_config(), env: "real" });
        const loaded = load_config({ repo_root: REPO_ROOT, config_file: with_env });
        assert.equal(loaded.env, "real");
        assert.equal(loaded.config.env, "real");
        const without_env = write_config(root, "no_env.json", make_valid_config());
        fs.writeFileSync(without_env, JSON.stringify((() => {
            const config = make_valid_config();
            delete config.env;
            return config;
        })()), "utf8");
        const custom = load_config({ repo_root: REPO_ROOT, config_file: without_env });
        assert.equal(custom.env, "custom");
        assert.throws(() => load_config({ repo_root: REPO_ROOT, config_file: path.join(root, "missing.json") }),
            ConfigError);
        fs.writeFileSync(path.join(root, "broken.json"), "not-json", "utf8");
        assert.throws(() => load_config({ repo_root: REPO_ROOT, config_file: path.join(root, "broken.json") }),
            /解析失败/);
    } finally {
        remove_dir(root);
    }
});

test("deep_merge 递归覆盖对象、整体替换数组且不修改入参", () => {
    const base = { gateway: { a: 1, b: 2, list: [1, 2, 3] }, other: "x" };
    const merged = deep_merge(base, { gateway: { b: 20, list: [9] } });
    assert.deepEqual(merged, { gateway: { a: 1, b: 20, list: [9] }, other: "x" });
    assert.deepEqual(base.gateway.list, [1, 2, 3]);
});

test("validate_config 通过仓库真实配置并解析绝对路径", () => {
    const { config, paths } = validate_config(make_valid_config(), { repo_root: REPO_ROOT });
    assert.equal(config.env, "sim");
    assert.equal(paths.static_dir, path.join(REPO_ROOT, "frontend", "dist"));
    assert.equal(paths.log_file, path.join(REPO_ROOT, "logs", "frontend", "gateway.log"));
    assert.equal(config.gateway.log_level, "INFO");
});

test("validate_config 缺少 ui 时补空对象、env 缺失标记 custom", () => {
    const config = make_valid_config();
    delete config.ui;
    delete config.env;
    const validated = validate_config(config, { repo_root: REPO_ROOT });
    assert.deepEqual(validated.config.ui, {});
    assert.equal(validated.config.env, "custom");
});

test("validate_config 拒绝非法监听地址、端口与间隔", () => {
    const cases = [
        [{ gateway: { host: "" } }, /gateway\.host/],
        [{ gateway: { port: 70000 } }, /gateway\.port/],
        [{ gateway: { port: "8080" } }, /gateway\.port/],
        [{ backend: { http: { host: "" } } }, /backend\.http\.host/],
        [{ backend: { tcp: { port: -1 } } }, /backend\.tcp\.port/],
        [{ gateway: { heartbeat_interval_sec: 0 } }, /heartbeat_interval_sec/],
        [{ gateway: { heartbeat_timeout_sec: -1 } }, /heartbeat_timeout_sec/],
        [{ gateway: { send_timeout_sec: 0 } }, /send_timeout_sec/],
        [{ gateway: { reconnect_intervals_sec: [] } }, /reconnect_intervals_sec/],
        [{ gateway: { reconnect_intervals_sec: [1, 0] } }, /reconnect_intervals_sec/],
        [{ gateway: { max_frame_bytes: 0 } }, /max_frame_bytes/],
        [{ gateway: { max_frame_bytes: 1.5 } }, /max_frame_bytes/],
    ];
    for (const [override, expected] of cases) {
        assert.throws(() => validate_config(deep_merge(make_valid_config(), override), {
            repo_root: REPO_ROOT,
        }), expected);
    }
});

test("validate_config 拒绝非法日志级别、路径前缀与 ui 类型", () => {
    const cases = [
        [{ gateway: { log_level: "TRACE" } }, /log_level/],
        [{ gateway: { log_level: "" } }, /log_level/],
        [{ gateway: { ws_path: "ws" } }, /ws_path/],
        [{ gateway: { api_prefix: "api" } }, /api_prefix/],
        [{ gateway: { static_dir: "" } }, /static_dir/],
        [{ gateway: { log_file: "" } }, /log_file/],
        [{ ui: [] }, /ui/],
        [{ gateway: null }, /gateway/],
    ];
    for (const [override, expected] of cases) {
        assert.throws(() => validate_config(deep_merge(make_valid_config(), override), {
            repo_root: REPO_ROOT,
        }), expected);
    }
});

test("validate_config 规范化路径与日志级别，并保留绝对路径", () => {
    const config = make_valid_config();
    config.gateway.ws_path = "/ws/";
    config.gateway.api_prefix = "/api/";
    config.gateway.log_level = "warn";
    config.gateway.static_dir = path.join(REPO_ROOT, "frontend", "dist");
    const validated = validate_config(config, { repo_root: REPO_ROOT });
    assert.equal(validated.config.gateway.ws_path, "/ws");
    assert.equal(validated.config.gateway.api_prefix, "/api");
    assert.equal(validated.config.gateway.log_level, "WARN");
    assert.equal(validated.paths.static_dir, path.join(REPO_ROOT, "frontend", "dist"));
});

test("resolve_runtime_paths 按仓库根解析相对路径", () => {
    const { config } = validate_config(make_valid_config(), { repo_root: REPO_ROOT });
    const paths = resolve_runtime_paths(config, REPO_ROOT);
    assert.equal(paths.static_dir, path.join(REPO_ROOT, "frontend", "dist"));
    assert.equal(paths.log_file, path.join(REPO_ROOT, "logs", "frontend", "gateway.log"));
});
