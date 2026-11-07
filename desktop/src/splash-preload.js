"use strict";
// Minimal, explicit bridge for the splash screen only. The main workstation window has no preload.
const { contextBridge, ipcRenderer } = require("electron");

const listen = (channel) => (cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload));

contextBridge.exposeInMainWorld("desktop", {
  onReset: listen("reset"),
  onStatus: listen("status"),
  onLog: listen("log"),
  onError: listen("error"),
  retry: () => ipcRenderer.send("splash:retry"),
  quit: () => ipcRenderer.send("splash:quit"),
  openLog: () => ipcRenderer.send("splash:open-log"),
});
