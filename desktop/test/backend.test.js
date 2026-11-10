"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { BackendProcess, checkHealth, freePort, parseStatusLine, planBackend, resolveLayout } = require("../src/backend");
const { sanitize, DEFAULT } = require("../src/window-state");

const repoRoot = path.resolve("/repo");

test("dev layout points at the repository checkout", () => {
  const l = resolveLayout({ isPackaged: false, resourcesPath: "/ignored", repoRoot });
  assert.equal(l.backendSrc, path.join(repoRoot, "backend"));
  assert.equal(l.frontendDist, path.join(repoRoot, "frontend", "dist"));
  assert.equal(l.script, path.join(repoRoot, "desktop", "backend", "run-backend.sh"));
});

test("packaged layout uses resources", () => {
  const l = resolveLayout({ isPackaged: true, resourcesPath: "/opt/app/resources", repoRoot });
  assert.equal(l.backendSrc, path.join("/opt/app/resources", "backend"));
  assert.equal(l.script, path.join("/opt/app/resources", "run-backend.sh"));
  assert.equal(l.repoVenv, null);
});

const layout = resolveLayout({ isPackaged: true, resourcesPath: "/res", repoRoot });

test("external backend URL is used as-is (origin only)", () => {
  const p = planBackend({ platform: "linux", env: { CHEMMODEL_BACKEND_URL: "http://127.0.0.1:8000/x" }, layout, userData: "/u", port: 1 });
  assert.deepEqual(p, { kind: "external", url: "http://127.0.0.1:8000" });
  assert.throws(() => planBackend({ platform: "linux", env: { CHEMMODEL_BACKEND_URL: "file:///etc" }, layout, userData: "/u", port: 1 }));
});

test("linux uses a managed venv in userData", () => {
  const p = planBackend({ platform: "linux", env: {}, layout, userData: "/u", port: 4321, exists: () => false });
  assert.equal(p.kind, "local");
  assert.equal(p.command, "bash");
  assert.deepEqual(p.args, [layout.script, layout.backendSrc, layout.frontendDist, path.join("/u", "backend-venv"), "4321"]);
  assert.equal(p.env.CHEMMODEL_SKIP_INSTALL, undefined);
});

test("development reuses backend/.venv without reinstalling", () => {
  const dev = resolveLayout({ isPackaged: false, resourcesPath: "", repoRoot });
  const p = planBackend({ platform: "linux", env: {}, layout: dev, userData: "/u", port: 1, exists: () => true });
  assert.equal(p.args[3], dev.repoVenv);
  assert.equal(p.env.CHEMMODEL_SKIP_INSTALL, "1");
});

test("windows runs the backend through WSL with wslpath conversion", () => {
  const p = planBackend({ platform: "win32", env: { CHEMMODEL_WSL_DISTRO: "Ubuntu" }, layout, userData: "C:\\u", port: 9000 });
  assert.equal(p.kind, "wsl");
  assert.equal(p.command, "wsl.exe");
  assert.deepEqual(p.args.slice(0, 5), ["-d", "Ubuntu", "-e", "bash", "-lc"]);
  assert.match(p.args[5], /wslpath -a "\$1"/);
  assert.deepEqual(p.args.slice(6), ["chemmodel", layout.script, layout.backendSrc, layout.frontendDist, "9000"]);
});

test("status lines are recognised", () => {
  assert.deepEqual(parseStatusLine("CHEMMODEL_STATUS Installing x"), { type: "status", text: "Installing x" });
  assert.deepEqual(parseStatusLine("CHEMMODEL_ERROR boom\r"), { type: "error", text: "boom" });
  assert.equal(parseStatusLine("INFO: Uvicorn running"), null);
});

test("window state sanitising rejects junk", () => {
  assert.deepEqual(sanitize(null), DEFAULT);
  assert.deepEqual(sanitize({ bounds: { width: 10, height: 10 } }), DEFAULT);
  assert.deepEqual(sanitize({ bounds: { width: 1200.4, height: 800, x: 5, y: 6 }, maximized: true }), {
    bounds: { width: 1200, height: 800, x: 5, y: 6 },
    maximized: true,
  });
});

test("health check and external start against a fake server", async () => {
  const port = await freePort();
  const srv = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(req.url === "/api/health" ? '{"status":"ok"}' : "{}");
  });
  await new Promise((r) => srv.listen(port, "127.0.0.1", r));
  try {
    const origin = `http://127.0.0.1:${port}`;
    assert.equal(await checkHealth(origin), true);
    const bp = new BackendProcess({ plan: { kind: "external", url: origin }, port, logFile: "/dev/null" });
    assert.equal(await bp.start({ startupTimeoutMs: 2000, pollMs: 50 }), origin);
  } finally {
    srv.close();
  }
  assert.equal(await checkHealth(`http://127.0.0.1:${port}`, 300), false);
});

test("a backend that exits early reports its error", async () => {
  const port = await freePort();
  const plan = { kind: "local", command: process.execPath, args: ["-e", "console.error('CHEMMODEL_ERROR no python'); process.exit(3)"], env: {} };
  const os = require("node:os");
  const bp = new BackendProcess({ plan, port, logFile: path.join(os.tmpdir(), `cm-test-${process.pid}.log`) });
  await assert.rejects(bp.start({ startupTimeoutMs: 5000, pollMs: 50 }), /no python/);
});
