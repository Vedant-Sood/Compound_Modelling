"use strict";
// Remembers the main window's size, position and maximised state between launches.

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT = { bounds: { width: 1440, height: 900 }, maximized: false };
const fileFor = (dir) => path.join(dir, "window-state.json");

function sanitize(raw) {
  const b = raw && typeof raw === "object" ? raw.bounds : null;
  const ok = (v) => Number.isFinite(v) && Math.abs(v) < 100000;
  if (!b || !ok(b.width) || !ok(b.height) || b.width < 400 || b.height < 300) return { ...DEFAULT };
  const bounds = { width: Math.round(b.width), height: Math.round(b.height) };
  if (ok(b.x) && ok(b.y)) Object.assign(bounds, { x: Math.round(b.x), y: Math.round(b.y) });
  return { bounds, maximized: raw.maximized === true };
}

function load(dir) {
  try {
    return sanitize(JSON.parse(fs.readFileSync(fileFor(dir), "utf8")));
  } catch {
    return { ...DEFAULT };
  }
}

function track(win, dir) {
  let timer = null;
  const save = () => {
    if (win.isDestroyed()) return;
    const state = { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fileFor(dir), JSON.stringify(state));
    } catch {
      /* non-fatal */
    }
  };
  const debounced = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  win.on("resize", debounced);
  win.on("move", debounced);
  win.on("close", save);
}

module.exports = { load, track, sanitize, DEFAULT };
