"""真实 seekdb 验证：HTTP 父链路、记忆持久化、全文与向量 SQL；无需模型密钥。"""

import os
import unittest
from contextlib import nullcontext
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from fastapi.testclient import TestClient
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from powercontext.builtin.artifacts.memory import EmbeddingProfile
from powercontext.builtin.inference import EmbeddingResult
from powercontext.builtin.persistence.seekdb import SeekDBConfig
from powercontext.server.factory import create_server_app
from powercontext.server.settings import McpConfig, ServerSettings, TracingConfig
from powercontext.server.tracing import ServerTracing
from sql_trace import SeekDBTracing


class FixtureEmbedding:
    """固定向量仅用于测试 SQL 与父链路，不作为语义检索质量证据。"""

    profile = EmbeddingProfile(profile_id="integration", model="fixture", dimension=3)

    async def embed(self, texts, /):
        return EmbeddingResult(vectors=tuple((1.0, 0.0, 0.0) for _ in texts))


@unittest.skipUnless(
    os.environ.get("DSH_SEEKDB_INTEGRATION") == "1", "requires embedded seekdb"
)
class SeekDBIntegration(unittest.TestCase):
    def test_prepare_retains_http_parent_and_real_sql(self):
        provider = TracerProvider(shutdown_on_exit=False)
        exporter = InMemorySpanExporter()
        provider.add_span_processor(SimpleSpanProcessor(exporter))
        self.addCleanup(provider.shutdown)
        trace_id = "4bf92f3577b34da6a3ce929d0e0e4736"
        headers = {"traceparent": f"00-{trace_id}-00f067aa0ba902b7-01"}
        retained = os.environ.get("DSH_SEEKDB_TEST_DIRECTORY")
        directory_context = (
            nullcontext(retained)
            if retained
            else TemporaryDirectory(prefix="dsh-seekdb-")
        )
        with directory_context as directory:
            root = Path(directory)
            root.mkdir(parents=True, exist_ok=True)
            settings = ServerSettings(
                workspace=root,
                database=SeekDBConfig(path=root / "db"),
                mcp=McpConfig(enabled=False),
                tracing=TracingConfig(enabled=True),
            )
            app = create_server_app(
                settings=settings,
                tracing=ServerTracing(provider, instrumented=True),
                embedding_model=FixtureEmbedding(),
            )
            with (
                SeekDBTracing(provider, "powercontext", include_sql=True),
                TestClient(app) as client,
            ):

                def post(path, body):
                    response = client.post(path, json=body, headers=headers)
                    self.assertTrue(200 <= response.status_code < 300, response.text)
                    return response.json()

                scope = post(
                    "/v1/scopes",
                    {
                        "title": "seekdb integration",
                        "summary": "Isolated real SQL validation",
                        "idempotency_key": str(uuid4()),
                    },
                )["scope_id"]
                post(
                    "/v1/memory/remember",
                    {
                        "scope_id": scope,
                        "kind": "fact",
                        "text": "The offline emergency card is in the second drawer.",
                    },
                )
                for mode in ("fts", "vector"):
                    result = post(
                        "/v1/memory/search",
                        {
                            "scope_id": scope,
                            "query": "emergency card",
                            "mode": mode,
                            "limit": 5,
                        },
                    )
                    self.assertIn("second drawer", str(result))
                prepared = post(
                    "/v1/context/prepare",
                    {
                        "scope_id": scope,
                        "query": "emergency card",
                        "max_bytes": 4096,
                        "assembly": {
                            "format": "markdown",
                            "sections": [{"family": "memory", "limit": 5}],
                        },
                    },
                )
                self.assertEqual(prepared["status"], "ready")
                self.assertIn("second drawer", prepared["content"])
            spans = exporter.get_finished_spans()
            sql = [s for s in spans if s.name.startswith("seekdb.")]
            self.assertTrue(sql)
            self.assertTrue(all(s.context.trace_id == int(trace_id, 16) for s in sql))
            ids = {s.context.span_id for s in spans}
            self.assertTrue(all(s.parent and s.parent.span_id in ids for s in sql))
            statements = "\n".join(s.attributes.get("db.statement", "") for s in sql)
            self.assertIn("MATCH", statements)
            self.assertIn("l2_distance", statements)
            self.assertNotIn("second drawer", statements)
            self.assertNotIn("emergency card", statements)
            print(
                f"Validated {len(sql)} real seekdb SQL spans and prepared-context recall"
            )


if __name__ == "__main__":
    unittest.main()
