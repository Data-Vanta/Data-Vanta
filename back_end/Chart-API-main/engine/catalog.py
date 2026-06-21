"""
SQLite-backed catalog of registered tables.

We keep a tiny index alongside the Parquet warehouse so that:
  - listing tables for a user is O(rows) without walking the filesystem
  - we can track row_count, source (upload/postgres/mysql/...), and timestamps
  - renames & drops are consistent

Schema:
  tables(
    user_id     TEXT,
    project_id  TEXT,
    table_name  TEXT,
    parquet_path TEXT NOT NULL,
    row_count   INTEGER,
    source      TEXT,              -- 'upload' | 'postgres' | 'mysql' | ...
    source_ref  TEXT,              -- opaque reference back to the source (e.g. schema.table)
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (user_id, project_id, table_name)
  )
"""
from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


class Catalog:
    def __init__(self, db_path: str | Path):
        self.db_path = str(db_path)
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init_schema()

    # ---------- schema ----------

    def _connect(self) -> sqlite3.Connection:
        # Short-lived, always-closed connection. No WAL mode (it needs
        # multi-connection management that bit us earlier); rollback
        # journal is perfectly fine for our low-traffic catalog.
        conn = sqlite3.connect(self.db_path, timeout=5, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _init_schema(self) -> None:
        with self._lock:
            c = self._connect()
            try:
                c.execute(
                    """
                    CREATE TABLE IF NOT EXISTS tables (
                        user_id TEXT NOT NULL,
                        project_id TEXT NOT NULL,
                        table_name TEXT NOT NULL,
                        parquet_path TEXT NOT NULL,
                        row_count INTEGER,
                        source TEXT NOT NULL DEFAULT 'upload',
                        source_ref TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        PRIMARY KEY (user_id, project_id, table_name)
                    )
                    """
                )
                c.execute(
                    "CREATE INDEX IF NOT EXISTS idx_tables_user_project ON tables(user_id, project_id)"
                )
                c.commit()
            finally:
                c.close()

    # ---------- CRUD ----------

    def upsert(
        self,
        *,
        user_id: str,
        project_id: str,
        table_name: str,
        parquet_path: str,
        row_count: Optional[int],
        source: str = "upload",
        source_ref: Optional[str] = None,
    ) -> dict:
        now = _utcnow()
        with self._lock:
            c = self._connect()
            try:
                existing = c.execute(
                    "SELECT created_at FROM tables WHERE user_id=? AND project_id=? AND table_name=?",
                    (user_id, project_id, table_name),
                ).fetchone()
                created_at = existing["created_at"] if existing else now
                c.execute(
                    """
                    INSERT INTO tables
                      (user_id, project_id, table_name, parquet_path, row_count, source, source_ref, created_at, updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(user_id, project_id, table_name) DO UPDATE SET
                      parquet_path = excluded.parquet_path,
                      row_count    = excluded.row_count,
                      source       = excluded.source,
                      source_ref   = excluded.source_ref,
                      updated_at   = excluded.updated_at
                    """,
                    (user_id, project_id, table_name, parquet_path, row_count, source, source_ref, created_at, now),
                )
                c.commit()
                row = c.execute(
                    "SELECT * FROM tables WHERE user_id=? AND project_id=? AND table_name=?",
                    (user_id, project_id, table_name),
                ).fetchone()
                return dict(row) if row else {}
            finally:
                c.close()

    def get(self, *, user_id: str, project_id: str, table_name: str) -> Optional[dict]:
        with self._lock:
            c = self._connect()
            try:
                row = c.execute(
                    "SELECT * FROM tables WHERE user_id=? AND project_id=? AND table_name=?",
                    (user_id, project_id, table_name),
                ).fetchone()
                return dict(row) if row else None
            finally:
                c.close()

    def list(self, *, user_id: str, project_id: Optional[str] = None) -> list[dict]:
        with self._lock:
            c = self._connect()
            try:
                if project_id is None:
                    rows = c.execute(
                        "SELECT * FROM tables WHERE user_id=? ORDER BY updated_at DESC",
                        (user_id,),
                    ).fetchall()
                else:
                    rows = c.execute(
                        "SELECT * FROM tables WHERE user_id=? AND project_id=? ORDER BY updated_at DESC",
                        (user_id, project_id),
                    ).fetchall()
                return [dict(r) for r in rows]
            finally:
                c.close()

    def delete(self, *, user_id: str, project_id: str, table_name: str) -> bool:
        with self._lock:
            c = self._connect()
            try:
                cur = c.execute(
                    "DELETE FROM tables WHERE user_id=? AND project_id=? AND table_name=?",
                    (user_id, project_id, table_name),
                )
                c.commit()
                return cur.rowcount > 0
            finally:
                c.close()
