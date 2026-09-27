"""Snapshot of smoking-data-visualize's ParquetExplorerEngine for offline VSIX use."""

from __future__ import annotations

import json
import re
import threading
import time
import uuid
from collections.abc import Sequence
from datetime import date, datetime, time as datetime_time
from decimal import Decimal
from pathlib import Path
from typing import Any

import duckdb

DEFAULT_QUERY = "SELECT * FROM data"
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200
DEFAULT_COLUMN_LIMIT = 40
MAX_COLUMN_LIMIT = 100
MAX_SQL_LENGTH = 100_000
_ALLOWED_PREFIX = re.compile(r"^(?:select|with|from|values|describe\s+select)\b", re.IGNORECASE)
_BLOCKED_EXTERNAL_FUNCTION = re.compile(
    r"\b(?:read_(?:csv|json|parquet|text|blob)|"
    r"(?:parquet|csv|json|sqlite|postgres|mysql)_scan|glob|attach)\b",
    re.IGNORECASE,
)


class ParquetExplorerError(ValueError):
    """Raised for invalid sources or unsafe/invalid explorer queries."""


class ParquetExplorerEngine:
    def __init__(self, source: str | Path, *, allowed_root: str | Path | None = None) -> None:
        requested = Path(source).expanduser().resolve()
        self.allowed_root = (
            Path(allowed_root).expanduser().resolve()
            if allowed_root is not None
            else requested.parent
        )
        self._lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._active_query_id: str | None = None
        self._cancelled_query_ids: set[str] = set()
        self._timed_out_query_ids: set[str] = set()
        self._connection = duckdb.connect(database=":memory:")
        self._connection.execute("SET threads = 2")
        self._connection.execute("SET memory_limit = '2GB'")
        self.source = requested
        self.files: list[Path] = []
        self._file_bytes = 0
        self._columns: list[dict[str, str]] = []
        self._row_count_cache: dict[str, int] = {}
        self.set_source(requested)

    def set_source(self, source: str | Path) -> dict[str, Any]:
        requested = Path(source).expanduser()
        resolved = (
            requested.resolve()
            if requested.is_absolute()
            else (self.allowed_root / requested).resolve()
        )
        if resolved != self.allowed_root and self.allowed_root not in resolved.parents:
            raise ParquetExplorerError(
                f"허용된 source root 밖의 경로입니다: {resolved} (root={self.allowed_root})"
            )
        files = _parquet_files(resolved)
        if not files:
            raise ParquetExplorerError(f"Parquet 파일을 찾을 수 없습니다: {resolved}")
        if any(
            file.resolve() != self.allowed_root and self.allowed_root not in file.resolve().parents
            for file in files
        ):
            raise ParquetExplorerError("dataset에 허용된 source root 밖의 Parquet link가 있습니다.")
        with self._lock:
            self._replace_source(resolved, files)
        return self.metadata()

    def _replace_source(self, source: Path, files: list[Path]) -> None:
        file_bytes = sum(file.stat().st_size for file in files)
        relation = self._connection.from_parquet(
            [str(path) for path in files],
            union_by_name=True,
            hive_partitioning=False,
        )
        relation.create_view("data", replace=True)
        self.source = source
        self.files = files
        self._file_bytes = file_bytes
        self._row_count_cache.clear()
        self._columns = [
            {"name": str(name), "type": str(dtype)}
            for name, dtype in zip(relation.columns, relation.types, strict=True)
        ]

    def close(self) -> None:
        with self._lock:
            self._connection.close()

    def metadata(self) -> dict[str, Any]:
        with self._lock:
            row_count = int(self._connection.execute("SELECT count(*) FROM data").fetchone()[0])
        return {
            "source_path": str(self.source),
            "source_kind": "dataset" if self.source.is_dir() else "file",
            "file_count": len(self.files),
            "file_bytes": self._file_bytes,
            "row_count": row_count,
            "column_count": len(self._columns),
            "columns": list(self._columns),
            "allowed_root": str(self.allowed_root),
            "view_name": "data",
            "default_query": DEFAULT_QUERY,
        }

    def lint(self, sql: str) -> dict[str, Any]:
        started = time.perf_counter()
        try:
            with self._lock:
                normalized = self._validated_sql(sql)
                self._connection.execute(f"EXPLAIN {normalized}").fetchall()
            return {
                "ok": True,
                "message": "DuckDB parser/binder: 오류 없음",
                "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
            }
        except (duckdb.Error, ParquetExplorerError) as exc:
            return {
                "ok": False,
                "message": str(exc),
                "position": _error_position(str(exc)),
                "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
            }

    def query(
        self,
        sql: str,
        *,
        page: int = 0,
        page_size: int = DEFAULT_PAGE_SIZE,
        column_offset: int = 0,
        column_limit: int = DEFAULT_COLUMN_LIMIT,
        request_id: str | None = None,
        timeout_seconds: int = 30,
    ) -> dict[str, Any]:
        page = max(0, int(page))
        page_size = min(MAX_PAGE_SIZE, max(1, int(page_size)))
        column_offset = max(0, int(column_offset))
        column_limit = min(MAX_COLUMN_LIMIT, max(1, int(column_limit)))
        query_id = request_id or uuid.uuid4().hex
        timeout_seconds = min(120, max(1, int(timeout_seconds)))
        timer: threading.Timer | None = None
        started = time.perf_counter()
        try:
            with self._lock:
                normalized = self._validated_sql(sql)
                with self._state_lock:
                    self._active_query_id = query_id
                timer = threading.Timer(timeout_seconds, self._timeout, args=(query_id,))
                timer.daemon = True
                timer.start()
                described = self._connection.execute(
                    f"DESCRIBE SELECT * FROM ({normalized}) AS __smoking_data_query"
                ).fetchall()
                self._raise_if_cancelled(query_id)
                all_columns = [
                    {"name": str(row[0]), "type": str(row[1])}
                    for row in described
                ]
                if not all_columns:
                    return {
                        **_empty_query_result(sql, page, page_size, column_offset, column_limit),
                        "request_id": query_id,
                    }
                total_rows = self._row_count_cache.get(normalized)
                if total_rows is None:
                    total_rows = int(
                        self._connection.execute(
                            f"SELECT count(*) FROM ({normalized}) AS __smoking_data_count"
                        ).fetchone()[0]
                    )
                    self._raise_if_cancelled(query_id)
                    self._row_count_cache[normalized] = total_rows
                column_offset = min(column_offset, max(0, len(all_columns) - 1))
                selected = all_columns[column_offset : column_offset + column_limit]
                projection = ", ".join(_quote_identifier(item["name"]) for item in selected)
                offset = page * page_size
                cursor = self._connection.execute(
                    f"SELECT {projection} FROM ({normalized}) AS __smoking_data_query "
                    f"LIMIT {page_size} OFFSET {offset}"
                )
                fetched = cursor.fetchall()
                self._raise_if_cancelled(query_id)
        except duckdb.InterruptException as exc:
            with self._state_lock:
                timed_out = query_id in self._timed_out_query_ids
            message = (
                "DuckDB query가 실행 시간 한도를 초과했습니다."
                if timed_out
                else "DuckDB query가 취소되었습니다."
            )
            raise ParquetExplorerError(message) from exc
        finally:
            if timer is not None:
                timer.cancel()
            with self._state_lock:
                if self._active_query_id == query_id:
                    self._active_query_id = None
                self._cancelled_query_ids.discard(query_id)
                self._timed_out_query_ids.discard(query_id)
        has_more = offset + len(fetched) < total_rows
        rows = [
            [_json_safe(value) for value in row]
            for row in fetched
        ]
        return {
            "ok": True,
            "request_id": query_id,
            "sql": sql,
            "page": page,
            "page_size": page_size,
            "has_more": has_more,
            "row_offset": page * page_size,
            "total_rows": total_rows,
            "rows": rows,
            "columns": selected,
            "column_offset": column_offset,
            "column_limit": column_limit,
            "total_columns": len(all_columns),
            "has_previous_columns": column_offset > 0,
            "has_more_columns": column_offset + len(selected) < len(all_columns),
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
            "timeout_seconds": timeout_seconds,
        }

    def cancel(self, request_id: str | None = None) -> dict[str, Any]:
        with self._state_lock:
            active = self._active_query_id
            if active is None or (request_id is not None and request_id != active):
                return {"cancelled": False, "request_id": request_id, "active_request_id": active}
            self._cancelled_query_ids.add(active)
            self._connection.interrupt()
            return {"cancelled": True, "request_id": active, "active_request_id": active}

    def _raise_if_cancelled(self, query_id: str) -> None:
        with self._state_lock:
            if query_id in self._timed_out_query_ids:
                raise ParquetExplorerError("DuckDB query가 실행 시간 한도를 초과했습니다.")
            if query_id in self._cancelled_query_ids:
                raise ParquetExplorerError("DuckDB query가 취소되었습니다.")

    def _timeout(self, query_id: str) -> None:
        with self._state_lock:
            if self._active_query_id != query_id:
                return
            self._timed_out_query_ids.add(query_id)
            self._cancelled_query_ids.add(query_id)
            self._connection.interrupt()

    def _validated_sql(self, sql: str) -> str:
        text = str(sql or "").strip()
        if not text:
            raise ParquetExplorerError("SQL이 비어 있습니다.")
        if len(text) > MAX_SQL_LENGTH:
            raise ParquetExplorerError(f"SQL은 {MAX_SQL_LENGTH:,}자를 넘을 수 없습니다.")
        try:
            statements: Sequence[Any] = self._connection.extract_statements(text)
        except duckdb.Error as exc:
            raise ParquetExplorerError(str(exc)) from exc
        if len(statements) != 1:
            raise ParquetExplorerError("읽기 전용 SQL 한 문장만 실행할 수 있습니다.")
        statement = statements[0]
        if str(statement.type) != "StatementType.SELECT":
            raise ParquetExplorerError("SELECT 계열의 읽기 전용 SQL만 실행할 수 있습니다.")
        normalized = str(statement.query).strip().rstrip(";").strip()
        without_comments = re.sub(r"^(?:\s|--[^\n]*\n|/\*.*?\*/)*", "", normalized, flags=re.S)
        if not _ALLOWED_PREFIX.match(without_comments):
            raise ParquetExplorerError("SELECT, WITH, FROM, VALUES 또는 DESCRIBE SELECT query만 실행할 수 있습니다.")
        if _BLOCKED_EXTERNAL_FUNCTION.search(normalized):
            raise ParquetExplorerError(
                "Explorer SQL에서는 외부 file/database를 여는 함수를 사용할 수 없습니다."
            )
        return normalized


def _parquet_files(path: Path) -> list[Path]:
    if path.is_file():
        return [path] if path.suffix.casefold() == ".parquet" else []
    if not path.is_dir():
        return []
    return sorted(candidate for candidate in path.rglob("*.parquet") if candidate.is_file())


def _quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (datetime, date, datetime_time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, bytes):
        return value.hex()
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    try:
        json.dumps(value)
    except TypeError:
        return str(value)
    return value


def _error_position(message: str) -> dict[str, int] | None:
    line_match = re.search(r"(?m)^LINE\s+(\d+): ?", message)
    if not line_match:
        return None
    lines = message.splitlines()
    caret_line = next((line for line in reversed(lines) if "^" in line), "")
    line_number = int(line_match.group(1))
    # DuckDB renders the caret below "LINE 1: EXPLAIN <SQL>". Both the
    # diagnostic prefix and our EXPLAIN prefix must be removed for the editor.
    prefix_width = len(line_match.group(0)) + (len("EXPLAIN ") if line_number == 1 else 0)
    return {
        "line": max(0, line_number - 1),
        "column": max(0, caret_line.find("^") - prefix_width),
    }


def _empty_query_result(
    sql: str, page: int, page_size: int, column_offset: int, column_limit: int
) -> dict[str, Any]:
    return {
        "ok": True,
        "sql": sql,
        "page": page,
        "page_size": page_size,
        "has_more": False,
        "row_offset": page * page_size,
        "total_rows": 0,
        "rows": [],
        "columns": [],
        "column_offset": column_offset,
        "column_limit": column_limit,
        "total_columns": 0,
        "has_previous_columns": False,
        "has_more_columns": False,
        "elapsed_ms": 0.0,
    }
