"""Manage SQL listeners for a dedicated seekdb server, preserving request trace context.

Observe only the target seekdb database; omit parameters, results, and exception text.
SQL text is opt-in and redacted; telemetry failures must not affect database operations.
"""

import re
from contextlib import AbstractContextManager

from opentelemetry import trace
from opentelemetry.trace import SpanKind, Status, StatusCode
from sqlalchemy import event
from sqlalchemy.engine import Engine

_TOKEN = re.compile(
    r"'(?:[^'\\]|\\.|'')*'|\"(?:[^\"\\]|\\.|\"\")*\"|`(?:[^`]|``)*`"
    r"|/\*[\s\S]*?\*/|/\*[\s\S]*$|--[^\n]*(?:\n|$)|\#[^\n]*(?:\n|$)"
    r"|\b(?:0[xX][0-9a-fA-F]+|0[bB][01]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b"
    r"|[A-Za-z_][A-Za-z0-9_$]*|\s+|.",
    re.DOTALL,
)
_OPERATIONS = frozenset(("SELECT", "WITH", "INSERT", "UPDATE", "DELETE"))


def query_metadata(statement):
    """Return a bounded, redacted DML template; reject unclosed quotes or comments."""
    if not isinstance(statement, str) or len(statement) > 65536:
        return None
    pieces = []
    for match in _TOKEN.finditer(statement):
        token = match.group()
        if token.startswith(("/*", "--", "#")):
            if token.startswith("/*") and not token.endswith("*/"):
                return None
            pieces.append(" ")
        elif token[0] in "'\"`":
            if len(token) < 2 or token[-1] != token[0]:
                return None
            pieces.append("?" if token[0] != "`" else token)
        elif token[0].isdigit():
            pieces.append("?")
        else:
            pieces.append(token)
    safe = re.sub(r"\s+", " ", "".join(pieces)).strip()
    operation = safe.split(" ", 1)[0].upper()
    if operation not in _OPERATIONS:
        return None
    return operation, safe[:6000]


class SeekDBTracing(AbstractContextManager):
    """Own process-local listeners without registering or closing the caller's OTel provider."""

    def __init__(self, provider, database, *, include_sql=False):
        self.tracer = provider.get_tracer("dsh-pet.powercontext.seekdb")
        self.database = database
        self.include_sql = include_sql
        self.listeners = []
        self.span_key = "_dsh_pet_seekdb_span"

    def __enter__(self):
        if self.listeners:
            raise RuntimeError("seekdb_tracing_already_started")
        try:
            for name, callback in (
                ("before_cursor_execute", self.before),
                ("after_cursor_execute", self.after),
                ("handle_error", self.error),
            ):
                event.listen(Engine, name, callback)
                self.listeners.append((name, callback))
        except Exception:
            self.__exit__()
            raise
        return self

    def __exit__(self, *args):
        for name, callback in reversed(self.listeners):
            event.remove(Engine, name, callback)
        self.listeners.clear()

    def before(self, conn, cursor, statement, parameters, context, executemany):
        """Create actual query spans only under valid, sampled parent spans."""
        try:
            url = conn.engine.url
            parent = trace.get_current_span().get_span_context()
            if url.drivername != "mysql+aseekdb" or url.database != self.database:
                return
            if not parent.is_valid or not parent.trace_flags.sampled:
                return
            metadata = query_metadata(statement)
            if metadata is None:
                return
            operation, safe = metadata
            attributes = {
                "db.system": "mysql",
                "db.system.name": "mysql",
                "db.engine.name": "seekdb",
                "db.namespace": self.database,
                "db.operation.name": operation,
            }
            if self.include_sql:
                attributes["db.statement"] = safe
            span = self.tracer.start_span(
                "seekdb." + operation, kind=SpanKind.CLIENT, attributes=attributes
            )
            setattr(context, self.span_key, span)
        except Exception:  # noqa: BLE001 - Telemetry errors must not change database results.
            # An unavailable telemetry backend must not affect database success or failure.
            return

    def finish(self, context, failed=False):
        """Finish a query and clear its state; record only error status on failure."""
        if context is None:
            return
        span = getattr(context, self.span_key, None)
        if span is None:
            return
        setattr(context, self.span_key, None)
        try:
            if failed:
                span.set_status(Status(StatusCode.ERROR))
            span.end()
        except Exception:  # noqa: BLE001 - Exporter errors must not replace database results.
            return

    def after(self, conn, cursor, statement, parameters, context, executemany):
        self.finish(context)

    def error(self, context):
        self.finish(context.execution_context, failed=True)
