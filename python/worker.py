"""Private JSON-lines bridge for the VS Code extension.

Only the Parquet explorer is exposed. No HTTP listener or workspace editor runs.
"""

from __future__ import annotations

import json
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from parquet_explorer import ParquetExplorerEngine


def emit(value: dict) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def open_engine(source: str | Path, root: Path, settings: dict) -> ParquetExplorerEngine:
    engine = ParquetExplorerEngine(
        source, allowed_root=root, memory_limit=settings.get("memoryLimit", "2GB"),
        threads=settings.get("threads", 2), temp_directory=settings.get("tempDirectory", ""),
        max_temp_size=settings.get("maxTempSize", "10GB"),
        max_cell_bytes=settings.get("maxCellBytes", 65536),
    )
    try:
        # DuckDB can scan a quoted Parquet path in FROM without calling read_parquet.
        # Restrict the connection itself to the selected source, then freeze settings.
        paths = [str(path.resolve()) for path in engine.files]
        engine._connection.execute("SET allowed_paths = ?", [paths])
        engine._connection.execute("SET enable_external_access = false")
        engine._connection.execute("SET lock_configuration = true")
        return engine
    except Exception:
        engine.close()
        raise


def main() -> int:
    if len(sys.argv) != 4:
        emit({"type": "startupError", "error": "source와 workspace root가 필요합니다."})
        return 2
    try:
        root = Path(sys.argv[2])
        settings = json.loads(sys.argv[3])
        engine = open_engine(sys.argv[1], root, settings)
        emit({"type": "ready"})
    except Exception as exc:
        emit({"type": "startupError", "error": str(exc)})
        return 1

    output_lock = threading.Lock()
    executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="pq-explorer")

    def respond(message: dict) -> None:
        nonlocal engine
        request_id = message.get("id")
        try:
            operation = message["operation"]
            payload = message.get("payload") or {}
            if operation == "meta":
                result = engine.metadata()
            elif operation == "query":
                result = engine.query(**payload)
            elif operation == "lint":
                result = engine.lint(payload["sql"])
            elif operation == "source":
                replacement = open_engine(payload["path"], root, settings)
                previous = engine
                engine = replacement
                previous.close()
                result = engine.metadata()
            else:
                raise ValueError("지원하지 않는 요청입니다.")
            with output_lock:
                emit({"id": request_id, "result": result})
        except Exception as exc:
            with output_lock:
                emit({"id": request_id, "error": str(exc)})

    try:
        for line in sys.stdin:
            try:
                message = json.loads(line)
                if message.get("operation") == "cancel":
                    emit({"id": message.get("id"), "result": engine.cancel((message.get("payload") or {}).get("request_id"))})
                else:
                    executor.submit(respond, message)
            except Exception as exc:
                emit({"id": None, "error": str(exc)})
    finally:
        executor.shutdown(wait=False, cancel_futures=True)
        engine.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
