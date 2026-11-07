"use strict";
// Electron main process: starts the backend, shows a splash screen while it boots, then opens
// the workstation UI served by the backend in a locked-down window.

const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { BackendProcess, freePort, planBackend, resolveLayout } = require("./backend");
const windowState = require("./window-state");

const REPO_URL = "https://github.com/Vedant-Sood/Compound_Modelling";
const DOCS_URL = `${REPO_URL}/blob/main/docs/DESKTOP.md`;

let backend = null;
let backendOrigin = null;
let splash = null;
let mainWindow = null;
let quitting = false;

const logDir = () => path.join(app.getPath("userData"), "logs");
const logFile = () => path.join(logDir(), "backend.log");

// Opt-in software WebGL for machines/VMs whose GPU is blocklisted (slow, but the 3D views work).
if (process.env.CHEMMODEL_SOFTWARE_GL === "1") {
  app.commandLine.appendSwitch("use-angle", "swiftshader");
  app.commandLine.appendSwitch("enable-unsafe-swiftshader");
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const w = mainWindow || splash;
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });
  app.whenReady().then(onReady);
}

function sendSplash(channel, payload) {
  if (splash && !splash.isDestroyed()) splash.webContents.send(channel, payload);
}

function createSplash() {
  splash = new BrowserWindow({
    width: 560,
    height: 360,
    resizable: false,
    frame: false,
    show: false,
    backgroundColor: "#0b0f17",
    title: "Chemical Modelling",
    webPreferences: {
      preload: path.join(__dirname, "splash-preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  splash.once("ready-to-show", () => splash.show());
  splash.on("closed", () => {
    splash = null;
    if (!mainWindow && !quitting) app.quit();
  });
  splash.loadFile(path.join(__dirname, "splash.html"));
}

async function startBackend() {
  const layout = resolveLayout({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    repoRoot: path.resolve(__dirname, "..", ".."),
  });
  if (!app.isPackaged && !fs.existsSync(path.join(layout.frontendDist, "index.html"))) {
    throw new Error("frontend/dist is missing. Build the UI first: cd frontend && npm ci && npm run build");
  }
  const port = await freePort();
  const plan = planBackend({
    platform: process.platform,
    env: process.env,
    layout,
    userData: app.getPath("userData"),
    port,
  });
  backend = new BackendProcess({
    plan,
    port,
    logFile: logFile(),
    onStatus: (text) => sendSplash("status", text),
    onLog: (line) => sendSplash("log", line),
  });
  backend.onStatus(plan.kind === "wsl" ? "Starting backend in WSL2" : "Starting backend");
  return backend.start();
}

async function boot() {
  sendSplash("reset");
  try {
    backendOrigin = await startBackend();
    createMainWindow(backendOrigin);
  } catch (err) {
    if (backend) backend.stop();
    sendSplash("error", { message: err.message, logFile: logFile() });
  }
}

function isAppUrl(url) {
  try {
    return backendOrigin !== null && new URL(url).origin === backendOrigin;
  } catch {
    return false;
  }
}

function openExternalSafe(url) {
  try {
    const { protocol } = new URL(url);
    if (protocol === "https:" || protocol === "http:" || protocol === "mailto:") shell.openExternal(url);
  } catch {
    /* ignore malformed URLs */
  }
}

function createMainWindow(origin) {
  const state = windowState.load(app.getPath("userData"));
  mainWindow = new BrowserWindow({
    ...state.bounds,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: "#0b0f17",
    title: "Chemical Modelling",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  if (state.maximized) mainWindow.maximize();
  windowState.track(mainWindow, app.getPath("userData"));

  const wc = mainWindow.webContents;
  // The UI is a single-page app served by the backend; anything else opens in the system browser.
  wc.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: "deny" };
  });
  wc.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      openExternalSafe(url);
    }
  });
  wc.on("render-process-gone", (_e, details) => {
    if (quitting) return;
    dialog
      .showMessageBox(mainWindow, {
        type: "error",
        message: "The viewer stopped unexpectedly.",
        detail: `Reason: ${details.reason}. Your autosaved work is kept by the UI.`,
        buttons: ["Reload", "Quit"],
      })
      .then(({ response }) => (response === 0 ? wc.reload() : app.quit()));
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    if (splash && !splash.isDestroyed()) splash.destroy();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.loadURL(origin);
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        { label: "Reload Workspace", accelerator: "CmdOrCtrl+Shift+R", click: () => mainWindow?.webContents.reload() },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" },
      ],
    },
    { role: "windowMenu" },
    {
      label: "Help",
      submenu: [
        { label: "Desktop App Guide", click: () => openExternalSafe(DOCS_URL) },
        { label: "API Reference (OpenAPI)", click: () => backendOrigin && openExternalSafe(`${backendOrigin}/docs`) },
        { label: "Project on GitHub", click: () => openExternalSafe(REPO_URL) },
        { type: "separator" },
        { label: "Open Logs Folder", click: () => shell.openPath(logDir()) },
        ...(isMac
          ? []
          : [
              { type: "separator" },
              {
                label: "About Chemical Modelling",
                click: () =>
                  dialog.showMessageBox({
                    type: "info",
                    title: "About",
                    message: `Chemical Modelling ${app.getVersion()}`,
                    detail: `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}\nBackend: ${backendOrigin ?? "not running"}`,
                  }),
              },
            ]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function hardenSessions() {
  // The app needs no camera, microphone, geolocation, notifications etc.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  app.on("web-contents-created", (_e, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });
}

function onReady() {
  hardenSessions();
  buildMenu();
  ipcMain.on("splash:retry", () => boot());
  ipcMain.on("splash:quit", () => app.quit());
  ipcMain.on("splash:open-log", () => shell.openPath(logFile()));
  createSplash();
  splash.webContents.once("did-finish-load", boot);
}

app.on("before-quit", () => {
  quitting = true;
  if (backend) backend.stop();
});

app.on("window-all-closed", () => app.quit());
