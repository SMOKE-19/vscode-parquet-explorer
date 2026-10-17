"""Private JSON-lines bridge for the VS Code extension.

Only the Parquet explorer is exposed. No HTTP listener or workspace editor runs.
"""

from __future__ import annotations

import json
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


def emit(value: dict) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def open_engine(source: str | Path, root: Path, settings: dict) -> ParquetExplorerEngine:
    from parquet_explorer import ParquetExplorerEngine

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


def duckdb_setup_message(root: Path) -> str:
    interpreter = root / ".venv" / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    return "\n".join([
        "선택한 Python에 duckdb가 설치되어 있지 않습니다.",
        f"실행된 Python: {sys.executable}",
        f"아래 폴더에서 터미널을 열어 실행하세요: {root}",
        "uv venv .venv --python 3.13",
        "uv pip install duckdb",
        "uv가 설치되어 있어야 합니다. 기존 .venv가 있으면 생성 명령을 건너뛰세요.",
        "다른 가상환경이 활성화되어 있으면 해제한 뒤 위 명령을 실행하세요.",
        f"설치 후 pqExplorer.pythonPath를 다음 경로로 설정하고 Parquet 탭을 다시 여세요: {interpreter}",
        "Windows에서는 Windows 터미널에서, WSL·Remote SSH에서는 해당 환경의 터미널에서 실행하세요.",
    ])


def main() -> int:
    if len(sys.argv) != 4:
        emit({"type": "startupError", "error": "source와 workspace root가 필요합니다."})
        return 2
    try:
        root = Path(sys.argv[2])
        if sys.version_info < (3, 10):
            emit({"type": "startupError", "code": "UNSUPPORTED_PYTHON", "python": sys.executable, "error": "Python 3.10 이상이 필요합니다."})
            return 1
        settings = json.loads(sys.argv[3])
        engine = open_engine(sys.argv[1], root, settings)
        emit({"type": "ready"})
    except ModuleNotFoundError as exc:
        message = duckdb_setup_message(root) if exc.name == "duckdb" else str(exc)
        emit({"type": "startupError", "code": "MISSING_DUCKDB" if exc.name == "duckdb" else "IMPORT_ERROR", "python": sys.executable, "error": message})
        return 1
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
