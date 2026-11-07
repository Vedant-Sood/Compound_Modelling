"use strict";
// Locates, starts and supervises the Python backend for the desktop shell.
// Pure planning helpers are exported separately so they can be unit tested without Electron.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const HOST = "127.0.0.1";

/**
 * Where the backend sources, built UI and launcher script live.
 * Packaged: electron-builder copies them into `process.resourcesPath`.
 * Development (`npm start` in desktop/): use the repository checkout.
 */
function resolveLayout({ isPackaged, resourcesPath, repoRoot }) {
  if (isPackaged) {
    return {
      backendSrc: path.join(resourcesPath, "backend"),
      frontendDist: path.join(resourcesPath, "frontend"),
      script: path.join(resourcesPath, "run-backend.sh"),
      repoVenv: null,
    };
  }
  return {
    backendSrc: path.join(repoRoot, "backend"),
    frontendDist: path.join(repoRoot, "frontend", "dist"),
    script: path.join(repoRoot, "desktop", "backend", "run-backend.sh"),
    repoVenv: path.join(repoRoot, "backend", ".venv"),
  };
}

/**
 * Decide how to run the backend. Returns one of
 *   { kind: "external", url }                       – CHEMMODEL_BACKEND_URL points at a running server
 *   { kind: "wsl", command, args, env }              – Windows: run inside WSL2 (PySCF has no Windows wheels)
 *   { kind: "local", command, args, env }            – Linux/macOS: bash + managed virtualenv
 */
function planBackend({ platform, env, layout, userData, port, exists = fs.existsSync }) {
  if (env.CHEMMODEL_BACKEND_URL) {
    const url = new URL(env.CHEMMODEL_BACKEND_URL);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`CHEMMODEL_BACKEND_URL must be http(s): ${env.CHEMMODEL_BACKEND_URL}`);
    }
    return { kind: "external", url: url.origin };
  }
  const extraEnv = {};
  if (env.CHEMMODEL_BOOTSTRAP_PYTHON) extraEnv.CHEMMODEL_BOOTSTRAP_PYTHON = env.CHEMMODEL_BOOTSTRAP_PYTHON;

  if (platform === "win32") {
    // Paths are converted with wslpath inside WSL; the venv lives in the Linux home directory
    // (a venv on /mnt/c is very slow and breaks on case/permission semantics).
    const inner =
      'S=$(wslpath -a "$1") && B=$(wslpath -a "$2") && D=$(wslpath -a "$3") && ' +
      'exec bash "$S" "$B" "$D" "${CHEMMODEL_VENV:-$HOME/.chemmodel/desktop-venv}" "$4"';
    const args = [];
    if (env.CHEMMODEL_WSL_DISTRO) args.push("-d", env.CHEMMODEL_WSL_DISTRO);
    args.push("-e", "bash", "-lc", inner, "chemmodel", layout.script, layout.backendSrc, layout.frontendDist, String(port));
    return { kind: "wsl", command: "wsl.exe", args, env: extraEnv };
  }

  let venv = path.join(userData, "backend-venv");
  if (env.CHEMMODEL_VENV) {
    venv = env.CHEMMODEL_VENV;
  } else if (layout.repoVenv && exists(path.join(layout.repoVenv, "bin", "python"))) {
    // Development: reuse backend/.venv from scripts/start-backend.sh instead of reinstalling.
    venv = layout.repoVenv;
    extraEnv.CHEMMODEL_SKIP_INSTALL = "1";
  }
  return {
    kind: "local",
    command: "bash",
    args: [layout.script, layout.backendSrc, layout.frontendDist, venv, String(port)],
    env: extraEnv,
  };
}

/** Parse one line of backend output into a splash-screen event (or null for plain log lines). */
function parseStatusLine(line) {
  const m = /^CHEMMODEL_(STATUS|ERROR|LISTENING) (.*)$/.exec(line.trim());
  if (!m) return null;
  return { type: m[1].toLowerCase(), text: m[2] };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, HOST, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function checkHealth(origin, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(`${origin}/api/health`, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve(res.statusCode === 200 && JSON.parse(body).status === "ok");
        } catch {
          resolve(false);
        }
      });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

/**
 * Starts the backend process and resolves with its origin once /api/health answers.
 * Callbacks: onStatus(text), onLog(line). Call stop() to shut it down.
 */
class BackendProcess {
  constructor({ plan, port, logFile, onStatus = () => {}, onLog = () => {} }) {
    this.plan = plan;
    this.port = port;
    this.logFile = logFile;
    this.onStatus = onStatus;
    this.onLog = onLog;
    this.child = null;
    this.exited = null;
    this.lastError = null;
    this.tail = [];
  }

  get origin() {
    return this.plan.kind === "external" ? this.plan.url : `http://${HOST}:${this.port}`;
  }

  async start({ startupTimeoutMs = 30 * 60 * 1000, pollMs = 500 } = {}) {
    if (this.plan.kind === "external") {
      this.onStatus(`Connecting to ${this.plan.url}`);
    } else {
      this.spawnChild();
    }
    const deadline = Date.now() + startupTimeoutMs;
    while (Date.now() < deadline) {
      if (this.exited) {
        throw new Error(this.lastError || `Backend exited (${this.exited}) before it was ready.`);
      }
      if (await checkHealth(this.origin)) return this.origin;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new Error("Timed out waiting for the backend to start.");
  }

  spawnChild() {
    const { command, args, env } = this.plan;
    fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
    const log = fs.createWriteStream(this.logFile, { flags: "a" });
    log.write(`\n=== ${new Date().toISOString()} ${command} ${args.join(" ")}\n`);
    // stdin stays an open pipe: the backend exits when it closes (see chemmodel/launcher.py).
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    const handle = (chunk) => {
      log.write(chunk);
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        this.tail.push(line);
        if (this.tail.length > 200) this.tail.shift();
        const ev = parseStatusLine(line);
        if (ev?.type === "status") this.onStatus(ev.text);
        else if (ev?.type === "error") this.lastError = ev.text;
        this.onLog(line);
      }
    };
    child.stdout.on("data", handle);
    child.stderr.on("data", handle);
    child.on("error", (err) => {
      this.lastError =
        this.plan.kind === "wsl"
          ? `Could not start WSL (${err.message}). Install WSL2 with Ubuntu: wsl --install -d Ubuntu`
          : `Could not start the backend (${err.message}).`;
      this.exited = this.exited || "spawn-error";
    });
    child.on("exit", (code, signal) => {
      this.exited = signal || `code ${code}`;
      log.end(`=== backend exited: ${this.exited}\n`);
    });
  }

  stop() {
    const child = this.child;
    if (!child || this.exited) return;
    try {
      child.stdin.end();
    } catch {
      /* already closed */
    }
    const timer = setTimeout(() => {
      if (!this.exited) child.kill();
    }, 3000);
    timer.unref();
  }
}

module.exports = { HOST, resolveLayout, planBackend, parseStatusLine, freePort, checkHealth, BackendProcess };
