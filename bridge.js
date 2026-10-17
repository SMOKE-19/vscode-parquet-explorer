"use strict";

const path = require("node:path");
const { Worker } = require("node:worker_threads");

function startBridge({ source, root, extensionPath, settings = {}, onFailure }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(extensionPath, "engine", "worker.js"), {
      workerData: { source, root, settings },
    });
    const pending = new Map();
    let nextId = 1, ready = false, stopped = false;
    const exited = new Promise(resolveExit => worker.once("exit", resolveExit));
    const startupTimer = setTimeout(() => fail(new Error("DuckDB 작업자 시작 시간 초과")), 20000);

    function fail(error) {
      if (stopped) return;
      if (!ready && ["MODULE_NOT_FOUND", "ERR_DLOPEN_FAILED"].includes(error.code)) {
        error.message += `\n실행 환경: ${process.platform}/${process.arch}. 확장이 실행되는 환경에 맞는 PQ Explorer VSIX를 설치하세요.`;
      }
      stopped = true;
      clearTimeout(startupTimer);
      if (!ready) reject(error);
      for (const call of pending.values()) { clearTimeout(call.timer); call.reject(error); }
      pending.clear();
      // Native async callbacks must finish before the Worker environment goes away.
      try { worker.postMessage({ type: "shutdown" }); } catch { /* Already exited. */ }
      // Keep the event loop alive until native callbacks and Worker cleanup finish.
      if (ready) onFailure?.(error);
    }
    worker.on("error", fail);
    worker.on("exit", code => fail(new Error(`DuckDB 작업자가 종료되었습니다 (exit ${code}).`)));
    worker.on("message", message => {
      if (stopped) return;
      if (message.type === "startupError") {
        fail(Object.assign(new Error(`DuckDB 작업자를 시작하지 못했습니다: ${message.error}`), { code: message.code }));
      } else if (message.type === "ready") {
        clearTimeout(startupTimer);
        ready = true;
        resolve({ request, stop });
      } else {
        const call = pending.get(message.id);
        if (!call) return;
        pending.delete(message.id);
        clearTimeout(call.timer);
        if (message.error) call.reject(new Error(message.error));
        else call.resolve(message.result);
      }
    });

    function request(operation, payload = {}) {
      if (!["meta", "stats", "query", "lint", "source", "cancel"].includes(operation)) return Promise.reject(new Error("지원하지 않는 요청입니다."));
      if (!ready || stopped) return Promise.reject(new Error("DuckDB 작업자가 실행 중이지 않습니다. 작업자를 재시작하세요."));
      return new Promise((resolveCall, rejectCall) => {
        const id = nextId++;
        const seconds = operation === "query" ? Number(payload.timeout_seconds ?? settings.queryTimeoutSeconds ?? 30) : 120;
        const timer = seconds > 0 ? setTimeout(() => {
          // A worker that ignores interruption cannot safely serve later requests.
          fail(new Error("DuckDB 요청 응답 시간 초과. 작업자를 재시작하세요."));
        }, (seconds + 15) * 1000) : undefined;
        pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });
        try { worker.postMessage({ id, operation, payload }); }
        catch (error) { fail(error); }
      });
    }

    function stop() {
      if (stopped) return exited;
      onFailure = undefined;
      fail(new Error("DuckDB 작업자가 중지되었습니다."));
      return exited;
    }
  });
}

module.exports = { startBridge };
