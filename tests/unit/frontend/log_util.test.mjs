// 文件功能：前端网关日志工具单元测试（级别过滤、文件输出、1 MiB 轮转、不可写降级、子日志器共用文件）
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { Logger, normalize_level } from "../../../frontend/gateway/log_util.mjs";
import { make_tmp_dir, remove_dir } from "./helpers.mjs";

// 测试用日志轮转阈值（字节），远小于生产 1 MiB 以便快速触发轮转
const TEST_MAX_BYTES = 180;

/**
 * 读取日志文件全部内容。
 *
 * 入参：file_path 日志文件路径。
 * 返回：文件文本。
 */
function read_log(file_path) {
    return fs.readFileSync(file_path, "utf8");
}

test("normalize_level 规范化级别并拒绝非法值", () => {
    assert.equal(normalize_level("info"), "INFO");
    assert.equal(normalize_level("Warn"), "WARN");
    assert.throws(() => normalize_level("TRACE"), /非法日志级别/);
    assert.throws(() => normalize_level(undefined), /非法日志级别/);
});

test("日志级别过滤：INFO 级别不写 DEBUG，按序写入文件", () => {
    const root = make_tmp_dir();
    try {
        const log_file = path.join(root, "logs", "gateway.log");
        const logger = new Logger({ name: "gateway", level: "INFO", file_path: log_file, console_enabled: false });
        assert.equal(logger.file_enabled, true);
        logger.debug("调试信息");
        logger.info("测试信息");
        logger.warn("告警信息 %s", "w1");
        logger.error("错误信息");
        const lines = read_log(log_file).trim().split("\n");
        assert.equal(lines.length, 3);
        assert.match(lines[0], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \| INFO  \| gateway \| 测试信息$/);
        assert.match(lines[1], /WARN  \| gateway \| 告警信息 w1$/);
        assert.match(lines[2], /ERROR \| gateway \| 错误信息$/);
    } finally {
        remove_dir(root);
    }
});

test("ERROR 级别只输出错误日志", () => {
    const root = make_tmp_dir();
    try {
        const log_file = path.join(root, "gateway.log");
        const logger = new Logger({ name: "gateway", level: "error", file_path: log_file, console_enabled: false });
        assert.equal(logger.level_name, "ERROR");
        logger.info("info");
        logger.warn("warn");
        logger.error("error");
        const lines = read_log(log_file).trim().split("\n");
        assert.equal(lines.length, 1);
        assert.match(lines[0], /ERROR \| gateway \| error$/);
    } finally {
        remove_dir(root);
    }
});

test("child 子日志器共用文件写入器并保留各自模块名", () => {
    const root = make_tmp_dir();
    try {
        const log_file = path.join(root, "gateway.log");
        const logger = new Logger({ name: "gateway", level: "INFO", file_path: log_file, console_enabled: false });
        const child = logger.child("gateway.tcp");
        child.info("子模块日志");
        logger.info("父模块日志");
        const text = read_log(log_file);
        assert.match(text, /gateway\.tcp \| 子模块日志/);
        assert.match(text, /gateway \| 父模块日志/);
        assert.equal(child.file_path, logger.file_path);
    } finally {
        remove_dir(root);
    }
});

test("日志文件超过阈值时轮转并保留指定份数", () => {
    const root = make_tmp_dir();
    try {
        const log_file = path.join(root, "gateway.log");
        const logger = new Logger({
            name: "gateway",
            level: "INFO",
            file_path: log_file,
            console_enabled: false,
            max_bytes: TEST_MAX_BYTES,
            backup_count: 2,
        });
        for (let index = 0; index < 20; index += 1) {
            logger.info("轮转测试行 %d 填充内容填充内容", index);
        }
        assert.equal(fs.existsSync(log_file), true);
        assert.equal(fs.existsSync(`${log_file}.1`), true);
        assert.equal(fs.existsSync(`${log_file}.2`), true);
        assert.equal(fs.existsSync(`${log_file}.3`), false);
        const current_size = fs.statSync(log_file).size;
        assert.ok(current_size <= TEST_MAX_BYTES + 200, `当前日志文件大小应接近阈值：${current_size}`);
    } finally {
        remove_dir(root);
    }
});

test("日志目录不可写时降级为仅控制台且不抛异常", () => {
    const root = make_tmp_dir();
    try {
        // 用普通文件占位目录路径，制造目录不可写场景
        const blocked_path = path.join(root, "blocked");
        fs.writeFileSync(blocked_path, "not a directory", "utf8");
        const log_file = path.join(blocked_path, "gateway.log");
        const logger = new Logger({ name: "gateway", level: "INFO", file_path: log_file, console_enabled: false });
        assert.equal(logger.file_enabled, false);
        assert.equal(logger.file_path, log_file);
        assert.doesNotThrow(() => {
            logger.info("降级日志");
            logger.error("降级错误");
        });
    } finally {
        remove_dir(root);
    }
});

test("未配置文件路径时仅输出控制台且 file_path 为 null", () => {
    const logger = new Logger({ name: "gateway", level: "INFO", console_enabled: false });
    assert.equal(logger.file_path, null);
    assert.equal(logger.file_enabled, false);
    assert.doesNotThrow(() => logger.info("仅控制台"));
});
