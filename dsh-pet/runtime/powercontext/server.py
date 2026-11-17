"""Start a standalone PowerContext seekdb server with removable SQL tracing.

Reuse PowerContext environment settings, authentication, and lifecycle management.
Run one server per data directory; PowerContext continues to manage migrations.
"""

import argparse
from contextlib import nullcontext


def main():
    """Validate seekdb settings and remove SQL listeners before shutting down tracing."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--sql-text",
        action="store_true",
        help="Export redacted SQL templates (never parameters)",
    )
    parser.add_argument(
        "--no-sql-tracing", action="store_true", help="Disable database spans"
    )
    args = parser.parse_args()
    import uvicorn
    from powercontext.server.factory import create_server_app
    from powercontext.server.settings import ServerSettings
    from powercontext.server.tracing import configure_server_tracing
    from sql_trace import SeekDBTracing

    settings = ServerSettings()
    if settings.database.kind != "seekdb":
        parser.error(
            "POWERCONTEXT_SERVER_DATABASE must select kind=seekdb; SQLite fallback is not allowed"
        )
    if args.sql_text and (args.no_sql_tracing or not settings.tracing.enabled):
        parser.error("--sql-text requires tracing enabled and SQL tracing enabled")
    tracing = configure_server_tracing(settings.tracing)
    observer = (
        SeekDBTracing(
            tracing.provider, settings.database.database, include_sql=args.sql_text
        )
        if settings.tracing.enabled and not args.no_sql_tracing
        else nullcontext()
    )
    try:
        with observer:
            app = create_server_app(settings=settings, tracing=tracing)
            uvicorn.run(
                app,
                host=settings.http.host,
                port=settings.http.port,
                uds=None if settings.http.uds is None else str(settings.http.uds),
                access_log=False,
            )
    finally:
        tracing.shutdown()


if __name__ == "__main__":
    main()
