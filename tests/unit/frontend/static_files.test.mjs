// 文件功能：前端网关静态资源托管测试（Content-Type、SPA 回退、HEAD、目录穿越防护、dist 缺失 503）
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { FrontendGateway } from "../../../frontend/gateway/gateway.mjs";
import { is_path_within_root, resolve_static_path } from "../../../frontend/gateway/static_files.mjs";
import {
    create_test_config,
    get_unused_port,
    http_request,
    make_quiet_logger,
    make_tmp_dir,
    remove_dir,
    REPO_ROOT,
} from "./helpers.mjs";

// 测试静态资源内容
const INDEX_HTML = "<!DOCTYPE html><html><body><div id=\"app\">index</div></body></html>";
const APP_JS = "console.log('app');";
const FAVICON_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";
const SUB_INDEX_HTML = "<html><body>sub/index</body></html>";

/**
 * 创建静态资源临时目录与文件。
 *
 * 返回：临时目录绝对路径。
 */
function make_static_dir() {
    const root = make_tmp_dir("tmp_visrl_gw_static_");
    fs.writeFileSync(path.join(root, "index.html"), INDEX_HTML, "utf8");
    fs.writeFileSync(path.join(root, "favicon.svg"), FAVICON_SVG, "utf8");
    fs.mkdirSync(path.join(root, "assets"), { recursive: true });
    fs.writeFileSync(path.join(root, "assets", "app.js"), APP_JS, "utf8");
    fs.mkdirSync(path.join(root, "sub"), { recursive: true });
    fs.writeFileSync(path.join(root, "sub", "index.html"), SUB_INDEX_HTML, "utf8");
    return root;
}

/**
 * 启动带静态目录的网关，并注册测试清理。
 *
 * 入参：t 测试上下文；static_dir 静态目录（缺省创建临时目录）。
 * 返回：Promise<{gateway, port, static_dir}>。
 */
async function setup_static_gateway(t, { static_dir = null } = {}) {
    const root = static_dir ?? make_static_dir();
    if (static_dir === null) {
        t.after(() => remove_dir(root));
    }
    const tcp_port = await get_unused_port();
    const { config, paths } = create_test_config({
        gateway: { port: 0, static_dir: root, reconnect_intervals_sec: [0.1] },
        backend: { tcp: { port: tcp_port } },
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
    });
    return { gateway, port: address.port, static_dir: root };
}

test("根路径与静态资源返回正确 Content-Type 与内容", async (t) => {
    const { port } = await setup_static_gateway(t);
    const index = await http_request({ port, path: "/" });
    assert.equal(index.status, 200);
    assert.equal(index.text, INDEX_HTML);
    assert.equal(index.headers["content-type"], "text/html; charset=utf-8");
    const js = await http_request({ port, path: "/assets/app.js" });
    assert.equal(js.status, 200);
    assert.equal(js.text, APP_JS);
    assert.match(js.headers["content-type"], /text\/javascript/);
    const favicon = await http_request({ port, path: "/favicon.svg" });
    assert.equal(favicon.status, 200);
    assert.equal(favicon.headers["content-type"], "image/svg+xml");
});

test("HEAD 请求只返回响应头", async (t) => {
    const { port } = await setup_static_gateway(t);
    const response = await http_request({ port, path: "/", method: "HEAD" });
    assert.equal(response.status, 200);
    assert.equal(response.text, "");
    assert.equal(Number(response.headers["content-length"]), Buffer.byteLength(INDEX_HTML));
});

test("未知路径回退 index.html（SPA 路由）", async (t) => {
    const { port } = await setup_static_gateway(t);
    const route = await http_request({ port, path: "/tasks/42" });
    assert.equal(route.status, 200);
    assert.equal(route.text, INDEX_HTML);
    const missing_asset = await http_request({ port, path: "/assets/not-found.js" });
    assert.equal(missing_asset.status, 200);
    assert.equal(missing_asset.text, INDEX_HTML);
});

test("目录路径返回目录下 index.html，查询串不影响资源定位", async (t) => {
    const { port } = await setup_static_gateway(t);
    const sub = await http_request({ port, path: "/sub/" });
    assert.equal(sub.status, 200);
    assert.equal(sub.text, SUB_INDEX_HTML);
    const no_slash = await http_request({ port, path: "/sub" });
    assert.equal(no_slash.text, SUB_INDEX_HTML);
    const with_query = await http_request({ port, path: "/assets/app.js?v=1" });
    assert.equal(with_query.text, APP_JS);
});

test("目录穿越与非法路径被拒绝", async (t) => {
    const root = make_static_dir();
    const secret_dir = make_tmp_dir("tmp_visrl_gw_secret_");
    fs.writeFileSync(path.join(secret_dir, "secret.txt"), "TOP-SECRET", "utf8");
    try {
        const { port } = await setup_static_gateway(t, { static_dir: root });
        // WHATWG URL 解析会先规范化 %2e%2e 等编码穿越路径，最终落到根目录内（回退 index.html），
        // 因此只要求既不泄露外部文件、也不出现目录穿越成功。
        const traversal = await http_request({ port, path: "/%2e%2e/%2e%2e/secret.txt" });
        assert.equal(traversal.text.includes("TOP-SECRET"), false);
        assert.ok([200, 400, 404].includes(traversal.status));
        const backslash = await http_request({ port, path: "/..%5Csecret.txt" });
        assert.equal(backslash.status, 400);
        assert.equal(backslash.text.includes("TOP-SECRET"), false);
    } finally {
        remove_dir(root);
        remove_dir(secret_dir);
    }
});

test("静态资源目录不存在时返回 503 并提示先构建", async (t) => {
    const missing_dir = path.join(make_tmp_dir("tmp_visrl_gw_missing_"), "dist");
    t.after(() => remove_dir(path.dirname(missing_dir)));
    const { port } = await setup_static_gateway(t, { static_dir: missing_dir });
    const response = await http_request({ port, path: "/" });
    assert.equal(response.status, 503);
    assert.equal(response.json.code, 4000);
    assert.match(response.json.msg, /npm run build/);
});

test("非 GET/HEAD 的静态请求返回 405", async (t) => {
    const { port } = await setup_static_gateway(t);
    const response = await http_request({ port, path: "/index.html", method: "POST", body: "{}" });
    assert.equal(response.status, 405);
    assert.equal(response.json.code, 1000);
});

test("resolve_static_path 与 is_path_within_root 防护目录穿越", () => {
    const root = path.join(REPO_ROOT, "frontend", "dist");
    const safe = resolve_static_path(root, "/assets/app.js");
    assert.equal(safe.is_safe, true);
    assert.equal(safe.file_path, path.join(root, "assets", "app.js"));
    const root_itself = resolve_static_path(root, "/");
    assert.equal(root_itself.is_safe, true);
    assert.equal(root_itself.file_path, root);
    const traversal = resolve_static_path(root, "/../../etc/passwd");
    assert.equal(traversal.is_safe, false);
    assert.equal(traversal.file_path, null);
    const encoded_traversal = resolve_static_path(root, "/%2e%2e/secret.txt");
    assert.equal(encoded_traversal.is_safe, false);
    const backslash = resolve_static_path(root, "/..%5Csecret.txt");
    assert.equal(backslash.is_safe, false);
    const nul_byte = resolve_static_path(root, "/index%00.html");
    assert.equal(nul_byte.is_safe, false);
    const broken_encoding = resolve_static_path(root, "/%zz");
    assert.equal(broken_encoding.is_safe, false);
    assert.equal(is_path_within_root(path.join(root, "a"), root), true);
    assert.equal(is_path_within_root(root, root), true);
    assert.equal(is_path_within_root(path.dirname(root), root), false);
    assert.equal(is_path_within_root(path.join(root, "..", "x"), root), false);
});
