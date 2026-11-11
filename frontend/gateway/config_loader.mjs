// 文件功能：前端网关分级配置加载与校验，支持 --config 单文件合并配置与 VISRL_ENV 分级合并 base.json
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11

import fs from "node:fs";
import path from "node:path";

import {
    BASE_CONFIG_NAME,
    CUSTOM_ENV,
    DEFAULT_ENV,
    ENV_VAR_NAME,
    MAX_PORT,
    MIN_PORT,
    VALID_ENVS,
    VALID_LOG_LEVELS,
} from "./constants.mjs";

// 前端配置目录相对仓库根的路径
const FRONTEND_CONFIG_DIR = "frontend/config";

/**
 * 配置加载或校验失败错误，入口捕获后打印明确提示并以 exit(1) 结束。
 */
export class ConfigError extends Error {
    /**
     * 构造配置错误。
     *
     * 入参：message 错误描述。
     */
    constructor(message) {
        super(message);
        this.name = "ConfigError";
    }
}

/**
 * 判断是否为普通对象（排除 null 与数组），用于配置结构校验。
 *
 * 入参：value 待判断值。
 * 返回：普通对象返回 true。
 */
function is_plain_object(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 读取当前运行环境标识。
 *
 * 入参：env_value 显式环境标识（优先）；env_source 环境变量来源，默认 process.env。
 * 返回：dev / sim / real 之一，未设置时取缺省 sim。
 * 异常：环境标识非法时抛出 ConfigError。
 */
export function get_current_env(env_value = undefined, env_source = process.env) {
    let env;
    if (env_value !== undefined && env_value !== null) {
        env = String(env_value);
    } else {
        const from_source = env_source ? env_source[ENV_VAR_NAME] : undefined;
        env = from_source === undefined || from_source === null ? DEFAULT_ENV : String(from_source);
    }
    if (!VALID_ENVS.includes(env)) {
        throw new ConfigError(`非法环境标识 ${env}，允许取值：${VALID_ENVS.join("/")}`);
    }
    return env;
}

/**
 * 递归合并两个配置对象，override 优先，仅嵌套对象逐键覆盖，数组整体替换。
 *
 * 入参：base 基础配置；override 覆盖配置。
 * 返回：合并后的新对象，不修改入参。
 */
export function deep_merge(base, override) {
    const merged = { ...base };
    for (const [key, value] of Object.entries(override)) {
        if (is_plain_object(merged[key]) && is_plain_object(value)) {
            merged[key] = deep_merge(merged[key], value);
        } else {
            merged[key] = value;
        }
    }
    return merged;
}

/**
 * 读取并解析 JSON 配置文件。
 *
 * 入参：file_path 配置文件绝对路径；label 配置描述，用于错误提示。
 * 返回：解析后的 JSON 对象。
 * 异常：文件不存在、读取失败、JSON 非法或根节点非对象时抛出 ConfigError。
 */
function read_json_file(file_path, label) {
    let text;
    try {
        text = fs.readFileSync(file_path, "utf8");
    } catch (error) {
        throw new ConfigError(`${label}不存在或不可读：${file_path}（${error.message}）`);
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new ConfigError(`${label} JSON 解析失败：${file_path}（${error.message}）`);
    }
    if (!is_plain_object(parsed)) {
        throw new ConfigError(`${label}根节点必须为 JSON 对象：${file_path}`);
    }
    return parsed;
}

/**
 * 加载分级配置：base.json 与选定环境配置深度合并；或直接加载 --config 指定的单文件合并配置。
 *
 * 入参：repo_root 仓库根绝对路径；config_file 单文件配置路径（null 表示分级加载）；
 *      env_value 显式环境标识；env_source 环境变量来源。
 * 返回：{config, env}，config.env 已写入生效环境。
 * 异常：配置缺失、JSON 非法或环境标识非法时抛出 ConfigError。
 */
export function load_config({
    repo_root,
    config_file = null,
    env_value = undefined,
    env_source = process.env,
} = {}) {
    if (typeof repo_root !== "string" || !repo_root) {
        throw new ConfigError("仓库根目录不得为空，无法加载前端网关配置");
    }
    if (config_file) {
        const config_path = path.resolve(config_file);
        const config = read_json_file(config_path, "单文件合并配置");
        const env = typeof config.env === "string" && config.env ? config.env : CUSTOM_ENV;
        config.env = env;
        return { config, env };
    }
    const env = get_current_env(env_value, env_source);
    const config_dir = path.join(repo_root, FRONTEND_CONFIG_DIR);
    const base_path = path.join(config_dir, BASE_CONFIG_NAME);
    const base = read_json_file(base_path, "基础配置文件");
    const env_path = path.join(config_dir, `${env}.json`);
    const config = fs.existsSync(env_path)
        ? deep_merge(base, read_json_file(env_path, `${env} 环境配置文件`))
        : base;
    config.env = env;
    return { config, env };
}

/**
 * 读取并校验配置项为普通对象。
 *
 * 入参：value 配置值；key 配置项路径，用于错误提示。
 * 返回：该普通对象。
 * 异常：非普通对象时抛出 ConfigError。
 */
function require_object(value, key) {
    if (!is_plain_object(value)) {
        throw new ConfigError(`配置项 ${key} 必须为 JSON 对象`);
    }
    return value;
}

/**
 * 读取并校验配置项为非空字符串。
 *
 * 入参：value 配置值；key 配置项路径，用于错误提示。
 * 返回：去首尾空白后的字符串。
 * 异常：非字符串或空串时抛出 ConfigError。
 */
function require_non_empty_string(value, key) {
    if (typeof value !== "string" || !value.trim()) {
        throw new ConfigError(`配置项 ${key} 不能为空`);
    }
    return value.trim();
}

/**
 * 读取并校验配置项为 0-65535 的整数端口。
 *
 * 入参：value 配置值；key 配置项路径，用于错误提示。
 * 返回：该端口整数。
 * 异常：非整数或越界时抛出 ConfigError。
 */
function require_port(value, key) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < MIN_PORT || value > MAX_PORT) {
        throw new ConfigError(`配置项 ${key} 必须为 ${MIN_PORT}-${MAX_PORT} 的整数端口`);
    }
    return value;
}

/**
 * 读取并校验配置项为有限正数（秒）。
 *
 * 入参：value 配置值；key 配置项路径，用于错误提示。
 * 返回：该数值。
 * 异常：非有限正数时抛出 ConfigError。
 */
function require_positive_number(value, key) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        throw new ConfigError(`配置项 ${key} 必须为正数`);
    }
    return value;
}

/**
 * 读取并校验配置项为正整数。
 *
 * 入参：value 配置值；key 配置项路径，用于错误提示。
 * 返回：该整数。
 * 异常：非正整数时抛出 ConfigError。
 */
function require_positive_integer(value, key) {
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
        throw new ConfigError(`配置项 ${key} 必须为正整数`);
    }
    return value;
}

/**
 * 解析配置中的资源路径：相对路径按仓库根拼接，绝对路径仅用于测试注入。
 *
 * 入参：repo_root 仓库根绝对路径；value 配置字符串。
 * 返回：规范化后的绝对路径。
 */
function resolve_config_path(repo_root, value) {
    return path.isAbsolute(value) ? path.normalize(value) : path.resolve(repo_root, value);
}

/**
 * 校验启动前网关配置，非法配置抛出带明确字段位置的 ConfigError。
 *
 * 入参：config 加载后的配置对象；repo_root 仓库根绝对路径。
 * 返回：{config, paths}，config 为规范化后的深拷贝，paths 为解析后的静态目录与日志文件绝对路径。
 * 异常：任一配置项非法时抛出 ConfigError。
 */
export function validate_config(config, { repo_root } = {}) {
    if (typeof repo_root !== "string" || !repo_root) {
        throw new ConfigError("仓库根目录不得为空，无法解析配置路径");
    }
    if (!is_plain_object(config)) {
        throw new ConfigError("配置根节点必须为 JSON 对象");
    }
    const normalized = structuredClone(config);
    const gateway = require_object(normalized.gateway, "gateway");
    gateway.host = require_non_empty_string(gateway.host, "gateway.host");
    gateway.port = require_port(gateway.port, "gateway.port");
    gateway.ws_path = require_non_empty_string(gateway.ws_path, "gateway.ws_path");
    if (!gateway.ws_path.startsWith("/")) {
        throw new ConfigError("配置项 gateway.ws_path 必须以 / 开头");
    }
    gateway.ws_path = gateway.ws_path.replace(/\/+$/, "");
    if (!gateway.ws_path) {
        throw new ConfigError("配置项 gateway.ws_path 不能为 /");
    }
    gateway.api_prefix = require_non_empty_string(gateway.api_prefix, "gateway.api_prefix");
    if (!gateway.api_prefix.startsWith("/")) {
        throw new ConfigError("配置项 gateway.api_prefix 必须以 / 开头");
    }
    gateway.api_prefix = gateway.api_prefix.replace(/\/+$/, "");
    if (!gateway.api_prefix) {
        throw new ConfigError("配置项 gateway.api_prefix 不能为 /");
    }
    gateway.static_dir = require_non_empty_string(gateway.static_dir, "gateway.static_dir");
    gateway.max_frame_bytes = require_positive_integer(gateway.max_frame_bytes, "gateway.max_frame_bytes");
    gateway.heartbeat_interval_sec = require_positive_number(
        gateway.heartbeat_interval_sec, "gateway.heartbeat_interval_sec");
    gateway.heartbeat_timeout_sec = require_positive_number(
        gateway.heartbeat_timeout_sec, "gateway.heartbeat_timeout_sec");
    gateway.send_timeout_sec = require_positive_number(gateway.send_timeout_sec, "gateway.send_timeout_sec");
    if (!Array.isArray(gateway.reconnect_intervals_sec) || gateway.reconnect_intervals_sec.length === 0) {
        throw new ConfigError("配置项 gateway.reconnect_intervals_sec 必须为非空数组");
    }
    gateway.reconnect_intervals_sec = gateway.reconnect_intervals_sec.map((value, index) => require_positive_number(
        value, `gateway.reconnect_intervals_sec[${index}]`));
    const log_level = require_non_empty_string(gateway.log_level, "gateway.log_level").toUpperCase();
    if (!VALID_LOG_LEVELS.includes(log_level)) {
        throw new ConfigError(`配置项 gateway.log_level 非法：${log_level}，允许取值：${VALID_LOG_LEVELS.join("/")}`);
    }
    gateway.log_level = log_level;
    gateway.log_file = require_non_empty_string(gateway.log_file, "gateway.log_file");

    const backend = require_object(normalized.backend, "backend");
    const backend_http = require_object(backend.http, "backend.http");
    backend_http.host = require_non_empty_string(backend_http.host, "backend.http.host");
    backend_http.port = require_port(backend_http.port, "backend.http.port");
    const backend_tcp = require_object(backend.tcp, "backend.tcp");
    backend_tcp.host = require_non_empty_string(backend_tcp.host, "backend.tcp.host");
    backend_tcp.port = require_port(backend_tcp.port, "backend.tcp.port");

    if (normalized.ui === undefined) {
        normalized.ui = {};
    } else {
        require_object(normalized.ui, "ui");
    }
    if (typeof normalized.env !== "string" || !normalized.env) {
        normalized.env = CUSTOM_ENV;
    }

    return {
        config: normalized,
        paths: {
            static_dir: resolve_config_path(repo_root, gateway.static_dir),
            log_file: resolve_config_path(repo_root, gateway.log_file),
        },
    };
}

/**
 * 仅解析配置中的运行期资源路径，供已通过校验的配置构造网关实例时复用。
 *
 * 入参：config 已校验配置；repo_root 仓库根绝对路径。
 * 返回：{static_dir, log_file} 绝对路径。
 */
export function resolve_runtime_paths(config, repo_root) {
    return {
        static_dir: resolve_config_path(repo_root, config.gateway.static_dir),
        log_file: resolve_config_path(repo_root, config.gateway.log_file),
    };
}
