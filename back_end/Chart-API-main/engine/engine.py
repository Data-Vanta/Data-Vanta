"""
DuckDB query engine.

Contract:
  - Files live on local disk as Parquet (see `storage.py`).
  - The catalog (see `catalog.py`) tracks what's registered per user+project.
  - Each call opens a short-lived DuckDB connection, attaches exactly the
    Parquet files it needs as views, then closes. This keeps the process
    memory bounded and avoids cross-user data leaking through a shared
    long-lived connection.

Public surface:
  - upload_dataframe(df, user_id, project_id, table_name, source="upload") -> dict
  - upload_file(path, user_id, project_id, table_name) -> dict         # CSV or XLSX
  - register_existing_parquet(parquet_path, user_id, project_id, table_name, source, source_ref, row_count) -> dict
  - schema(user_id, project_id, table_name) -> list[dict]
  - query(user_id, spec) -> {rows, rowCount, columns, sql}
  - list_tables(user_id, project_id=None) -> list[dict]
  - drop(user_id, project_id, table_name) -> bool

`spec` is the existing {source, select[], filters[], groupBy[], orderBy[], limit}
shape the frontend + agent already speak.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Optional

import duckdb
import pandas as pd

from .catalog import Catalog
from .storage import Storage

# A small allowlist of SQL operators we accept from the JSON query spec so
# the generated SQL can't smuggle in arbitrary snippets via a filter string.
_OPERATORS = {
    "=": "=",
    "!=": "!=",
    "<": "<",
    "<=": "<=",
    ">": ">",
    ">=": ">=",
    "in": "IN",
    "not in": "NOT IN",
    "like": "LIKE",
    "ilike": "ILIKE",
    "is null": "IS NULL",
    "is not null": "IS NOT NULL",
}

# Same for aggregations.
_AGGS = {"sum", "avg", "count", "min", "max", "count_distinct"}


def _q_ident(name: str) -> str:
    """Quote a SQL identifier safely for DuckDB."""
    if not isinstance(name, str) or not name:
        raise ValueError("identifier must be a non-empty string")
    return '"' + name.replace('"', '""') + '"'


class Engine:
    def __init__(self, warehouse_root: str | os.PathLike | None = None):
        self.storage = Storage(warehouse_root)
        self.catalog = Catalog(self.storage.root / "catalog.sqlite")

    # ---------- ingest ----------

    def upload_dataframe(
        self,
        df: pd.DataFrame,
        *,
        user_id: str,
        project_id: str,
        table_name: str,
        source: str = "upload",
        source_ref: Optional[str] = None,
    ) -> dict:
        if df is None:
            raise ValueError("dataframe is required")
        path = self.storage.table_path(user_id, project_id, table_name)
        df.columns = [str(c) if c is not None else f"col_{i}" for i, c in enumerate(df.columns)]
        df.to_parquet(path, index=False)
        return self.catalog.upsert(
            user_id=user_id,
            project_id=project_id,
            table_name=table_name,
            parquet_path=str(path),
            row_count=int(len(df)),
            source=source,
            source_ref=source_ref,
        )

    def upload_file(
        self,
        file_path: str | os.PathLike,
        *,
        user_id: str,
        project_id: str,
        table_name: str,
    ) -> dict:
        """Convenience path — pandas picks the reader by extension."""
        p = Path(file_path)
        ext = p.suffix.lower()
        if ext == ".csv":
            df = pd.read_csv(p)
        elif ext in {".xlsx", ".xls"}:
            # openpyxl handles .xlsx; xlrd/xlutils would be needed for legacy .xls,
            # but pandas will raise a clear message if the engine isn't available.
            df = pd.read_excel(p)
        elif ext == ".parquet":
            df = pd.read_parquet(p)
        elif ext == ".json":
            df = pd.read_json(p)
        else:
            raise ValueError(f"Unsupported file type: {ext}")
        return self.upload_dataframe(
            df,
            user_id=user_id,
            project_id=project_id,
            table_name=table_name,
            source="upload",
        )

    def register_existing_parquet(
        self,
        *,
        user_id: str,
        project_id: str,
        table_name: str,
        source: str,
        source_ref: Optional[str] = None,
    ) -> dict:
        """
        For ingesters that write Parquet directly (connectors). The file must
        already sit at storage.table_path(...).
        """
        path = self.storage.table_path(user_id, project_id, table_name)
        if not path.is_file():
            raise FileNotFoundError(f"Parquet not found at {path}")
        # Cheap row count via DuckDB (scans file metadata only, not rows).
        with duckdb.connect() as con:
            n = con.execute(
                f"SELECT count(*) FROM read_parquet({_q_literal_path(path)})"
            ).fetchone()[0]
        return self.catalog.upsert(
            user_id=user_id,
            project_id=project_id,
            table_name=table_name,
            parquet_path=str(path),
            row_count=int(n),
            source=source,
            source_ref=source_ref,
        )

    # ---------- read ----------

    def schema(self, *, user_id: str, project_id: str, table_name: str) -> list[dict]:
        row = self.catalog.get(user_id=user_id, project_id=project_id, table_name=table_name)
        if not row:
            raise LookupError(f"Table not registered: {project_id}.{table_name}")
        path = row["parquet_path"]
        with duckdb.connect() as con:
            desc = con.execute(
                f"DESCRIBE SELECT * FROM read_parquet({_q_literal_path(path)}) LIMIT 0"
            ).fetchall()
        # DESCRIBE returns (column_name, column_type, null, key, default, extra).
        return [
            {"name": r[0], "type": r[1], "nullable": (r[2] == "YES" if len(r) > 2 else True)}
            for r in desc
        ]

    def list_tables(self, *, user_id: str, project_id: Optional[str] = None) -> list[dict]:
        return self.catalog.list(user_id=user_id, project_id=project_id)

    def drop(self, *, user_id: str, project_id: str, table_name: str) -> bool:
        removed_row = self.catalog.delete(user_id=user_id, project_id=project_id, table_name=table_name)
        removed_file = self.storage.delete(user_id=user_id, project_id=project_id, table_name=table_name)
        return removed_row or removed_file

    # ---------- query ----------

    def query(self, *, user_id: str, spec: dict) -> dict:
        """
        Translate the JSON query spec into DuckDB SQL and execute it.

        spec = {
          "source":   "<project_id>.<table_name>"  OR  "project_id/table_name"
          "select":   [ "<col>", {"col": str, "agg": "sum"|"count"|...}, "*" ]
          "filters":  [ {"col": str, "op": str, "value": any} ]
          "groupBy":  [ "<col>", ... ]
          "orderBy":  [ {"col": str, "direction": "asc"|"desc"} ]
          "limit":    int
        }
        """
        source = str(spec.get("source") or "").strip()
        if "." in source:
            project_id, table_name = source.split(".", 1)
        elif "/" in source:
            project_id, table_name = source.split("/", 1)
        else:
            raise ValueError(f"Invalid source: {source!r}, expected 'project.table'")

        row = self.catalog.get(user_id=user_id, project_id=project_id, table_name=table_name)
        if not row:
            raise LookupError(f"Table not registered: {project_id}.{table_name}")
        parquet_path = row["parquet_path"]

        select_spec = spec.get("select") or ["*"]
        filters = spec.get("filters") or []
        group_by = spec.get("groupBy") or []
        order_by = spec.get("orderBy") or []
        limit = spec.get("limit")

        # Build the select first so the order-by builder can resolve
        # alias collisions (LLMs sometimes produce `SUM(revenue) AS revenue`
        # which DuckDB can't disambiguate from the raw column).
        select_clause, alias_index = _build_select_and_aliases(select_spec)
        where_clause, params = _build_where(filters)
        group_clause = _build_group(group_by)
        order_clause = _build_order(order_by, alias_index)
        limit_clause = _build_limit(limit)

        sql = (
            f"SELECT {select_clause} "
            f"FROM read_parquet({_q_literal_path(parquet_path)}) AS t "
            f"{where_clause} {group_clause} {order_clause} {limit_clause}"
        ).strip()

        with duckdb.connect() as con:
            result = con.execute(sql, params).fetch_arrow_table()
        pdf = result.to_pandas()
        columns = [{"name": c, "type": str(result.schema.field(c).type)} for c in pdf.columns]
        rows = pdf.to_dict(orient="records")
        return {"rows": rows, "rowCount": len(rows), "columns": columns, "sql": sql}


# ---------- internal SQL builders ----------

def _build_select(spec: Any) -> str:
    """Back-compat: returns the SELECT string only."""
    return _build_select_and_aliases(spec)[0]


def _build_select_and_aliases(spec: Any) -> tuple[str, dict[str, tuple[int, bool]]]:
    """
    Build SELECT and simultaneously return an index of aliases.

    alias_index maps `alias_name` → (1-based position, is_aggregate).
    The order-by builder uses this to resolve ambiguous references
    (e.g. `SUM(revenue) AS revenue` aliased to the same name as its
    input column) by emitting the positional form `ORDER BY 2` which
    DuckDB never confuses with a raw column.
    """
    alias_index: dict[str, tuple[int, bool]] = {}
    if spec in (None, "*"):
        return "*", alias_index
    if not isinstance(spec, list):
        raise ValueError(f"Invalid select: {spec!r}")
    if not spec:
        return "*", alias_index

    parts: list[str] = []
    for position, item in enumerate(spec, start=1):
        if item == "*":
            parts.append("*")
        elif isinstance(item, str):
            parts.append(_q_ident(item))
            alias_index[item] = (position, False)
        elif isinstance(item, dict):
            col = item.get("col") or item.get("column")
            agg = (item.get("agg") or item.get("aggregation") or "").lower()
            alias = item.get("alias") or item.get("as")
            is_agg = bool(agg) and agg in _AGGS or agg == "count_distinct"
            if agg == "count_distinct":
                expr = f"COUNT(DISTINCT {_q_ident(col)})" if col else "COUNT(*)"
            elif agg in _AGGS:
                if agg == "count" and not col:
                    expr = "COUNT(*)"
                else:
                    expr = f"{agg.upper()}({_q_ident(col)})"
            elif col:
                expr = _q_ident(col)
            else:
                raise ValueError(f"Invalid select item: {item!r}")
            effective_alias = alias or (col if not is_agg else None)
            if alias:
                expr += f" AS {_q_ident(alias)}"
            if effective_alias:
                alias_index[effective_alias] = (position, is_agg)
            parts.append(expr)
        else:
            raise ValueError(f"Invalid select item: {item!r}")
    return ", ".join(parts), alias_index


def _build_where(filters: list[dict]) -> tuple[str, list[Any]]:
    if not filters:
        return "", []
    parts: list[str] = []
    params: list[Any] = []
    for f in filters:
        col = f.get("col") or f.get("column")
        op_raw = (f.get("op") or f.get("operator") or "=").lower()
        if op_raw not in _OPERATORS:
            raise ValueError(f"Unsupported operator: {op_raw}")
        op = _OPERATORS[op_raw]
        if op_raw in ("is null", "is not null"):
            parts.append(f"{_q_ident(col)} {op}")
            continue
        if op_raw in ("in", "not in"):
            values = f.get("value") or f.get("values") or []
            if not isinstance(values, list) or not values:
                raise ValueError(f"{op_raw} requires a non-empty list of values")
            placeholders = ", ".join(["?"] * len(values))
            parts.append(f"{_q_ident(col)} {op} ({placeholders})")
            params.extend(values)
            continue
        parts.append(f"{_q_ident(col)} {op} ?")
        params.append(f.get("value"))
    return "WHERE " + " AND ".join(parts), params


def _build_group(group_by: list[str]) -> str:
    if not group_by:
        return ""
    return "GROUP BY " + ", ".join(_q_ident(c) for c in group_by)


def _build_order(order_by: list[dict], alias_index: Optional[dict[str, tuple[int, bool]]] = None) -> str:
    if not order_by:
        return ""
    alias_index = alias_index or {}
    parts: list[str] = []
    for o in order_by:
        col = o.get("col") or o.get("column") or o.get("alias") or o.get("as")
        direction = (o.get("direction") or "asc").lower()
        if direction not in {"asc", "desc"}:
            raise ValueError(f"Invalid order direction: {direction}")
        # If the reference hits an aggregated alias, use the positional
        # form so DuckDB doesn't confuse the alias with a raw column.
        hit = alias_index.get(col)
        if hit and hit[1]:  # is_aggregate
            parts.append(f"{hit[0]} {direction.upper()}")
        else:
            parts.append(f"{_q_ident(col)} {direction.upper()}")
    return "ORDER BY " + ", ".join(parts)


def _build_limit(limit: Any) -> str:
    if limit is None:
        return ""
    try:
        n = int(limit)
    except (TypeError, ValueError):
        raise ValueError(f"Invalid limit: {limit!r}")
    if n < 0:
        raise ValueError("limit must be non-negative")
    return f"LIMIT {n}"


def _q_literal_path(path: str | os.PathLike) -> str:
    """Single-quote a filesystem path for embedding in SQL."""
    p = str(path).replace("'", "''")
    return f"'{p}'"


# ---------- singleton ----------

_engine: Optional[Engine] = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = Engine()
    return _engine
