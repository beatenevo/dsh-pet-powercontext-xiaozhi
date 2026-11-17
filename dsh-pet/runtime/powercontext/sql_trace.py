"""为专用 seekdb Server 管理 SQL 事件监听，继承当前请求链路并在退出时卸载。

只观察目标库的 seekdb 连接，不导出参数、结果或异常正文。
SQL 文本须显式启用，先移除字面量和注释；观测失败不影响数据库操作。
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
    """返回有限长的脱敏 DML 模板；无法闭合的引号或注释不导出。"""
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
    """持有本进程的监听器；不注册或关闭调用方的 OTel provider。"""

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
        """只在采样中的父 span 下创建真实查询子 span。"""
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
        except Exception:  # noqa: BLE001 - 观测异常不得改变数据库调用结果。
            # 观测端不可用不能改变数据库调用的成败。
            return

    def finish(self, context, failed=False):
        """完成一次查询且清空状态，错误只标记类别。"""
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
        except Exception:  # noqa: BLE001 - 导出器异常不得替换数据库结果。
            return

    def after(self, conn, cursor, statement, parameters, context, executemany):
        self.finish(context)

    def error(self, context):
        self.finish(context.execution_context, failed=True)
