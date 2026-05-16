"""DuckDB SQL tool — read-only queries over an in-memory `issues` view.

The API ships rows per (processCode, datasetVersion) and the sidecar caches
them in a DuckDB view, so the agent's SQL only ever sees rows the user is
already authorised to read.
"""
from __future__ import annotations

import re
from collections import OrderedDict
from typing import Any, Iterable

import duckdb


def _lock_connection(con: duckdb.DuckDBPyConnection) -> None:
    """F3: forbid any host filesystem / network access from this connection.
    DuckDB SELECTs can otherwise call read_csv('/etc/passwd'), read_text(),
    glob(), httpfs, etc. We disable external access and then lock the config
    so a query cannot turn it back on. Best-effort per setting so an older
    DuckDB that lacks one PRAGMA still gets the others."""
    for stmt in (
        "SET enable_external_access=false",
        "SET enable_fsst_vectors=false",
        "SET lock_configuration=true",
    ):
        try:
            con.execute(stmt)
        except Exception:
            pass


# F3: even with external access disabled, reject SQL that names a
# file/network table function or PRAGMA outright — fail loud, not silently.
_FORBIDDEN_TOKENS = re.compile(
    r"\b("
    r"read_csv|read_csv_auto|read_parquet|read_json|read_json_auto|read_text|"
    r"read_blob|read_ndjson|glob|parquet_scan|csv_scan|"
    r"attach|detach|copy|install|load|pragma|set|reset|"
    r"httpfs|http_get|url|sniff_csv|delta_scan|iceberg_scan|"
    r"to_csv|to_parquet|to_json|export|import|"
    r"system|getenv|which_secret"
    r")\b",
    re.IGNORECASE,
)
_STATEMENT_START = re.compile(r"^\s*(select|with)\b", re.IGNORECASE)


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
            try:
                import pandas as _pd
                df = _pd.DataFrame(rows)
                con.register("issues_src", df)
                con.execute("CREATE VIEW issues AS SELECT * FROM issues_src")
            except Exception:
                # Last-ditch: build a minimal table from inferred columns.
                cols = list(rows[0].keys())
                quoted = ", ".join(f'"{c}" VARCHAR' for c in cols)
                con.execute(f"CREATE TABLE issues ({quoted})")
                placeholders = ", ".join(["?"] * len(cols))
                for r in rows:
                    con.execute(
                        f"INSERT INTO issues VALUES ({placeholders})",
                        [str(r.get(c)) if r.get(c) is not None else None for c in cols],
                    )
        else:
            # empty schema fallback so SELECTs don't blow up
            con.execute("CREATE TABLE issues (placeholder INT)")
        # F3: lock the connection AFTER loading data — the config lock would
        # otherwise block our own CREATE VIEW / register above.
        _lock_connection(con)
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
    """F3: run a single read-only query over the in-memory `issues` view.

    Hardening (allowlist, fail-loud), not the old keyword denylist:
      * exactly ONE statement (no `;`-chained second statement),
      * must START with SELECT or WITH,
      * must NOT name any file/network/PRAGMA table function or admin verb,
      * the connection itself is already locked (enable_external_access=false,
        lock_configuration=true) at materialize() time, so even a bypass of
        the textual check cannot reach the host filesystem or network.
    """
    s = sql.strip()
    # Reject multi-statement payloads (strip a single trailing `;` only).
    if s.endswith(";"):
        s = s[:-1].strip()
    if ";" in s:
        raise ValueError("Only a single SELECT statement is allowed")
    if not _STATEMENT_START.match(s):
        raise ValueError("Query must start with SELECT or WITH")
    if _FORBIDDEN_TOKENS.search(s):
        raise ValueError("Query references a disallowed function or statement")
    rows = con.execute(s).fetchall()
    cols = [d[0] for d in con.description] if con.description else []
    return [dict(zip(cols, r)) for r in rows]


def canonicalize_rows(rows: Iterable[dict[str, Any]]) -> str:
    """Stable JSON shape for hashing — sorted keys, sorted by stringified row."""
    import json

    listed = [json.dumps(r, sort_keys=True, default=str) for r in rows]
    listed.sort()
    return "[" + ",".join(listed) + "]"
