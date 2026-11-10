"use strict";
const $ = (id) => document.getElementById(id);
const MAX_LINES = 14;
let lines = [];

function render() {
  $("log").textContent = lines.join("\n");
}

window.desktop.onReset(() => {
  lines = [];
  render();
  $("error").hidden = true;
  $("log").hidden = false;
  $("spinner").classList.remove("stopped");
  $("status").textContent = "Preparing…";
});
window.desktop.onStatus((text) => {
  $("status").textContent = text;
});
window.desktop.onLog((line) => {
  lines.push(line);
  if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES);
  render();
});
window.desktop.onError(({ message, logFile }) => {
  $("spinner").classList.add("stopped");
  $("status").textContent = "The scientific backend could not start.";
  $("error-message").textContent = message;
  $("log-path").textContent = logFile;
  $("error").hidden = false;
  $("log").hidden = true;
});

$("retry").addEventListener("click", () => window.desktop.retry());
$("open-log").addEventListener("click", () => window.desktop.openLog());
$("quit").addEventListener("click", () => window.desktop.quit());
