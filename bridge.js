"use strict";

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");

function pythonCommand(root, configured = "") {
  if (configured.trim()) {
    const value = configured.trim();
    if (path.isAbsolute(value)) return value;
    return value.includes("/") || value.includes("\\") ? path.resolve(root, value) : value;
  }
  const candidates = [
    path.join(root, "smoking-data-visualize", ".venv", "Scripts", "python.exe"),
    path.join(root, "smoking-data-visualize", ".venv", "bin", "python"),
    path.join(root, ".venv", "Scripts", "python.exe"),
    path.join(root, ".venv", "bin", "python"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || "python";
}

function startBridge({ python, source, root, extensionPath }) {
  return new Promise((resolve, reject) => {
    const worker = path.join(extensionPath, "python", "worker.py");
    const child = spawn(python, ["-u", worker, source, root], {
      cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
    const pending = new Map();
    let nextId = 1;
    let ready = false;
    let stderr = "";
    const lines = readline.createInterface({ input: child.stdout });
    const timeout = setTimeout(() => {
      if (!ready) fail(new Error(`DuckDB 작업자 시작 시간 초과: ${stderr.trim()}`));
    }, 20_000);

    function fail(error) {
      clearTimeout(timeout);
      if (!ready) reject(error);
      for (const call of pending.values()) { clearTimeout(call.timer); call.reject(error); }
      pending.clear();
      child.kill();
    }

    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.on("error", fail);
    child.on("exit", (code) => {
      fail(new Error(`DuckDB 작업자가 종료되었습니다 (exit ${code}). ${stderr.trim()}`));
    });
    lines.on("line", (line) => {
      let message;
      try { message = JSON.parse(line); }
      catch { fail(new Error("DuckDB 작업자의 응답이 올바르지 않습니다.")); return; }
      if (message.type === "startupError") { fail(new Error(message.error)); return; }
      if (message.type === "ready") {
        clearTimeout(timeout);
        ready = true;
        resolve({ request, stop });
        return;
      }
      const call = pending.get(message.id);
      if (!call) return;
      pending.delete(message.id);
      clearTimeout(call.timer);
      if (message.error) call.reject(new Error(message.error));
      else call.resolve(message.result);
    });

    function request(operation, payload = {}) {
      if (!["meta", "query", "lint", "source"].includes(operation)) {
        return Promise.reject(new Error("지원하지 않는 요청입니다."));
      }
      if (!ready || child.exitCode !== null) {
        return Promise.reject(new Error("DuckDB 작업자가 실행 중이지 않습니다."));
      }
      return new Promise((resolveCall, rejectCall) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          fail(new Error("DuckDB 요청 시간 초과"));
        }, 125_000);
        pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });
        child.stdin.write(JSON.stringify({ id, operation, payload }) + "\n", (error) => {
          if (error) fail(error);
        });
      });
    }

    function stop() {
      lines.close();
      child.kill();
    }
  });
}

module.exports = { pythonCommand, startBridge };
