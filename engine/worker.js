"use strict";

const { parentPort, workerData } = require("node:worker_threads");
const { ParquetEngine } = require("./parquet");

let engine;
let queue = Promise.resolve();
let statisticsQueue = Promise.resolve();
let statisticsActive;
let closing = false;
const reply = (id, result) => parentPort.postMessage({ id, result });
const fail = (id, error) => parentPort.postMessage({ id, error: String(error.message || error) });

async function dispatch(message) {
  const { id, operation, payload = {} } = message;
  if (closing) return;
  try {
    let result;
    if (operation === "meta") result = engine.metadata();
    else if (operation === "query") result = await engine.query(payload);
    else if (operation === "lint") result = await engine.lint(payload.sql);
    else if (operation === "source") {
      const next = await ParquetEngine.open(payload.path, workerData.root, { ...workerData.settings, sheet: payload.sheet });
      const previous = engine;
      engine = next;
      previous.close();
      result = engine.metadata();
    } else throw new Error("지원하지 않는 요청입니다.");
    reply(id, result);
  } catch (error) { fail(id, error); }
}

(async () => {
  try {
    engine = await ParquetEngine.open(workerData.source, workerData.root, workerData.settings);
    parentPort.on("message", message => {
      if (message.type === "shutdown") {
        if (closing) return;
        closing = true;
        engine.cancel();
        engine.connection?.interrupt();
        statisticsActive?.interruptStatistics();
        // Never terminate a Worker with a native async DuckDB call in flight.
        void queue.then(() => statisticsQueue).finally(() => { engine.close(); parentPort.close(); });
      } else if (closing) return;
      else if (message.operation === "cancel") {
        try { reply(message.id, engine.cancel(message.payload?.request_id)); }
        catch (error) { fail(message.id, error); }
      } else if (message.operation === "stats") {
        // Capture the immutable source before waiting behind other stats.
        const selected = engine;
        statisticsQueue = statisticsQueue.then(async () => {
          if (closing) return;
          statisticsActive = selected;
          try { reply(message.id, await selected.sourceStatistics()); }
          catch (error) { fail(message.id, error); }
          finally { statisticsActive = undefined; }
        });
      } else queue = queue.then(() => dispatch(message));
    });
    parentPort.postMessage({ type: "ready" });
  } catch (error) {
    parentPort.postMessage({ type: "startupError", error: String(error.message || error), code: error.code });
    parentPort.close();
  }
})();
