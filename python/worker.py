"""Private JSON-lines bridge for the VS Code extension.

Only the Parquet explorer is exposed. No HTTP listener or workspace editor runs.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from parquet_explorer import ParquetExplorerEngine


def emit(value: dict) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def open_engine(source: str | Path, root: Path) -> ParquetExplorerEngine:
    engine = ParquetExplorerEngine(source, allowed_root=root)
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
    if len(sys.argv) != 3:
        emit({"type": "startupError", "error": "source와 workspace root가 필요합니다."})
        return 2
    try:
        root = Path(sys.argv[2])
        engine = open_engine(sys.argv[1], root)
        emit({"type": "ready"})
    except Exception as exc:
        emit({"type": "startupError", "error": str(exc)})
        return 1

    try:
        for line in sys.stdin:
            message = None
            try:
                message = json.loads(line)
                request_id = message["id"]
                operation = message["operation"]
                payload = message.get("payload") or {}
                if operation == "meta":
                    result = engine.metadata()
                elif operation == "query":
                    result = engine.query(**payload)
                elif operation == "lint":
                    result = engine.lint(payload["sql"])
                    if not result["ok"]:
                        raise ValueError(result["message"])
                elif operation == "source":
                    replacement = open_engine(payload["path"], root)
                    previous = engine
                    engine = replacement
                    previous.close()
                    result = engine.metadata()
                else:
                    raise ValueError("지원하지 않는 요청입니다.")
                emit({"id": request_id, "result": result})
            except Exception as exc:
                emit({"id": message.get("id") if isinstance(message, dict) else None,
                      "error": str(exc)})
    finally:
        engine.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
