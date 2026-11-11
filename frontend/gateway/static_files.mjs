// 文件功能：前端网关静态资源托管，按 config.gateway.static_dir 提供构建产物并支持单页应用回退与目录穿越防护
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11

import fs from "node:fs";
import path from "node:path";

import {
    DEFAULT_BINARY_CONTENT_TYPE,
    ERROR_CODE,
    HTTP_METHOD,
    HTTP_STATUS,
    INDEX_FILE_NAME,
    JSON_CONTENT_TYPE,
    MIME_TYPES,
} from "./constants.mjs";

// 构建产物缺失时的提示信息，引导用户先构建前端
export const MISSING_DIST_MESSAGE = "前端静态资源目录不存在，请先执行 cd frontend && npm run build";

// 目录穿越等异常路径的提示信息
export const INVALID_PATH_MESSAGE = "请求路径非法";

/**
 * 判断目标路径是否位于静态根目录内（含根目录本身），用于目录穿越防护。
 *
 * 入参：target 目标绝对路径；root 静态根绝对路径。
 * 返回：位于根目录内返回 true。
 */
export function is_path_within_root(target, root) {
    const relative = path.relative(root, target);
    if (relative === "") {
        return true;
    }
    return !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * 将 URL 路径映射为静态资源绝对路径，非法路径返回 null。
 *
 * 入参：root 静态根绝对路径；pathname URL 路径（未解码）。
 * 返回：{file_path, is_safe}；解码失败或目录穿越时 file_path 为 null。
 */
export function resolve_static_path(root, pathname) {
    let decoded;
    try {
        decoded = decodeURIComponent(pathname);
    } catch {
        return { file_path: null, is_safe: false };
    }
    if (decoded.includes("\0") || decoded.includes("\\")) {
        return { file_path: null, is_safe: false };
    }
    const relative = decoded.replace(/^\/+/, "");
    const file_path = path.resolve(root, relative);
    if (!is_path_within_root(file_path, root)) {
        return { file_path: null, is_safe: false };
    }
    return { file_path, is_safe: true };
}

/**
 * 静态文件服务器：托管构建产物，未知路径回退 index.html；构建产物缺失时返回 503 提示。
 */
export class StaticFileServer {
    /**
     * 构造静态文件服务器。
     *
     * 入参：static_root 静态资源根目录绝对路径；logger 日志器。
     */
    constructor({ static_root, logger }) {
        this._static_root = static_root;
        this._logger = logger;
    }

    /** 静态资源根目录绝对路径 */
    get static_root() {
        return this._static_root;
    }

    /**
     * 处理非 /api 的普通 HTTP 请求（静态资源与单页应用路由）。
     *
     * 入参：req Node HTTP 请求；res Node HTTP 响应。
     * 返回：Promise<void>，处理完成即返回。
     */
    async handle_request(req, res) {
        const method = req.method ?? HTTP_METHOD.GET;
        if (method !== HTTP_METHOD.GET && method !== HTTP_METHOD.HEAD) {
            this._send_json(res, HTTP_STATUS.METHOD_NOT_ALLOWED, ERROR_CODE.INVALID_PARAM, "不支持的请求方法");
            return;
        }
        const head_only = method === HTTP_METHOD.HEAD;
        let root_stat;
        try {
            root_stat = await fs.promises.stat(this._static_root);
        } catch {
            this._logger.warn("静态资源目录不存在：%s", this._static_root);
            this._send_json(res, HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODE.TARGET_OFFLINE, MISSING_DIST_MESSAGE);
            return;
        }
        if (!root_stat.isDirectory()) {
            this._send_json(res, HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODE.TARGET_OFFLINE, MISSING_DIST_MESSAGE);
            return;
        }
        let pathname;
        try {
            pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
        } catch {
            this._send_json(res, HTTP_STATUS.BAD_REQUEST, ERROR_CODE.INVALID_MESSAGE, INVALID_PATH_MESSAGE);
            return;
        }
        const { file_path, is_safe } = resolve_static_path(this._static_root, pathname);
        if (!is_safe) {
            this._logger.warn("拒绝非法静态资源请求：%s", pathname);
            this._send_json(res, HTTP_STATUS.BAD_REQUEST, ERROR_CODE.INVALID_MESSAGE, INVALID_PATH_MESSAGE);
            return;
        }
        const served = await this._try_serve_file(res, file_path, head_only);
        if (!served) {
            await this._serve_spa_index(res, head_only);
        }
    }

    /**
     * 尝试把路径作为文件或目录下 index.html 返回。
     *
     * 入参：res Node HTTP 响应；file_path 目标绝对路径；head_only 是否仅返回响应头。
     * 返回：Promise<boolean>，成功返回 true；路径不存在时返回 false 由调用方回退。
     */
    async _try_serve_file(res, file_path, head_only) {
        let stat;
        try {
            stat = await fs.promises.stat(file_path);
        } catch {
            return false;
        }
        if (stat.isDirectory()) {
            return this._try_serve_file(res, path.join(file_path, INDEX_FILE_NAME), head_only);
        }
        if (!stat.isFile()) {
            return false;
        }
        let content;
        try {
            content = await fs.promises.readFile(file_path);
        } catch (error) {
            this._logger.warn("读取静态资源失败：%s（%s）", file_path, error.message);
            return false;
        }
        const content_type = MIME_TYPES[path.extname(file_path).toLowerCase()] ?? DEFAULT_BINARY_CONTENT_TYPE;
        res.writeHead(HTTP_STATUS.OK, {
            "content-type": content_type,
            "content-length": content.length,
            "cache-control": "no-cache",
        });
        res.end(head_only ? undefined : content);
        return true;
    }

    /**
     * 单页应用回退：任何未知路径返回 index.html，构建产物缺失时返回 404。
     *
     * 入参：res Node HTTP 响应；head_only 是否仅返回响应头。
     * 返回：Promise<void>。
     */
    async _serve_spa_index(res, head_only) {
        const index_path = path.join(this._static_root, INDEX_FILE_NAME);
        let content;
        try {
            content = await fs.promises.readFile(index_path);
        } catch {
            this._send_json(res, HTTP_STATUS.NOT_FOUND, ERROR_CODE.TASK_NOT_FOUND, "资源不存在");
            return;
        }
        res.writeHead(HTTP_STATUS.OK, {
            "content-type": MIME_TYPES[".html"],
            "content-length": content.length,
            "cache-control": "no-cache",
        });
        res.end(head_only ? undefined : content);
    }

    /**
     * 输出统一 JSON 错误响应。
     *
     * 入参：res Node HTTP 响应；status HTTP 状态码；code 业务错误码；msg 错误描述。
     * 返回：无。
     */
    _send_json(res, status, code, msg) {
        if (res.writableEnded) {
            return;
        }
        const body = JSON.stringify({ code, msg, data: {}, timestamp: Date.now() });
        res.writeHead(status, {
            "content-type": JSON_CONTENT_TYPE,
            "content-length": Buffer.byteLength(body, "utf8"),
        });
        res.end(body);
    }
}
