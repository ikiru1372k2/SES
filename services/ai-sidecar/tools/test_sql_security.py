"""F3 regression tests for the DuckDB SQL hardening.

Run (no pytest needed):
    cd services/ai-sidecar && ./venv/bin/python -m unittest tools.test_sql_security -v

Covers:
  * allowed analytics SQL still works,
  * file-read / network / multi-statement / DDL payloads are rejected,
  * even if a textual check were bypassed, the locked connection cannot
    reach the host filesystem.
"""
import unittest

from tools.sql import DuckCache, safe_query


def _con():
    cache = DuckCache()
    return cache.materialize(
        "PRC-1",
        "v1",
        [
            {"manager": "alice", "effort": 3, "state": "open"},
            {"manager": "bob", "effort": 5, "state": "closed"},
        ],
    )


class AllowedQueries(unittest.TestCase):
    def test_basic_select(self):
        rows = safe_query(_con(), "SELECT manager, effort FROM issues ORDER BY effort")
        self.assertEqual(rows[0]["manager"], "alice")

    def test_aggregate_with_cte(self):
        rows = safe_query(
            _con(),
            "WITH t AS (SELECT state, COUNT(*) c FROM issues GROUP BY state) "
            "SELECT * FROM t ORDER BY state",
        )
        self.assertEqual(len(rows), 2)

    def test_trailing_semicolon_ok(self):
        rows = safe_query(_con(), "SELECT COUNT(*) n FROM issues;")
        self.assertEqual(rows[0]["n"], 2)


class RejectedQueries(unittest.TestCase):
    def _assert_rejected(self, sql: str):
        with self.assertRaises(Exception):
            safe_query(_con(), sql)

    def test_read_text_file(self):
        self._assert_rejected("SELECT * FROM read_text('/etc/passwd')")

    def test_read_csv_file(self):
        self._assert_rejected("SELECT * FROM read_csv('/etc/passwd')")

    def test_glob_filesystem(self):
        self._assert_rejected("SELECT * FROM glob('/**')")

    def test_multi_statement(self):
        self._assert_rejected("SELECT 1; DROP TABLE issues")

    def test_ddl(self):
        self._assert_rejected("CREATE TABLE x (a int)")

    def test_attach(self):
        self._assert_rejected("ATTACH 'x.db' AS y")

    def test_copy_out(self):
        self._assert_rejected("COPY issues TO '/tmp/x.csv'")

    def test_not_select(self):
        self._assert_rejected("DELETE FROM issues")

    def test_pragma(self):
        self._assert_rejected("PRAGMA database_list")


class ConnectionIsLocked(unittest.TestCase):
    def test_external_access_disabled_on_connection(self):
        con = _con()
        # Direct execute bypasses safe_query's text check entirely; the
        # connection lock must still stop host filesystem reads.
        with self.assertRaises(Exception):
            con.execute("SELECT * FROM read_text('/etc/passwd')").fetchall()


if __name__ == "__main__":
    unittest.main()
