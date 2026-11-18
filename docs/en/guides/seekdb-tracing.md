# Pet → PowerContext → seekdb → observability

The existing dedicated PowerContext client forwards W3C `traceparent`. This repository now ships an optional Python server entrypoint that adds actual seekdb query spans under that request. It requires no edits to installed packages or recording-specific files.

## Setup

For manual setup, use Python 3.12+ and a Linux/macOS environment supported by embedded seekdb. PowerContext is installed from a pinned Python release; Git is not required. From the repository root (for npm installations use the package's `runtime/powercontext` directory):

```bash
python3.12 -m venv .venv-seekdb
.venv-seekdb/bin/python -m pip install -r dsh-pet/runtime/powercontext/requirements.txt
export POWERCONTEXT_HOME="$PWD/.powercontext-seekdb"
export POWERCONTEXT_SERVER_DATABASE="{\"kind\":\"seekdb\",\"path\":\"$PWD/.powercontext-seekdb/database\",\"database\":\"powercontext\"}"
export POWERCONTEXT_SERVER_HTTP__HOST=127.0.0.1
export POWERCONTEXT_SERVER_HTTP__PORT=8000
export POWERCONTEXT_SERVER_TRACING__ENABLED=true
export OTEL_SERVICE_NAME=powercontext-seekdb
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://vision.example/api/public/otel/v1/traces
export OTEL_EXPORTER_OTLP_TRACES_HEADERS='Authorization=Basic%20BASE64_OF_AGENT_UUID_COLON_SPACE_KEY'
.venv-seekdb/bin/python dsh-pet/runtime/powercontext/server.py --sql-text
```

Use the same endpoint, Agent and credentials as [pet observability](observability.md). Replace placeholders privately. The entrypoint retains PowerContext authentication and network-binding validation. For managed installation, select seekdb in the local memory setup page; the application prepares Python and database dependencies. The requirements pin the PowerContext release and database drivers; rerun integration checks when upgrading them.

Use a fresh seekdb directory or an existing directory migrated through PowerContext's supported workflow. Run only one server per directory. SQLite data is not converted automatically; use PowerContext export/import before switching. This entrypoint rejects SQLite fallback. Initial schema migration can take several minutes; wait for readiness before sending chat requests.

Configure generation and embedding models using the [memory guide](memory.md). Select the dedicated PowerContext pet backend and point `chatMemory.serverUrl` at this server, retaining existing authentication. seekdb is the Server database, not a new pet memory-provider name.

## Validate the chain

Capture a fact through chat, wait for extraction, inspect it under remembered facts, and ask again. Source acceptance alone is not extraction. Open the recent chat trace: chat → memory recall → Server context preparation/search → `seekdb.SELECT` / `seekdb.WITH`. With `--sql-text`, SQL attributes include redacted `MATCH` and `l2_distance` templates and measured timings when those operations run. Token comparisons use provider counters and keep answering-stage and preparation-inclusive totals separate.

SQL spans follow the Server tracing switch; text is off by default. `--sql-text` enables redacted templates containing schema identifiers, never bound parameters, results or raw exception messages. `--no-sql-tracing` disables database spans. Only sampled, valid parents and the configured `mysql+aseekdb` database are observed. Initialization queries do not create orphan roots. Listeners are removed at shutdown; telemetry failures do not change query results.

Coverage is the Server process, not independent PowerContext background processes or database-engine execution plans. Existing [Astra controls](robot.md) retain their action-authorization gates and can send configured taught actions and speech. Observability never initiates hardware actions; SDK receipts do not prove physical completion.

## Checks

```bash
.venv-seekdb/bin/python -m unittest discover -s dsh-pet/runtime/powercontext -p 'test_*.py' -v
DSH_SEEKDB_INTEGRATION=1 .venv-seekdb/bin/python -m unittest discover -s dsh-pet/runtime/powercontext -p 'test_*.py' -v
```

The opt-in integration test creates a real temporary seekdb and verifies memory writes, FTS/vector SQL, prepared-context recall and incoming HTTP parentage. Deterministic fixture embeddings avoid supplier keys; they test the database path, not semantic quality or Token savings. See `runtime/powercontext/README.md` for the source map.
