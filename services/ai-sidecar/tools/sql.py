"""DuckDB SQL tool — read-only queries over an in-memory `issues` view.

The API ships rows per (processCode, datasetVersion) and the sidecar caches
them in a DuckDB view, so the agent's SQL only ever sees rows the user is
already authorised to read.
"""
from __future__ import annotations

from collections import OrderedDict
from typing import Any, Iterable

import duckdb


class DuckCache:
    """LRU cache of duckdb connections keyed by (processCode, datasetVersion)."""

    def __init__(self, max_entries: int = 16):
        self._entries: "OrderedDict[str, duckdb.DuckDBPyConnection]" = OrderedDict()
        self._max = max_entries

    def _key(self, process_code: str, dataset_version: str) -> str:
        return f"{process_code}::{dataset_version}"

    def has(self, process_code: str, dataset_version: str) -> bool:
        return self._key(process_code, dataset_version) in self._entries

    def materialize(
        self,
        process_code: str,
        dataset_version: str,
        rows: list[dict[str, Any]],
    ) -> duckdb.DuckDBPyConnection:
        key = self._key(process_code, dataset_version)
        if key in self._entries:
            self._entries.move_to_end(key)
            return self._entries[key]
        con = duckdb.connect(":memory:")
        if rows:
            con.register("issues_src", rows)
            con.execute("CREATE VIEW issues AS SELECT * FROM issues_src")
        else:
            # empty schema fallback so SELECTs don't blow up
            con.execute("CREATE TABLE issues (placeholder INT)")
        self._entries[key] = con
        if len(self._entries) > self._max:
            _, evicted = self._entries.popitem(last=False)
            evicted.close()
        return con

    def get(
        self, process_code: str, dataset_version: str
    ) -> duckdb.DuckDBPyConnection | None:
        return self._entries.get(self._key(process_code, dataset_version))


def safe_query(con: duckdb.DuckDBPyConnection, sql: str) -> list[dict[str, Any]]:
    """Run a read-only query. Strips trailing semicolons; rejects DDL/DML."""
    s = sql.strip().rstrip(";").strip()
    lower = s.lower()
    forbidden = ("insert ", "update ", "delete ", "drop ", "alter ", "create ", "attach ", "copy ")
    if any(lower.startswith(f) for f in forbidden) or any(f" {f}" in lower for f in forbidden):
        raise ValueError("Only SELECT queries are allowed in the sql tool")
    if not lower.startswith("select") and not lower.startswith("with"):
        raise ValueError("Query must start with SELECT or WITH")
    rows = con.execute(s).fetchall()
    cols = [d[0] for d in con.description] if con.description else []
    return [dict(zip(cols, r)) for r in rows]


def canonicalize_rows(rows: Iterable[dict[str, Any]]) -> str:
    """Stable JSON shape for hashing — sorted keys, sorted by stringified row."""
    import json

    listed = [json.dumps(r, sort_keys=True, default=str) for r in rows]
    listed.sort()
    return "[" + ",".join(listed) + "]"
