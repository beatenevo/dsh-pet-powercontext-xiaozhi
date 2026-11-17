"""启动独立的 PowerContext seekdb 服务，并接入可卸载的 SQL 追踪。

沿用 PowerContext 的环境配置、认证和生命周期，不启动第二个数据库副本。
同一数据目录只允许一个服务进程；数据库迁移仍由 PowerContext 管理。
"""

import argparse
from contextlib import nullcontext


def main():
    """验证 seekdb 配置后启动服务，关闭时先卸载 SQL 监听。"""
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
