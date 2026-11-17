"""验证命令行拒绝静默回退和无效追踪组合，不启动数据库。"""

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path


class ServerEntryTests(unittest.TestCase):
    def invoke(self, database, *args):
        env = {
            k: v
            for k, v in os.environ.items()
            if not k.startswith(("POWERCONTEXT_", "OTEL_"))
        }
        env["POWERCONTEXT_SERVER_DATABASE"] = json.dumps(database)
        env["POWERCONTEXT_SERVER_TRACING__ENABLED"] = "false"
        return subprocess.run(
            [sys.executable, str(Path(__file__).with_name("server.py")), *args],
            env=env,
            text=True,
            capture_output=True,
            check=False,
            timeout=30,
        )

    def test_sqlite_is_rejected(self):
        result = self.invoke({"kind": "sqlite", "url": "sqlite+aiosqlite:///:memory:"})
        self.assertEqual(result.returncode, 2)
        self.assertIn("SQLite fallback is not allowed", result.stderr)

    def test_text_requires_enabled_tracing(self):
        result = self.invoke(
            {"kind": "seekdb", "path": "/unused/database"}, "--sql-text"
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("--sql-text requires tracing", result.stderr)


if __name__ == "__main__":
    unittest.main()
