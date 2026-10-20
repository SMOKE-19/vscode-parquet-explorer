import type { RequestMessage, EngineOperation, WorkerRequest, EngineSettings } from "../shared/protocol";
import { errorMessage, errorCode } from "../shared/errors";
import { parentPort, workerData } from "node:worker_threads";
import { ParquetEngine } from "./parquet";

const port = parentPort!;
const data = workerData as { source: string; root: string; settings: EngineSettings };
let engine: ParquetEngine;
let queue = Promise.resolve();
let statisticsQueue = Promise.resolve();
let statisticsActive: ParquetEngine | undefined;
let closing = false;
const reply = (id: number, result: unknown) => port.postMessage({ id, result });
const fail = (id: number, error: unknown) => port.postMessage({ id, error: errorMessage(error) });

async function dispatch(message: RequestMessage<EngineOperation>) {
  const { id, operation } = message;
  if (closing) return;
  try {
    let result;
    if (operation === "meta") result = engine.metadata();
    else if (operation === "query") result = await engine.query(message.payload);
    else if (operation === "lint") result = await engine.lint(message.payload?.sql);
    else if (operation === "source") {
      const next = await ParquetEngine.open(message.payload!.path, data.root, { ...data.settings, sheet: message.payload?.sheet });
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
    engine = await ParquetEngine.open(data.source, data.root, data.settings);
    port.on("message", (message: WorkerRequest) => {
      if (message.type === "shutdown") {
        if (closing) return;
        closing = true;
        engine.cancel();
        engine.connection?.interrupt();
        statisticsActive?.interruptStatistics();
        // Never terminate a Worker with a native async DuckDB call in flight.
        void queue.then(() => statisticsQueue).finally(() => { engine.close(); port.close(); });
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
    port.postMessage({ type: "ready" });
  } catch (error) {
    port.postMessage({ type: "startupError", error: errorMessage(error), code: errorCode(error) });
    port.close();
  }
})();
