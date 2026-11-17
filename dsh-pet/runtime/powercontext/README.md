# PowerContext + seekdb integration runtime

This optional Python entrypoint is shipped with the npm package. Python and database dependencies are installed separately; the desktop plugin never starts a second server automatically.

See the repository [setup guide](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/docs/en/guides/seekdb-tracing.md) for configuration and qualification boundaries.

| File                         | Responsibility                                                             |
| ---------------------------- | -------------------------------------------------------------------------- |
| `server.py`                  | Start the configured seekdb server and own SQL listener cleanup            |
| `sql_trace.py`               | Request-parented SQL spans, optional redacted statements, error completion |
| `requirements.txt`           | Qualified PowerContext revision and driver constraints                     |
| `test_sql_trace.py`          | Redaction, errors, concurrency, filtering and disposal                     |
| `test_seekdb_integration.py` | Real embedded seekdb write, FTS/vector retrieval and HTTP trace continuity |

`test_server.py` checks that invalid backend and tracing combinations fail before database startup.
