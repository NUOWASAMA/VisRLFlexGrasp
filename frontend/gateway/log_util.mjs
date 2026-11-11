// 文件功能：前端网关日志工具，统一四级日志（DEBUG/INFO/WARN/ERROR）控制台输出与日志文件轮转（1 MiB × 3 份）
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11

import fs from "node:fs";
import path from "node:path";
import { format } from "node:util";

import {
    LOG_BACKUP_COUNT,
    LOG_LEVEL,
    LOG_LEVEL_NAMES,
    LOG_MAX_BYTES,
    VALID_LOG_LEVELS,
} from "./constants.mjs";

// 日志字段分隔符与时间格式（与 common/log_util.py 对齐：时间 | 级别 | 模块名 | 内容）
const LOG_FIELD_SEPARATOR = " | ";
const LEVEL_NAME_PADDING = 5;
const TIME_PAD_WIDTH = 2;
const MS_PER_SECOND = 1000;

/**
 * 将日志级别名称规范化为大写，并校验合法性。
 *
 * 入参：level 级别名称（大小写不敏感）。
 * 返回：规范化为大写的级别名称。
 * 异常：级别非法时抛出 Error，由配置校验阶段转换为明确错误。
 */
export function normalize_level(level) {
    const normalized = typeof level === "string" ? level.toUpperCase() : "";
    if (!VALID_LOG_LEVELS.includes(normalized)) {
        throw new Error(`非法日志级别 ${level}，允许取值：${VALID_LOG_LEVELS.join("/")}`);
    }
    return normalized;
}

/**
 * 将日期格式化为本地时间字符串 YYYY-MM-DD HH:mm:ss。
 *
 * 入参：date 日期对象。
 * 返回：格式化后的时间字符串。
 */
function format_time(date) {
    const pad = (value) => String(value).padStart(TIME_PAD_WIDTH, "0");
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    return `${day} ${clock}`;
}

/**
 * 日志文件写入器：负责目录创建、1 MiB 轮转与保留三份历史文件；任何文件错误降级为仅控制台。
 */
class FileSink {
    /**
     * 构造文件写入器。
     *
     * 入参：file_path 日志文件绝对路径；max_bytes 单文件上限；backup_count 历史备份份数。
     */
    constructor(file_path, max_bytes = LOG_MAX_BYTES, backup_count = LOG_BACKUP_COUNT) {
        this._file_path = file_path;
        this._max_bytes = max_bytes;
        this._backup_count = backup_count;
        this._current_size = 0;
        this._disabled = false;
        this._disabled_reason = "";
        this._prepare();
    }

    /** 日志文件绝对路径 */
    get file_path() {
        return this._file_path;
    }

    /** 是否仍可写文件；目录不可写时降级为 false */
    get enabled() {
        return !this._disabled;
    }

    /** 降级原因，便于日志中提示用户 */
    get disabled_reason() {
        return this._disabled_reason;
    }

    /**
     * 初始化日志目录并读取当前文件大小；文件尚不存在属正常情况。
     *
     * 异常：目录创建或文件读取失败时内部捕获并降级为仅控制台。
     */
    _prepare() {
        try {
            fs.mkdirSync(path.dirname(this._file_path), { recursive: true });
        } catch (error) {
            this._disable(`日志目录不可写：${error.message}`);
            return;
        }
        try {
            this._current_size = fs.statSync(this._file_path).size;
        } catch (error) {
            if (error.code === "ENOENT") {
                this._current_size = 0;
                return;
            }
            this._disable(`日志文件不可读：${error.message}`);
        }
    }

    /**
     * 标记文件写入不可用，仅输出一次降级提示。
     *
     * 入参：reason 降级原因。
     */
    _disable(reason) {
        this._disabled = true;
        this._disabled_reason = reason;
    }

    /**
     * 写入一行日志；超过单文件上限时先轮转。
     *
     * 入参：line 日志文本（不含换行符，内部补 \n，按字节计算）。
     * 返回：写入成功返回 true；文件不可用返回 false，由调用方降级为仅控制台。
     */
    write(line) {
        if (this._disabled) {
            return false;
        }
        const bytes = Buffer.byteLength(line, "utf8") + 1;
        try {
            if (this._current_size + bytes > this._max_bytes) {
                this._rotate();
            }
            fs.appendFileSync(this._file_path, `${line}\n`, "utf8");
            this._current_size += bytes;
            return true;
        } catch (error) {
            this._disable(`日志文件写入失败：${error.message}`);
            return false;
        }
    }

    /**
     * 轮转日志文件：file -> file.1 -> ... -> file.N，超出备份份数的历史文件被删除。
     *
     * 异常：重命名或删除失败时抛出，由 write 捕获并降级。
     */
    _rotate() {
        for (let index = this._backup_count - 1; index >= 1; index -= 1) {
            const source = `${this._file_path}.${index}`;
            const target = `${this._file_path}.${index + 1}`;
            if (fs.existsSync(source)) {
                fs.renameSync(source, target);
            }
        }
        if (fs.existsSync(this._file_path)) {
            fs.renameSync(this._file_path, `${this._file_path}.1`);
        }
        fs.writeFileSync(this._file_path, "", "utf8");
        this._current_size = 0;
    }
}

/**
 * 前端网关日志器：控制台与轮转文件双输出，支持子模块命名与 printf 风格参数。
 */
export class Logger {
    /**
     * 构造日志器。
     *
     * 入参：name 模块名；level 日志级别；file_path 日志文件绝对路径（null 表示仅控制台）；
     *      max_bytes 单文件上限；backup_count 历史备份份数；console_enabled 是否输出控制台；
     *      _sink 内部参数，复用父日志器的文件写入器。
     */
    constructor({
        name = "gateway",
        level = "INFO",
        file_path = null,
        max_bytes = LOG_MAX_BYTES,
        backup_count = LOG_BACKUP_COUNT,
        console_enabled = true,
        _sink = null,
    } = {}) {
        this._name = name;
        this._level = LOG_LEVEL[normalize_level(level)];
        this._level_name = normalize_level(level);
        this._console_enabled = console_enabled;
        this._sink = _sink ?? (file_path ? new FileSink(file_path, max_bytes, backup_count) : null);
        this._degrade_reported = false;
    }

    /** 日志器名称 */
    get name() {
        return this._name;
    }

    /** 当前日志级别名称 */
    get level_name() {
        return this._level_name;
    }

    /** 是否仍在写日志文件 */
    get file_enabled() {
        return this._sink !== null && this._sink.enabled;
    }

    /** 日志文件绝对路径（未配置时为 null） */
    get file_path() {
        return this._sink === null ? null : this._sink.file_path;
    }

    /**
     * 创建同配置的子日志器（共用文件写入器，避免多实例并发轮转）。
     *
     * 入参：name 子模块名。
     * 返回：新的 Logger 实例。
     */
    child(name) {
        return new Logger({
            name,
            level: this._level_name,
            console_enabled: this._console_enabled,
            _sink: this._sink,
        });
    }

    /**
     * 判断指定级别是否达到输出阈值。
     *
     * 入参：level 级别数值。
     * 返回：需要输出返回 true。
     */
    _need_output(level) {
        return level >= this._level;
    }

    /**
     * 组装并输出一行日志。
     *
     * 入参：level 级别数值；message 文本或 printf 格式串；args 格式化参数。
     * 返回：无。
     */
    _log(level, message, args) {
        if (!this._need_output(level)) {
            return;
        }
        const level_name = LOG_LEVEL_NAMES[level];
        const text = args.length > 0 ? format(message, ...args) : String(message);
        const line = `${format_time(new Date())}${LOG_FIELD_SEPARATOR}`
            + `${level_name.padEnd(LEVEL_NAME_PADDING)}${LOG_FIELD_SEPARATOR}`
            + `${this._name}${LOG_FIELD_SEPARATOR}${text}`;
        if (this._console_enabled) {
            process.stdout.write(`${line}\n`);
        }
        if (this._sink !== null && !this._sink.write(line) && !this._degrade_reported) {
            // 文件首次写入失败时仅在控制台提示一次，避免日志降级后反复报错。
            this._degrade_reported = true;
            if (this._console_enabled) {
                process.stdout.write(`${format_time(new Date())} | WARN  | ${this._name} | `
                    + `日志文件不可用，已降级为仅控制台：${this._sink.disabled_reason}\n`);
            }
        }
    }

    /**
     * 输出 DEBUG 日志。
     *
     * 入参：message 文本或 printf 格式串；args 格式化参数。
     * 返回：无。
     */
    debug(message, ...args) {
        this._log(LOG_LEVEL.DEBUG, message, args);
    }

    /**
     * 输出 INFO 日志。
     *
     * 入参：message 文本或 printf 格式串；args 格式化参数。
     * 返回：无。
     */
    info(message, ...args) {
        this._log(LOG_LEVEL.INFO, message, args);
    }

    /**
     * 输出 WARN 日志。
     *
     * 入参：message 文本或 printf 格式串；args 格式化参数。
     * 返回：无。
     */
    warn(message, ...args) {
        this._log(LOG_LEVEL.WARN, message, args);
    }

    /**
     * 输出 ERROR 日志。
     *
     * 入参：message 文本或 printf 格式串；args 格式化参数。
     * 返回：无。
     */
    error(message, ...args) {
        this._log(LOG_LEVEL.ERROR, message, args);
    }
}
