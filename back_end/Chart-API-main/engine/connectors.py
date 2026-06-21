"""
Connector dispatch.

Each supported connector type maps to an `Ingester` that can:
  - test(cfg)        → {"ok": bool, "message": str}
  - list_tables(cfg) → [{"schema", "name", "row_estimate"?}]
  - list_columns(cfg, schema, name) → [{"name", "type", "nullable"}]
  - ingest(cfg, tables, user_id, project_id, connector_name) →
        [{"table": str, "rows": int, "duration_ms": int}]
  - run_sql(cfg, sql, row_limit, timeout_sec)  →
        {"columns": [{"name", "type"}], "rows": [...]}
        (Read-only — only SELECT / WITH ... SELECT is permitted.)

All ingesters write their output into the shared DuckDB warehouse via
`Engine.upload_dataframe`, so the ingested tables behave identically
to file uploads — they show up in the files page, the chat composer,
the agent, the boards pin flow.
"""
from __future__ import annotations

import importlib
import time
from typing import Any, Callable, Optional

import pandas as pd

from .engine import Engine, get_engine


# --------- shared helpers ---------

def _safe_table_name(raw: str) -> str:
    import re as _re
    cleaned = _re.sub(r"[^A-Za-z0-9_]+", "_", (raw or "").strip())
    cleaned = _re.sub(r"_+", "_", cleaned).strip("_").lower()
    return cleaned or "untitled"


def _timed(fn: Callable[[], Any]):
    start = time.time()
    out = fn()
    return out, int((time.time() - start) * 1000)


def _require_module(mod: str, install_hint: str) -> Any:
    try:
        return importlib.import_module(mod)
    except ImportError as e:
        raise RuntimeError(
            f"This connector needs `{mod}` installed. Try: pip install {install_hint}"
        ) from e


def _chunks(cur, size: int = 10000):
    """Iterate a DB-API cursor in fetchmany() chunks."""
    while True:
        rows = cur.fetchmany(size)
        if not rows:
            return
        yield rows


# Read-only SQL guard for run_sql().
#
# This is a coarse check, not a SQL parser. It rejects anything that doesn't
# start with SELECT or WITH (CTE-form), and anything that looks like a write
# verb appearing as a top-level statement separator. Drivers below also
# typically reject multi-statement strings on the wire, so the combined
# defense is decent for V1. For stronger guarantees, route via a read-only
# user/role on the source DB.
_READ_ONLY_PREFIX = ("select", "with")
_FORBIDDEN_WORDS = (
    " insert ", " update ", " delete ", " drop ", " alter ", " truncate ",
    " create ", " grant ", " revoke ", " merge ", " call ", " exec ",
    " execute ", " replace ", " comment ",
)


def _ensure_read_only_sql(sql: str) -> str:
    """Strip whitespace + a trailing semicolon, then verify the statement
    starts with SELECT/WITH and contains no obvious write verbs in
    top-level position. Raises ValueError for anything suspicious."""
    if not sql or not isinstance(sql, str):
        raise ValueError("sql is required")
    cleaned = sql.strip()
    while cleaned.endswith(";"):
        cleaned = cleaned[:-1].rstrip()
    if not cleaned:
        raise ValueError("sql is empty")
    head = cleaned.split(None, 1)[0].lower()
    if head not in _READ_ONLY_PREFIX:
        raise ValueError("Only SELECT / WITH ... SELECT statements are allowed")
    # Catch obvious write verbs hidden inside a UNION-style chain.
    flat = " " + cleaned.lower().replace("\n", " ").replace("\t", " ") + " "
    for w in _FORBIDDEN_WORDS:
        if w in flat:
            raise ValueError(f"Disallowed verb in SQL: {w.strip()}")
    if ";" in cleaned:
        # Reject any further statement separators after the trim above.
        raise ValueError("Only a single statement is allowed (no `;` mid-query)")
    return cleaned


def _maybe_inject_limit(sql: str, row_limit: int) -> str:
    """If the user's SQL doesn't already cap the result, append LIMIT.
    Coarse heuristic — looks for ' limit ' as a token; doesn't try to
    handle window-function `LIMIT` quirks. The driver's row-by-row
    fetch is the actual safety net for runaway results."""
    if row_limit <= 0:
        return sql
    if " limit " in sql.lower():
        return sql
    return f"{sql} LIMIT {int(row_limit)}"


def _df_to_run_sql_response(df: "pd.DataFrame") -> dict:
    """Shape a DataFrame into the run_sql response: columns + records."""
    cols = [{"name": str(c), "type": str(df[c].dtype)} for c in df.columns]
    # Convert to native Python — Pandas/NumPy types confuse FastAPI's encoder.
    df2 = df.where(df.notna(), None)
    rows = df2.to_dict(orient="records")
    return {"columns": cols, "rows": rows}


# --------- base protocol (duck-typed) ---------

class _BaseIngester:
    type: str = ""

    def test(self, cfg: dict) -> dict:
        raise NotImplementedError

    def list_tables(self, cfg: dict) -> list[dict]:
        raise NotImplementedError

    def list_columns(self, cfg: dict, schema: Optional[str], name: str) -> list[dict]:
        """Return column metadata for a single source table.

        Each entry: {"name": str, "type": str, "nullable": bool}.
        """
        raise NotImplementedError

    def run_sql(
        self,
        cfg: dict,
        sql: str,
        *,
        row_limit: int = 10000,
        timeout_sec: int = 10,
    ) -> dict:
        """Execute a read-only SELECT and return rows + columns.

        Default base implementation refuses; SQL-speaking subclasses
        override. Returns {"columns": [{name, type}], "rows": [...]}.
        """
        raise NotImplementedError

    def ingest(
        self,
        cfg: dict,
        tables: list[dict],
        *,
        user_id: str,
        project_id: str,
        connector_name: str,
        engine: Optional[Engine] = None,
    ) -> list[dict]:
        raise NotImplementedError


# --------- PostgreSQL ---------

class PostgresIngester(_BaseIngester):
    type = "postgres"

    @staticmethod
    def _psycopg():
        try:
            import psycopg2  # type: ignore
            return psycopg2
        except ImportError:
            # psycopg2-binary is not in requirements; fall back to a clear message.
            return _require_module("psycopg2", "psycopg2-binary")

    def _conn(self, cfg: dict):
        psycopg2 = self._psycopg()
        return psycopg2.connect(
            host=cfg.get("host") or "localhost",
            port=int(cfg.get("port") or 5432),
            dbname=cfg.get("database") or cfg.get("dbname"),
            user=cfg.get("user") or cfg.get("username"),
            password=cfg.get("password") or "",
            connect_timeout=int(cfg.get("connect_timeout") or 10),
            sslmode=cfg.get("sslmode") or "prefer",
        )

    def test(self, cfg):
        try:
            with self._conn(cfg) as c, c.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
            return {"ok": True, "message": "Connected"}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    def list_tables(self, cfg):
        q = """
            SELECT table_schema, table_name
            FROM information_schema.tables
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
              AND table_type = 'BASE TABLE'
            ORDER BY table_schema, table_name
        """
        with self._conn(cfg) as c, c.cursor() as cur:
            cur.execute(q)
            rows = cur.fetchall()
        return [{"schema": s, "name": n} for (s, n) in rows]

    def list_columns(self, cfg, schema, name):
        schema = schema or "public"
        q = """
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = %s AND table_name = %s
            ORDER BY ordinal_position
        """
        with self._conn(cfg) as c, c.cursor() as cur:
            cur.execute(q, (schema, name))
            rows = cur.fetchall()
        return [
            {"name": col, "type": str(dtype), "nullable": (nul or "YES").upper() == "YES"}
            for (col, dtype, nul) in rows
        ]

    def run_sql(self, cfg, sql, *, row_limit=10000, timeout_sec=10):
        clean = _ensure_read_only_sql(sql)
        capped = _maybe_inject_limit(clean, row_limit)
        with self._conn(cfg) as c:
            with c.cursor() as cur:
                cur.execute(f"SET statement_timeout = {int(timeout_sec) * 1000}")
            df = pd.read_sql(capped, c)
        return _df_to_run_sql_response(df)

    def ingest(self, cfg, tables, *, user_id, project_id, connector_name, engine=None):
        engine = engine or get_engine()
        results = []
        with self._conn(cfg) as c:
            for t in tables:
                schema = t.get("schema") or "public"
                name = t["name"]
                target = _safe_table_name(f"{connector_name}_{name}")
                def _go():
                    df = pd.read_sql(f'SELECT * FROM "{schema}"."{name}"', c)
                    engine.upload_dataframe(
                        df,
                        user_id=user_id,
                        project_id=project_id,
                        table_name=target,
                        source=self.type,
                        source_ref=f"{schema}.{name}",
                    )
                    return len(df)
                rows, ms = _timed(_go)
                results.append({"table": target, "rows": rows, "duration_ms": ms})
        return results


# --------- MySQL / MariaDB ---------

class MySqlIngester(_BaseIngester):
    type = "mysql"

    @staticmethod
    def _driver():
        try:
            import pymysql  # type: ignore
            return pymysql
        except ImportError:
            return _require_module("pymysql", "PyMySQL")

    def _conn(self, cfg):
        pymysql = self._driver()
        return pymysql.connect(
            host=cfg.get("host") or "localhost",
            port=int(cfg.get("port") or 3306),
            user=cfg.get("user") or cfg.get("username"),
            password=cfg.get("password") or "",
            database=cfg.get("database") or cfg.get("dbname"),
            connect_timeout=int(cfg.get("connect_timeout") or 10),
            cursorclass=pymysql.cursors.Cursor,
        )

    def test(self, cfg):
        try:
            with self._conn(cfg) as c, c.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
            return {"ok": True, "message": "Connected"}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    def list_tables(self, cfg):
        with self._conn(cfg) as c, c.cursor() as cur:
            cur.execute("SHOW TABLES")
            rows = cur.fetchall()
        db = cfg.get("database") or cfg.get("dbname") or ""
        return [{"schema": db, "name": r[0]} for r in rows]

    def list_columns(self, cfg, schema, name):
        db = schema or cfg.get("database") or cfg.get("dbname") or ""
        q = (
            "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE "
            "FROM information_schema.columns "
            "WHERE table_schema = %s AND table_name = %s "
            "ORDER BY ORDINAL_POSITION"
        )
        with self._conn(cfg) as c, c.cursor() as cur:
            cur.execute(q, (db, name))
            rows = cur.fetchall()
        return [
            {"name": col, "type": str(dtype), "nullable": (nul or "YES").upper() == "YES"}
            for (col, dtype, nul) in rows
        ]

    def run_sql(self, cfg, sql, *, row_limit=10000, timeout_sec=10):
        clean = _ensure_read_only_sql(sql)
        capped = _maybe_inject_limit(clean, row_limit)
        with self._conn(cfg) as c:
            with c.cursor() as cur:
                # MySQL 5.7.8+ / MariaDB 10.1.1+: per-session SELECT timeout.
                try:
                    cur.execute(
                        f"SET SESSION MAX_EXECUTION_TIME = {int(timeout_sec) * 1000}"
                    )
                except Exception:
                    pass  # older servers — best-effort.
            df = pd.read_sql(capped, c)
        return _df_to_run_sql_response(df)

    def ingest(self, cfg, tables, *, user_id, project_id, connector_name, engine=None):
        engine = engine or get_engine()
        results = []
        with self._conn(cfg) as c:
            for t in tables:
                name = t["name"]
                target = _safe_table_name(f"{connector_name}_{name}")
                def _go():
                    df = pd.read_sql(f"SELECT * FROM `{name}`", c)
                    engine.upload_dataframe(
                        df,
                        user_id=user_id,
                        project_id=project_id,
                        table_name=target,
                        source=self.type,
                        source_ref=name,
                    )
                    return len(df)
                rows, ms = _timed(_go)
                results.append({"table": target, "rows": rows, "duration_ms": ms})
        return results


# --------- SQLite ---------

class SqliteIngester(_BaseIngester):
    type = "sqlite"

    def _conn(self, cfg):
        import sqlite3
        path = cfg.get("path") or cfg.get("database")
        if not path:
            raise RuntimeError("SQLite connector needs `path` in config")
        return sqlite3.connect(path)

    def test(self, cfg):
        try:
            with self._conn(cfg) as c:
                c.execute("SELECT 1").fetchone()
            return {"ok": True, "message": "Connected"}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    def list_tables(self, cfg):
        with self._conn(cfg) as c:
            rows = c.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            ).fetchall()
        return [{"schema": "main", "name": r[0]} for r in rows]

    def list_columns(self, cfg, schema, name):
        # PRAGMA can't bind table-name params; sanitize aggressively to prevent SQLi.
        import re as _re
        safe_name = _re.sub(r"[^A-Za-z0-9_]", "", name or "")
        if not safe_name:
            return []
        with self._conn(cfg) as c:
            rows = c.execute(f'PRAGMA table_info("{safe_name}")').fetchall()
        # rows: (cid, name, type, notnull, dflt_value, pk)
        return [
            {"name": r[1], "type": str(r[2] or ""), "nullable": (r[3] == 0)}
            for r in rows
        ]

    def run_sql(self, cfg, sql, *, row_limit=10000, timeout_sec=10):
        clean = _ensure_read_only_sql(sql)
        capped = _maybe_inject_limit(clean, row_limit)
        with self._conn(cfg) as c:
            df = pd.read_sql(capped, c)
        return _df_to_run_sql_response(df)

    def ingest(self, cfg, tables, *, user_id, project_id, connector_name, engine=None):
        engine = engine or get_engine()
        results = []
        with self._conn(cfg) as c:
            for t in tables:
                name = t["name"]
                target = _safe_table_name(f"{connector_name}_{name}")
                def _go():
                    df = pd.read_sql(f'SELECT * FROM "{name}"', c)
                    engine.upload_dataframe(
                        df,
                        user_id=user_id,
                        project_id=project_id,
                        table_name=target,
                        source=self.type,
                        source_ref=name,
                    )
                    return len(df)
                rows, ms = _timed(_go)
                results.append({"table": target, "rows": rows, "duration_ms": ms})
        return results


# --------- Redshift (Postgres wire) ---------

class RedshiftIngester(PostgresIngester):
    """Redshift speaks the Postgres wire protocol — reuse the pg path."""
    type = "redshift"


# --------- SQL Server ---------

class MsSqlIngester(_BaseIngester):
    type = "mssql"

    def _conn(self, cfg):
        pyodbc = _require_module("pyodbc", "pyodbc  (and install the msodbcsql18 ODBC driver)")
        conn_str = cfg.get("connection_string")
        if not conn_str:
            driver = cfg.get("driver") or "ODBC Driver 18 for SQL Server"
            conn_str = (
                f"DRIVER={{{driver}}};"
                f"SERVER={cfg.get('host','localhost')},{int(cfg.get('port', 1433))};"
                f"DATABASE={cfg.get('database','')};"
                f"UID={cfg.get('user','')};"
                f"PWD={cfg.get('password','')};"
                "TrustServerCertificate=yes;"
            )
        return pyodbc.connect(conn_str, timeout=int(cfg.get("connect_timeout") or 10))

    def test(self, cfg):
        try:
            with self._conn(cfg) as c:
                c.cursor().execute("SELECT 1").fetchone()
            return {"ok": True, "message": "Connected"}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    def list_tables(self, cfg):
        with self._conn(cfg) as c:
            cur = c.cursor()
            cur.execute(
                "SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES "
                "WHERE TABLE_TYPE='BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME"
            )
            rows = cur.fetchall()
        return [{"schema": s, "name": n} for (s, n) in rows]

    def list_columns(self, cfg, schema, name):
        schema = schema or "dbo"
        q = (
            "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE "
            "FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_SCHEMA=? AND TABLE_NAME=? "
            "ORDER BY ORDINAL_POSITION"
        )
        with self._conn(cfg) as c:
            cur = c.cursor()
            cur.execute(q, (schema, name))
            rows = cur.fetchall()
        return [
            {"name": col, "type": str(dtype), "nullable": (nul or "YES").upper() == "YES"}
            for (col, dtype, nul) in rows
        ]

    def run_sql(self, cfg, sql, *, row_limit=10000, timeout_sec=10):
        clean = _ensure_read_only_sql(sql)
        capped = _maybe_inject_limit(clean, row_limit)
        with self._conn(cfg) as c:
            try:
                c.timeout = int(timeout_sec)  # pyodbc connection-level timeout (seconds)
            except Exception:
                pass
            df = pd.read_sql(capped, c)
        return _df_to_run_sql_response(df)

    def ingest(self, cfg, tables, *, user_id, project_id, connector_name, engine=None):
        engine = engine or get_engine()
        results = []
        with self._conn(cfg) as c:
            for t in tables:
                schema = t.get("schema") or "dbo"
                name = t["name"]
                target = _safe_table_name(f"{connector_name}_{name}")
                def _go():
                    df = pd.read_sql(f"SELECT * FROM [{schema}].[{name}]", c)
                    engine.upload_dataframe(
                        df,
                        user_id=user_id,
                        project_id=project_id,
                        table_name=target,
                        source=self.type,
                        source_ref=f"{schema}.{name}",
                    )
                    return len(df)
                rows, ms = _timed(_go)
                results.append({"table": target, "rows": rows, "duration_ms": ms})
        return results


# --------- Oracle ---------

class OracleIngester(_BaseIngester):
    type = "oracle"

    def _conn(self, cfg):
        oracledb = _require_module("oracledb", "oracledb")
        dsn = cfg.get("dsn") or oracledb.makedsn(
            cfg.get("host", "localhost"),
            int(cfg.get("port", 1521)),
            service_name=cfg.get("service_name") or cfg.get("sid"),
        )
        return oracledb.connect(
            user=cfg.get("user") or cfg.get("username"),
            password=cfg.get("password") or "",
            dsn=dsn,
        )

    def test(self, cfg):
        try:
            c = self._conn(cfg)
            with c.cursor() as cur:
                cur.execute("SELECT 1 FROM DUAL")
                cur.fetchone()
            c.close()
            return {"ok": True, "message": "Connected"}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    def list_tables(self, cfg):
        c = self._conn(cfg)
        with c.cursor() as cur:
            cur.execute("SELECT owner, table_name FROM all_tables ORDER BY owner, table_name")
            rows = cur.fetchall()
        c.close()
        return [{"schema": s, "name": n} for (s, n) in rows]

    def list_columns(self, cfg, schema, name):
        c = self._conn(cfg)
        try:
            with c.cursor() as cur:
                if schema:
                    cur.execute(
                        "SELECT column_name, data_type, nullable "
                        "FROM all_tab_columns "
                        "WHERE owner = :owner AND table_name = :tbl "
                        "ORDER BY column_id",
                        owner=schema, tbl=name,
                    )
                else:
                    cur.execute(
                        "SELECT column_name, data_type, nullable "
                        "FROM all_tab_columns "
                        "WHERE table_name = :tbl "
                        "ORDER BY column_id",
                        tbl=name,
                    )
                rows = cur.fetchall()
        finally:
            c.close()
        return [
            {"name": col, "type": str(dtype), "nullable": (nul or "Y").upper() == "Y"}
            for (col, dtype, nul) in rows
        ]

    def run_sql(self, cfg, sql, *, row_limit=10000, timeout_sec=10):
        clean = _ensure_read_only_sql(sql)
        # Oracle uses FETCH FIRST ... ROWS ONLY (not LIMIT). Inject only if missing.
        if " fetch first " not in clean.lower() and row_limit > 0:
            clean = f"{clean} FETCH FIRST {int(row_limit)} ROWS ONLY"
        c = self._conn(cfg)
        try:
            try:
                c.call_timeout = int(timeout_sec) * 1000  # python-oracledb (ms)
            except Exception:
                pass
            df = pd.read_sql(clean, c)
        finally:
            c.close()
        return _df_to_run_sql_response(df)

    def ingest(self, cfg, tables, *, user_id, project_id, connector_name, engine=None):
        engine = engine or get_engine()
        results = []
        c = self._conn(cfg)
        try:
            for t in tables:
                schema = t.get("schema") or ""
                name = t["name"]
                target = _safe_table_name(f"{connector_name}_{name}")
                fq = f'"{schema}"."{name}"' if schema else f'"{name}"'
                def _go():
                    df = pd.read_sql(f"SELECT * FROM {fq}", c)
                    engine.upload_dataframe(
                        df,
                        user_id=user_id,
                        project_id=project_id,
                        table_name=target,
                        source=self.type,
                        source_ref=f"{schema}.{name}",
                    )
                    return len(df)
                rows, ms = _timed(_go)
                results.append({"table": target, "rows": rows, "duration_ms": ms})
        finally:
            c.close()
        return results


# --------- MongoDB ---------

class MongoIngester(_BaseIngester):
    type = "mongodb"

    def _client(self, cfg):
        pymongo = _require_module("pymongo", "pymongo")
        uri = cfg.get("uri")
        if uri:
            return pymongo.MongoClient(uri, serverSelectionTimeoutMS=5000)
        return pymongo.MongoClient(
            host=cfg.get("host", "localhost"),
            port=int(cfg.get("port", 27017)),
            username=cfg.get("user") or cfg.get("username"),
            password=cfg.get("password"),
            serverSelectionTimeoutMS=5000,
        )

    def _db(self, cfg):
        client = self._client(cfg)
        return client, client[cfg.get("database") or "admin"]

    def test(self, cfg):
        try:
            client, _db = self._db(cfg)
            client.admin.command("ping")
            client.close()
            return {"ok": True, "message": "Connected"}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    def list_tables(self, cfg):
        client, db = self._db(cfg)
        try:
            names = db.list_collection_names()
            return [{"schema": db.name, "name": n} for n in names]
        finally:
            client.close()

    def list_columns(self, cfg, schema, name):
        # Mongo has no fixed schema. Sample N documents, normalize, return inferred dtypes.
        # All entries are nullable=True since any field may be absent in any doc.
        sample_size = int(cfg.get("columns_sample", 100))
        client, db = self._db(cfg)
        try:
            docs = list(db[name].find({}, {"_id": 0}).limit(sample_size))
        finally:
            client.close()
        if not docs:
            return []
        try:
            df = pd.json_normalize(docs)
        except Exception:
            df = pd.DataFrame(docs)
        return [
            {"name": str(col), "type": str(df[col].dtype), "nullable": True}
            for col in df.columns
        ]

    def run_sql(self, cfg, sql, *, row_limit=10000, timeout_sec=10):
        # Mongo doesn't speak SQL. Live mode is intentionally not supported
        # for V1 — agents should ingest a Mongo collection first and chat
        # against the warehouse copy.
        raise NotImplementedError(
            "Mongo doesn't accept SQL. Ingest the collection first."
        )

    def ingest(self, cfg, tables, *, user_id, project_id, connector_name, engine=None):
        engine = engine or get_engine()
        client, db = self._db(cfg)
        results = []
        try:
            for t in tables:
                name = t["name"]
                target = _safe_table_name(f"{connector_name}_{name}")
                def _go():
                    docs = list(db[name].find({}, {"_id": 0}).limit(int(cfg.get("limit", 100_000))))
                    df = pd.json_normalize(docs) if docs else pd.DataFrame()
                    engine.upload_dataframe(
                        df,
                        user_id=user_id,
                        project_id=project_id,
                        table_name=target,
                        source=self.type,
                        source_ref=f"{db.name}.{name}",
                    )
                    return len(df)
                rows, ms = _timed(_go)
                results.append({"table": target, "rows": rows, "duration_ms": ms})
        finally:
            client.close()
        return results


# --------- BigQuery ---------

class BigQueryIngester(_BaseIngester):
    type = "bigquery"

    def _client(self, cfg):
        bq = _require_module("google.cloud.bigquery", "google-cloud-bigquery")
        from google.oauth2 import service_account  # type: ignore
        creds_json = cfg.get("service_account_json") or cfg.get("service_account")
        project = cfg.get("project") or cfg.get("project_id")
        if creds_json:
            import json as _json
            if isinstance(creds_json, str):
                info = _json.loads(creds_json)
            else:
                info = creds_json
            creds = service_account.Credentials.from_service_account_info(info)
            return bq.Client(credentials=creds, project=project or info.get("project_id"))
        return bq.Client(project=project)

    def test(self, cfg):
        try:
            client = self._client(cfg)
            # A cheap metadata call — no query cost.
            next(iter(client.list_datasets(max_results=1)), None)
            return {"ok": True, "message": "Connected"}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    def list_tables(self, cfg):
        client = self._client(cfg)
        out = []
        for ds in client.list_datasets(max_results=int(cfg.get("dataset_limit", 50))):
            for tbl in client.list_tables(ds.reference):
                out.append({"schema": ds.dataset_id, "name": tbl.table_id})
        return out

    def list_columns(self, cfg, schema, name):
        # Metadata-only call — does NOT incur a BigQuery query cost.
        if not schema:
            raise RuntimeError("BigQuery list_columns needs `schema` (the dataset id)")
        client = self._client(cfg)
        table = client.get_table(f"{client.project}.{schema}.{name}")
        return [
            {
                "name": f.name,
                "type": str(f.field_type or ""),
                "nullable": (f.mode or "NULLABLE") != "REQUIRED",
            }
            for f in table.schema
        ]

    def run_sql(self, cfg, sql, *, row_limit=10000, timeout_sec=10):
        clean = _ensure_read_only_sql(sql)
        capped = _maybe_inject_limit(clean, row_limit)
        client = self._client(cfg)
        # BigQuery jobs run server-side; client-side timeout is approximate.
        df = client.query(capped, timeout=int(timeout_sec)).to_dataframe()
        return _df_to_run_sql_response(df)

    def ingest(self, cfg, tables, *, user_id, project_id, connector_name, engine=None):
        engine = engine or get_engine()
        client = self._client(cfg)
        results = []
        for t in tables:
            schema = t.get("schema")
            name = t["name"]
            fq = f"`{client.project}.{schema}.{name}`"
            target = _safe_table_name(f"{connector_name}_{name}")
            def _go():
                df = client.query(f"SELECT * FROM {fq}").to_dataframe()
                engine.upload_dataframe(
                    df,
                    user_id=user_id,
                    project_id=project_id,
                    table_name=target,
                    source=self.type,
                    source_ref=f"{schema}.{name}",
                )
                return len(df)
            rows, ms = _timed(_go)
            results.append({"table": target, "rows": rows, "duration_ms": ms})
        return results


# --------- Snowflake ---------

class SnowflakeIngester(_BaseIngester):
    type = "snowflake"

    def _conn(self, cfg):
        sf = _require_module("snowflake.connector", "snowflake-connector-python")
        return sf.connect(
            user=cfg.get("user"),
            password=cfg.get("password"),
            account=cfg.get("account"),
            warehouse=cfg.get("warehouse"),
            database=cfg.get("database"),
            schema=cfg.get("schema") or "PUBLIC",
            role=cfg.get("role"),
            login_timeout=int(cfg.get("login_timeout", 10)),
        )

    def test(self, cfg):
        try:
            with self._conn(cfg) as c:
                c.cursor().execute("SELECT 1").fetchone()
            return {"ok": True, "message": "Connected"}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    def list_tables(self, cfg):
        with self._conn(cfg) as c:
            cur = c.cursor()
            cur.execute("SHOW TABLES")
            rows = cur.fetchall()
            cols = [d[0].lower() for d in cur.description]
        idx_schema = cols.index("schema_name") if "schema_name" in cols else 3
        idx_name = cols.index("name") if "name" in cols else 1
        return [{"schema": r[idx_schema], "name": r[idx_name]} for r in rows]

    def list_columns(self, cfg, schema, name):
        # Snowflake stores schema/table identifiers uppercase by default.
        # `list_tables` returns whatever `SHOW TABLES` produced — match that casing.
        schema = schema or cfg.get("schema") or "PUBLIC"
        q = (
            "SELECT column_name, data_type, is_nullable "
            "FROM information_schema.columns "
            "WHERE table_schema = %s AND table_name = %s "
            "ORDER BY ordinal_position"
        )
        with self._conn(cfg) as c:
            cur = c.cursor()
            cur.execute(q, (schema, name))
            rows = cur.fetchall()
        return [
            {"name": col, "type": str(dtype), "nullable": (nul or "YES").upper() == "YES"}
            for (col, dtype, nul) in rows
        ]

    def run_sql(self, cfg, sql, *, row_limit=10000, timeout_sec=10):
        clean = _ensure_read_only_sql(sql)
        capped = _maybe_inject_limit(clean, row_limit)
        with self._conn(cfg) as c:
            cur = c.cursor()
            try:
                cur.execute(
                    f"ALTER SESSION SET STATEMENT_TIMEOUT_IN_SECONDS = {int(timeout_sec)}"
                )
            except Exception:
                pass
            cur.execute(capped)
            df = cur.fetch_pandas_all()
        return _df_to_run_sql_response(df)

    def ingest(self, cfg, tables, *, user_id, project_id, connector_name, engine=None):
        engine = engine or get_engine()
        results = []
        with self._conn(cfg) as c:
            for t in tables:
                schema = t.get("schema") or cfg.get("schema") or "PUBLIC"
                name = t["name"]
                target = _safe_table_name(f"{connector_name}_{name}")
                def _go():
                    cur = c.cursor()
                    cur.execute(f'SELECT * FROM "{schema}"."{name}"')
                    df = cur.fetch_pandas_all()
                    engine.upload_dataframe(
                        df,
                        user_id=user_id,
                        project_id=project_id,
                        table_name=target,
                        source=self.type,
                        source_ref=f"{schema}.{name}",
                    )
                    return len(df)
                rows, ms = _timed(_go)
                results.append({"table": target, "rows": rows, "duration_ms": ms})
        return results


# --------- registry ---------

REGISTRY: dict[str, _BaseIngester] = {
    "postgres": PostgresIngester(),
    "postgresql": PostgresIngester(),
    "mysql": MySqlIngester(),
    "mariadb": MySqlIngester(),
    "sqlite": SqliteIngester(),
    "redshift": RedshiftIngester(),
    "mssql": MsSqlIngester(),
    "sqlserver": MsSqlIngester(),
    "oracle": OracleIngester(),
    "mongodb": MongoIngester(),
    "mongo": MongoIngester(),
    "bigquery": BigQueryIngester(),
    "snowflake": SnowflakeIngester(),
}


def get_ingester(type_name: str) -> _BaseIngester:
    key = (type_name or "").lower()
    if key not in REGISTRY:
        raise ValueError(f"Unsupported connector type: {type_name!r}")
    return REGISTRY[key]
