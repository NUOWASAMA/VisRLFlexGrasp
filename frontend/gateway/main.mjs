// 文件功能：前端网关入口，解析 --config 与 VISRL_ENV 加载配置、初始化日志、启动网关并处理 SIGINT/SIGTERM 优雅关闭
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11
// 启动方式（frontend 目录或仓库根目录执行）：node frontend/gateway/main.mjs [--config <配置文件>]
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    CLI_CONFIG_FLAG,
    CLI_CONFIG_FLAG_PREFIX,
    CLI_HELP_FLAGS,
} from "./constants.mjs";
import { ConfigError, load_config, validate_config } from "./config_loader.mjs";
import { FrontendGateway } from "./gateway.mjs";
import { Logger } from "./log_util.mjs";

// 进程退出码：0 正常退出，1 配置或启动失败
const EXIT_CODE_SUCCESS = 0;
const EXIT_CODE_FAILURE = 1;

// 命令行用法提示
const USAGE_TEXT = "用法：node gateway/main.mjs [--config <单文件合并配置>]";

/**
 * 由入口模块地址推导仓库根目录（gateway 目录上两级）。
 *
 * 入参：module_url 入口模块 URL。
 * 返回：仓库根目录绝对路径。
 */
export function resolve_repo_root(module_url = import.meta.url) {
    return path.resolve(path.dirname(fileURLToPath(module_url)), "..", "..");
}

/**
 * 解析命令行参数。
 *
 * 入参：argv 参数数组（不含 node 与脚本路径）。
 * 返回：{config_file, help}；help 为 true 表示请求帮助。
 * 异常：参数未知、缺少 --config 值或重复指定时抛出 ConfigError。
 */
export function parse_args(argv) {
    let config_file = null;
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (CLI_HELP_FLAGS.includes(arg)) {
            return { config_file: null, help: true };
        }
        if (arg === CLI_CONFIG_FLAG) {
            const value = argv[index + 1];
            if (value === undefined || value === "") {
                throw new ConfigError(`${CLI_CONFIG_FLAG} 缺少配置文件路径\n${USAGE_TEXT}`);
            }
            if (config_file !== null) {
                throw new ConfigError(`重复指定 ${CLI_CONFIG_FLAG}\n${USAGE_TEXT}`);
            }
            config_file = value;
            index += 1;
            continue;
        }
        if (arg.startsWith(CLI_CONFIG_FLAG_PREFIX)) {
            const value = arg.slice(CLI_CONFIG_FLAG_PREFIX.length);
            if (!value) {
                throw new ConfigError(`${CLI_CONFIG_FLAG} 缺少配置文件路径\n${USAGE_TEXT}`);
            }
            if (config_file !== null) {
                throw new ConfigError(`重复指定 ${CLI_CONFIG_FLAG}\n${USAGE_TEXT}`);
            }
            config_file = value;
            continue;
        }
        throw new ConfigError(`未知命令行参数：${arg}\n${USAGE_TEXT}`);
    }
    return { config_file, help: false };
}

/**
 * 加载并校验配置：--config 单文件优先，否则按 VISRL_ENV 分级合并 base.json。
 *
 * 入参：argv 命令行参数；repo_root 仓库根绝对路径；env_source 环境变量来源。
 * 返回：{config, paths, env, help}；help 为 true 时其余字段无意义。
 * 异常：配置缺失、非法环境标识或字段非法时抛出 ConfigError。
 */
export function load_and_validate_config({ argv, repo_root, env_source = process.env }) {
    const args = parse_args(argv);
    if (args.help) {
        return { config: null, paths: null, env: null, help: true };
    }
    const loaded = load_config({ repo_root, config_file: args.config_file, env_source });
    const validated = validate_config(loaded.config, { repo_root });
    return { config: validated.config, paths: validated.paths, env: loaded.env, help: false };
}

/**
 * 按配置创建日志器；日志文件不可写时自动降级为仅控制台。
 *
 * 入参：config 已校验配置；paths 已解析输出路径；console_enabled 是否输出控制台（测试可关闭）。
 * 返回：Logger 实例。
 */
export function create_logger({ config, paths }, { console_enabled = true } = {}) {
    return new Logger({
        name: "gateway",
        level: config.gateway.log_level,
        file_path: paths.log_file,
        console_enabled,
    });
}

/**
 * 创建并启动网关实例。
 *
 * 入参：config 已校验配置；paths 已解析输出路径；repo_root 仓库根绝对路径；logger 日志器。
 * 返回：Promise<FrontendGateway>，已监听端口。
 * 异常：监听失败（如端口占用）时抛出，已启动的资源会被清理后重新抛出。
 */
export async function start_gateway({ config, paths, repo_root, logger }) {
    const gateway = new FrontendGateway({ config, repo_root, logger, paths });
    try {
        await gateway.start();
    } catch (error) {
        await gateway.stop().catch(() => {});
        throw error;
    }
    return gateway;
}

/**
 * 程序化启动入口：加载配置、创建日志并启动网关（不注册信号处理，便于测试调用）。
 *
 * 入参：argv 命令行参数；repo_root 仓库根绝对路径；env_source 环境变量来源。
 * 返回：Promise<{gateway, logger}|null>，--help 时返回 null。
 * 异常：配置非法或启动失败时抛出。
 */
export async function main(argv = process.argv.slice(2), {
    repo_root = resolve_repo_root(),
    env_source = process.env,
} = {}) {
    const loaded = load_and_validate_config({ argv, repo_root, env_source });
    if (loaded.help) {
        process.stdout.write(`${USAGE_TEXT}\n`);
        return null;
    }
    const logger = create_logger(loaded);
    logger.info("前端网关启动中，运行环境：%s", loaded.env);
    const gateway = await start_gateway({
        config: loaded.config,
        paths: loaded.paths,
        repo_root,
        logger,
    });
    return { gateway, logger };
}

/**
 * 命令行主流程：启动网关并注册 SIGINT/SIGTERM 优雅关闭；配置或启动失败时打印明确错误并 exit(1)。
 *
 * 返回：Promise<void>。
 */
async function run_cli() {
    let result;
    try {
        result = await main(process.argv.slice(2), { repo_root: resolve_repo_root() });
    } catch (error) {
        process.stderr.write(`[错误] ${error.message}\n`);
        if (error instanceof ConfigError) {
            process.stderr.write(`${USAGE_TEXT}\n`);
        }
        process.exit(EXIT_CODE_FAILURE);
        return;
    }
    if (result === null) {
        return;
    }
    const { gateway, logger } = result;
    let closing = false;
    /**
     * 收到终止信号后的优雅关闭流程。
     *
     * 入参：signal 信号名称。
     * 返回：Promise<void>。
     */
    const shutdown = async (signal) => {
        if (closing) {
            return;
        }
        closing = true;
        logger.info("收到 %s 信号，开始优雅关闭", signal);
        try {
            await gateway.stop();
            logger.info("前端网关已退出");
            process.exit(EXIT_CODE_SUCCESS);
        } catch (error) {
            logger.error("前端网关关闭失败：%s", error.message);
            process.exit(EXIT_CODE_FAILURE);
        }
    };
    process.once("SIGINT", () => {
        void shutdown("SIGINT");
    });
    process.once("SIGTERM", () => {
        void shutdown("SIGTERM");
    });
    logger.info("前端网关已就绪，按 Ctrl+C 停止");
}

// 仅当以脚本方式直接执行时启动命令行流程，被测试或其它模块导入时不自动启动。
const is_direct_execution = process.argv[1] !== undefined
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (is_direct_execution) {
    void run_cli();
}
