// 文件功能：前端网关入口与生命周期单元测试（参数解析、配置错误退出码、日志创建、启动/关闭、CLI --help）
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { ConfigError } from "../../../frontend/gateway/config_loader.mjs";
import {
    create_logger,
    load_and_validate_config,
    main,
    parse_args,
    resolve_repo_root,
    start_gateway,
} from "../../../frontend/gateway/main.mjs";
import {
    create_test_config,
    make_quiet_logger,
    make_tmp_dir,
    REPO_ROOT,
    remove_dir,
} from "./helpers.mjs";

// CLI 子进程最长等待时间（毫秒）
const CLI_TIMEOUT_MS = 30000;

/**
 * 写入临时 JSON 配置文件。
 *
 * 入参：file_path 文件路径；content 配置对象。
 * 返回：文件路径。
 */
function write_json_file(file_path, content) {
    fs.mkdirSync(path.dirname(file_path), { recursive: true });
    fs.writeFileSync(file_path, JSON.stringify(content, null, 4), "utf8");
    return file_path;
}

/**
 * 构造不带 env 字段的单文件合并配置。
 *
 * 入参：overrides 配置覆盖。
 * 返回：配置对象。
 */
function make_merged_config(overrides = {}) {
    const { config } = create_test_config({ gateway: { port: 0 }, ...overrides });
    delete config.env;
    return config;
}

test("resolve_repo_root 由入口模块地址推导仓库根", () => {
    assert.equal(resolve_repo_root(), REPO_ROOT);
});

test("parse_args 解析 --config 两种写法与 --help", () => {
    assert.deepEqual(parse_args([]), { config_file: null, help: false });
    assert.deepEqual(parse_args(["--config", "merged.json"]), { config_file: "merged.json", help: false });
    assert.deepEqual(parse_args(["--config=merged.json"]), { config_file: "merged.json", help: false });
    assert.deepEqual(parse_args(["-h"]), { config_file: null, help: true });
    assert.deepEqual(parse_args(["--help"]), { config_file: null, help: true });
});

test("parse_args 拒绝缺失值、重复指定与未知参数", () => {
    assert.throws(() => parse_args(["--config"]), ConfigError);
    assert.throws(() => parse_args(["--config="]), ConfigError);
    assert.throws(() => parse_args(["--config", "a.json", "--config", "b.json"]), /重复指定/);
    assert.throws(() => parse_args(["--unknown"]), /未知命令行参数/);
});

test("load_and_validate_config 默认 sim 环境并可通过环境变量切换", () => {
    const sim = load_and_validate_config({ argv: [], repo_root: REPO_ROOT, env_source: {} });
    assert.equal(sim.env, "sim");
    assert.equal(sim.config.gateway.port, 8080);
    assert.equal(sim.config.gateway.log_level, "INFO");
    assert.equal(sim.paths.static_dir, path.join(REPO_ROOT, "frontend", "dist"));
    const dev = load_and_validate_config({ argv: [], repo_root: REPO_ROOT, env_source: { VISRL_ENV: "dev" } });
    assert.equal(dev.env, "dev");
    assert.equal(dev.config.gateway.log_level, "DEBUG");
});

test("load_and_validate_config 支持 --config 单文件并标记 custom 环境", () => {
    const root = make_tmp_dir();
    try {
        const config_file = write_json_file(path.join(root, "merged.json"), make_merged_config());
        const loaded = load_and_validate_config({
            argv: ["--config", config_file],
            repo_root: REPO_ROOT,
            env_source: {},
        });
        assert.equal(loaded.env, "custom");
        assert.equal(loaded.config.gateway.port, 0);
    } finally {
        remove_dir(root);
    }
});

test("load_and_validate_config 对非法环境与非法字段抛出 ConfigError", () => {
    assert.throws(() => load_and_validate_config({
        argv: [],
        repo_root: REPO_ROOT,
        env_source: { VISRL_ENV: "prod" },
    }), /非法环境标识/);
    const root = make_tmp_dir();
    try {
        const bad_config = make_merged_config();
        bad_config.gateway.port = 70000;
        const config_file = write_json_file(path.join(root, "bad.json"), bad_config);
        assert.throws(() => load_and_validate_config({
            argv: ["--config", config_file],
            repo_root: REPO_ROOT,
            env_source: {},
        }), /gateway\.port/);
    } finally {
        remove_dir(root);
    }
});

test("create_logger 按配置创建可写日志文件", () => {
    const root = make_tmp_dir();
    try {
        const { config } = create_test_config({});
        const paths = { static_dir: path.join(root, "dist"), log_file: path.join(root, "logs", "gateway.log") };
        const logger = create_logger({ config, paths });
        assert.equal(logger.file_enabled, true);
        assert.equal(logger.file_path, paths.log_file);
        logger.info("入口日志测试");
        assert.match(fs.readFileSync(paths.log_file, "utf8"), /入口日志测试/);
    } finally {
        remove_dir(root);
    }
});

test("start_gateway 启动监听并可优雅关闭（重复 stop 安全）", async (t) => {
    const root = make_tmp_dir();
    const { config } = create_test_config({ gateway: { port: 0 }, backend: { tcp: { port: 1 } } });
    const paths = {
        static_dir: path.join(root, "dist"),
        log_file: path.join(root, "logs", "gateway.log"),
    };
    const logger = make_quiet_logger("gateway");
    const gateway = await start_gateway({ config, paths, repo_root: REPO_ROOT, logger });
    t.after(async () => {
        // 先关闭网关再删除临时目录，避免关闭日志时目录已不存在
        await gateway.stop().catch(() => {});
        remove_dir(root);
    });
    assert.equal(gateway.listen_address.port > 0, true);
    assert.equal(gateway.get_config_view().gateway.port, gateway.listen_address.port);
    assert.deepEqual(Object.keys(gateway.get_status_snapshot()).sort(),
        ["backend_online", "clients", "last_error", "registered", "tcp_connected"]);
    await gateway.stop();
    assert.equal(gateway.listen_address, null);
    await gateway.stop();
});

test("main --help 打印用法并返回 null", async () => {
    const result = await main(["--help"], { repo_root: REPO_ROOT, env_source: {} });
    assert.equal(result, null);
});

test("main 以 --config 启动网关并返回实例", async (t) => {
    const root = make_tmp_dir();
    const merged = make_merged_config({
        gateway: {
            port: 0,
            static_dir: path.join(root, "dist"),
            log_file: path.join(root, "logs", "gateway.log"),
            reconnect_intervals_sec: [0.1],
        },
        backend: { tcp: { port: 1 } },
    });
    const config_file = write_json_file(path.join(root, "merged.json"), merged);
    const result = await main(["--config", config_file], { repo_root: REPO_ROOT, env_source: {} });
    assert.ok(result !== null);
    t.after(async () => {
        // 先关闭网关再删除临时目录，避免关闭日志时目录已不存在
        await result.gateway.stop().catch(() => {});
        remove_dir(root);
    });
    assert.equal(result.gateway.config.env, "custom");
    assert.equal(result.gateway.listen_address.port > 0, true);
});

test("CLI 非法配置以退出码 1 结束并打印明确错误", () => {
    const root = make_tmp_dir();
    try {
        const bad_config = make_merged_config();
        bad_config.gateway.heartbeat_interval_sec = 0;
        const config_file = write_json_file(path.join(root, "bad.json"), bad_config);
        const result = spawnSync(process.execPath, [
            path.join(REPO_ROOT, "frontend", "gateway", "main.mjs"),
            "--config",
            config_file,
        ], { cwd: REPO_ROOT, encoding: "utf8", timeout: CLI_TIMEOUT_MS });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /heartbeat_interval_sec/);
        assert.match(result.stderr, /用法/);
    } finally {
        remove_dir(root);
    }
});

test("CLI 配置文件不存在或未知环境标识以退出码 1 结束", () => {
    const root = make_tmp_dir();
    try {
        const missing = spawnSync(process.execPath, [
            path.join(REPO_ROOT, "frontend", "gateway", "main.mjs"),
            "--config",
            path.join(root, "missing.json"),
        ], { cwd: REPO_ROOT, encoding: "utf8", timeout: CLI_TIMEOUT_MS });
        assert.equal(missing.status, 1);
        assert.match(missing.stderr, /不存在或不可读/);

        const bad_env = spawnSync(process.execPath, [
            path.join(REPO_ROOT, "frontend", "gateway", "main.mjs"),
        ], {
            cwd: REPO_ROOT,
            encoding: "utf8",
            timeout: CLI_TIMEOUT_MS,
            env: { ...process.env, VISRL_ENV: "prod" },
        });
        assert.equal(bad_env.status, 1);
        assert.match(bad_env.stderr, /非法环境标识/);
    } finally {
        remove_dir(root);
    }
});

test("CLI --help 以退出码 0 结束并打印用法", () => {
    const result = spawnSync(process.execPath, [
        path.join(REPO_ROOT, "frontend", "gateway", "main.mjs"),
        "--help",
    ], { cwd: REPO_ROOT, encoding: "utf8", timeout: CLI_TIMEOUT_MS });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /用法：node gateway\/main\.mjs/);
});
