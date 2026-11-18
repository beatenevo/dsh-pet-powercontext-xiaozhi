# PowerContext + seekdb integration runtime

This optional Python entrypoint is shipped with the npm package. Enabling local long-term memory on a fresh installation installs the pinned dependencies into an isolated runtime and starts this server. The managed lifecycle owns one server and one persistent memory database.

Linux, macOS and Windows x64 use native isolated Python runtimes. Windows downloads the Windows uv build, creates a managed Python 3.12 environment and installs the Windows x64 seekdb wheel; WSL is not required. PowerContext is installed from its pinned Python release; Git is not required. Ensure curl and tar are available on the host before setup. Windows ARM64 Python is not supported by the pinned seekdb distribution. Windows and macOS have not been verified on physical hosts in this change; Linux installation and lifecycle have been exercised.

Save AI Vision settings before starting the service. After changing those settings, pause and resume memory to apply the managed server's OTLP configuration. Existing embedding models and database engines remain fixed; existing vectors are not converted automatically.

See the repository [setup guide](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/docs/en/guides/seekdb-tracing.md) for configuration and qualification boundaries.

| File                         | Responsibility                                                             |
| ---------------------------- | -------------------------------------------------------------------------- |
| `server.py`                  | Start the configured seekdb server and own SQL listener cleanup            |
| `sql_trace.py`               | Request-parented SQL spans, optional redacted statements, error completion |
| `requirements.txt`           | Pinned PowerContext release and driver constraints                         |
| `test_sql_trace.py`          | Redaction, errors, concurrency, filtering and disposal                     |
| `test_seekdb_integration.py` | Real embedded seekdb write, FTS/vector retrieval and HTTP trace continuity |

`test_server.py` checks that invalid backend and tracing combinations fail before database startup.
