"""Test listener lifecycle, trace ownership, and SQL privacy using local SQLite events."""

import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import patch

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import SpanKind, StatusCode
from sql_trace import SeekDBTracing, query_metadata
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL
from sqlalchemy.exc import DBAPIError


class SQLTraceTests(unittest.TestCase):
    def setUp(self):
        self.provider = TracerProvider()
        self.exporter = InMemorySpanExporter()
        self.provider.add_span_processor(SimpleSpanProcessor(self.exporter))
        self.tracer = self.provider.get_tracer("test")
        self.engine = create_engine("sqlite://")
        # Override only connection identity; execution and errors still come from SQLite.
        self.engine.url = URL.create("mysql+aseekdb", database="powercontext")
        self.addCleanup(self.provider.shutdown)
        self.addCleanup(self.engine.dispose)

    def sql_spans(self):
        return [
            s for s in self.exporter.get_finished_spans() if s.kind == SpanKind.CLIENT
        ]

    def test_parent_success_error_and_disposal(self):
        with SeekDBTracing(self.provider, "powercontext", include_sql=True):
            with (
                self.tracer.start_as_current_span("memory.search") as parent,
                self.engine.connect() as conn,
            ):
                self.assertEqual(
                    conn.execute(
                        text("SELECT :secret"), {"secret": "PRIVATE"}
                    ).scalar(),
                    "PRIVATE",
                )
                with self.assertRaises(DBAPIError):
                    conn.execute(text("SELECT * FROM absent WHERE secret='PRIVATE'"))
                conn.execute(text("SELECT 2"))
            spans = self.sql_spans()
            self.assertEqual(len(spans), 3)
            self.assertTrue(
                all(
                    s.parent.span_id == parent.get_span_context().span_id for s in spans
                )
            )
            self.assertEqual(spans[1].status.status_code, StatusCode.ERROR)
            self.assertTrue(all(s.end_time >= s.start_time for s in spans))
            self.assertNotIn("PRIVATE", str([dict(s.attributes) for s in spans]))
            self.assertFalse(any(s.events for s in spans))
        with (
            self.tracer.start_as_current_span("after-disposal"),
            self.engine.connect() as conn,
        ):
            conn.execute(text("SELECT 3"))
        self.assertEqual(len(self.sql_spans()), 3)

    def test_default_no_text_no_root_and_other_backend(self):
        with (
            SeekDBTracing(self.provider, "powercontext"),
            self.engine.connect() as conn,
        ):
            conn.execute(text("SELECT 1"))
            with self.tracer.start_as_current_span("parent"):
                conn.execute(text("SELECT 2"))
                self.engine.url = URL.create("sqlite", database="powercontext")
                conn.execute(text("SELECT 3"))
        spans = self.sql_spans()
        self.assertEqual(len(spans), 1)
        self.assertNotIn("db.statement", spans[0].attributes)

    def test_parallel_contexts_remain_independent(self):
        def query(number):
            engine = create_engine("sqlite://")
            engine.url = self.engine.url
            try:
                with self.tracer.start_as_current_span(str(number)) as parent:
                    with engine.connect() as conn:
                        conn.execute(text("SELECT 1"))
                    return parent.get_span_context().span_id
            finally:
                engine.dispose()

        with (
            SeekDBTracing(self.provider, "powercontext"),
            ThreadPoolExecutor(max_workers=4) as pool,
        ):
            parents = set(pool.map(query, range(8)))
        self.assertEqual({s.parent.span_id for s in self.sql_spans()}, parents)
        self.assertEqual(len(self.sql_spans()), 8)

    def test_telemetry_failure_does_not_change_query(self):
        with SeekDBTracing(self.provider, "powercontext") as observer:
            with (
                patch.object(
                    observer.tracer, "start_span", side_effect=RuntimeError("offline")
                ),
                self.tracer.start_as_current_span("parent"),
                self.engine.connect() as conn,
            ):
                self.assertEqual(conn.execute(text("SELECT 1")).scalar(), 1)
            observer.error(SimpleNamespace(execution_context=None))

    def test_sql_redaction_and_fail_closed(self):
        self.assertEqual(
            query_metadata("SELECT 0b101010, 0xdead, 1.25e-3")[1], "SELECT ?, ?, ?"
        )
        for sql in [
            "SELECT 'SECRET'",
            'SELECT "SECRET"',
            "SELECT 'a\\'SECRET'",
            "SELECT 'a''SECRET'",
            "SELECT 1 /* SECRET */",
            "SELECT 1 -- SECRET\n",
            "SELECT 0xabc # SECRET\n",
        ]:
            result = query_metadata(sql)
            self.assertIsNotNone(result)
            self.assertNotIn("SECRET", result[1])
        for sql in [
            "SELECT 'SECRET",
            'SELECT "SECRET',
            "SELECT 1 /* SECRET",
            "SET password=SECRET",
            "x" * 65537,
        ]:
            self.assertIsNone(query_metadata(sql))
        self.assertIn(
            "l2_distance",
            query_metadata(
                "WITH candidates AS (SELECT l2_distance(embedding, %s)) SELECT * FROM candidates"
            )[1],
        )


if __name__ == "__main__":
    unittest.main()
