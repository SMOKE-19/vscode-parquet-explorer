import sys
import shutil
import threading
import time
import unittest
import uuid
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).parents[1] / "python"))
from parquet_explorer import ParquetExplorerEngine, ParquetExplorerError, _json_safe


class ParquetExplorerTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).parent / ".tmp" / uuid.uuid4().hex
        self.root.mkdir(parents=True)
        self.source = self.root / "sample.parquet"
        connection = duckdb.connect()
        connection.execute("COPY (SELECT i AS id, repeat('x', 5000) AS payload FROM range(5) t(i)) TO ? (FORMAT PARQUET)", [str(self.source)])
        connection.close()

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_fast_page_does_not_compute_total_count(self):
        engine = ParquetExplorerEngine(self.source, allowed_root=self.root)
        try:
            metadata = engine.metadata()
            self.assertIsNone(metadata["row_count"])
            result = engine.query("SELECT * FROM data", page_size=2)
            self.assertIsNone(result["total_rows"])
            self.assertTrue(result["has_more"])
            self.assertEqual(2, len(result["rows"]))
        finally:
            engine.close()

    def test_exact_count_is_opt_in(self):
        engine = ParquetExplorerEngine(self.source, allowed_root=self.root)
        try:
            result = engine.query("SELECT * FROM data", page_size=2, include_total_rows=True)
            self.assertEqual(5, result["total_rows"])
            self.assertTrue(result["has_more"])
        finally:
            engine.close()

    def test_large_complex_values_are_bounded(self):
        value = _json_safe(["x" * 4000, "y" * 4000], 1024)
        self.assertTrue(value["__pq_truncated__"])
        self.assertEqual("list", value["type"])
        self.assertLessEqual(len(value["preview"].encode("utf-8")), 1024)

    def test_temp_directory_must_stay_in_workspace(self):
        with self.assertRaises(ParquetExplorerError):
            ParquetExplorerEngine(self.source, allowed_root=self.root, temp_directory="../outside")

    def test_active_query_can_be_cancelled(self):
        engine = ParquetExplorerEngine(self.source, allowed_root=self.root)
        errors = []
        thread = threading.Thread(target=lambda: self._run_cancel_target(engine, errors))
        try:
            thread.start()
            deadline = time.monotonic() + 2
            cancelled = False
            while time.monotonic() < deadline and not cancelled:
                cancelled = engine.cancel("cancel-test")["cancelled"]
                if not cancelled:
                    time.sleep(0.01)
            self.assertTrue(cancelled)
            thread.join(2)
            self.assertFalse(thread.is_alive())
            self.assertTrue(errors)
            self.assertIn("취소", str(errors[0]))
        finally:
            engine.close()

    @staticmethod
    def _run_cancel_target(engine, errors):
        try:
            engine.query(
                "SELECT sum(sin(a.range * b.range)) FROM range(100000) a, range(100000) b",
                request_id="cancel-test", timeout_seconds=0,
            )
        except Exception as exc:
            errors.append(exc)


if __name__ == "__main__":
    unittest.main()
