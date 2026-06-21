"""
Widget query builder.

Translates a Power-BI/Tableau-style field mapping into a JSON spec that
`engine.query()` can execute, then shapes the resulting rows into a
ChartSpec the existing ECharts renderer (lib/chartTypes.ts) understands.

V1 surface (single-shelf MVP):
    fields = {
        "x":      "<column>",
        "y":      "<column>",
        "agg":    "sum"|"avg"|"count"|"count_distinct"|"min"|"max"|"none",
        "color":  "<column>",        # optional — emits one dataset per series
        "filters": [{col, op, value}],  # optional — passed through as-is
    }
    chart_type in {bar_chart, line_chart, area_chart, pie_chart, donut_chart,
                   scatter_plot, big_number}

The output is always:
    {
        "id":         "<uuid>",
        "type":       "chart",
        "title":      "<provided or derived>",
        "chart_type": "<chart_type>",
        "encoding":   {"x": <col>, "y": <col>, "color"?: <col>},
        "data":       {"labels": [...], "datasets": [{label, data}]},
    }
"""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from .engine import Engine

_VALID_AGGS = {"sum", "avg", "count", "count_distinct", "min", "max", "median", "stdev", "none"}
_VALID_CHART_TYPES = {
    "bar_chart",
    "line_chart",
    "area_chart",
    "pie_chart",
    "donut_chart",
    "scatter_plot",
    "big_number",
    "heatmap",
}

# Phase 8b — calculated fields. Allow only safe SQL expressions: column
# references, basic arithmetic, common aggregates and CASE/COALESCE. We
# parse these as raw strings into the SELECT — DuckDB itself rejects
# anything malformed. The pre-check below blocks the obvious foot-guns
# (subqueries, comments, semicolons, write verbs).
_FORBIDDEN_EXPR_PATTERNS = (
    ";",
    "--",
    "/*",
    "*/",
    " drop ",
    " delete ",
    " insert ",
    " update ",
    " alter ",
    " truncate ",
    " grant ",
    " revoke ",
    " create ",
    " replace ",
    " union ",
    " select ",
    " from ",
)


def validate_expr(expr: str) -> str:
    """Reject calculated-field expressions that look dangerous. Returns a
    cleaned single-line expression on success; raises ValueError on a hit.
    Note: DuckDB still parses + executes the expression, so this is a
    coarse foot-gun guard, not a SQL parser.
    """
    if not isinstance(expr, str) or not expr.strip():
        raise ValueError("expression is required")
    flat = " " + expr.lower().replace("\n", " ").replace("\t", " ") + " "
    for pat in _FORBIDDEN_EXPR_PATTERNS:
        if pat in flat:
            raise ValueError(f"Disallowed token in expression: {pat.strip()!r}")
    return expr.strip()


def _normalize_value(v: Any) -> Any:
    """Cast a single cell value into something JSON-serializable.

    DuckDB / pandas can return numpy scalars, dates, etc. — coerce to native
    Python so FastAPI's encoder doesn't choke and the frontend gets a tidy
    JSON payload.
    """
    if v is None:
        return None
    # Common numpy / pandas types
    try:
        # Avoid importing numpy directly; rely on duck typing.
        if hasattr(v, "item"):
            return v.item()
    except Exception:
        pass
    if hasattr(v, "isoformat"):  # date / datetime / Timestamp
        return v.isoformat()
    return v


def build_chart_spec(
    *,
    engine: Engine,
    user_id: str,
    project_id: str,
    table_name: str,
    fields: Dict[str, Any],
    chart_type: str,
    row_limit: int = 5000,
    title: Optional[str] = None,
) -> Dict[str, Any]:
    """Run the widget query and return a chart spec.

    Raises ValueError on bad inputs and LookupError if the table isn't in
    the user's catalog.
    """
    chart_type = (chart_type or "bar_chart").lower()
    if chart_type not in _VALID_CHART_TYPES:
        raise ValueError(f"Unsupported chart_type: {chart_type!r}")

    # Phase 8 — dispatch to the multi-shelf builder when the caller passes
    # arrays / calculated fields. The single-shelf MVP shape stays below.
    if is_multi_shelf_fields(fields):
        return build_chart_spec_multi(
            engine=engine,
            user_id=user_id,
            project_id=project_id,
            table_name=table_name,
            fields=fields,
            chart_type=chart_type,
            row_limit=row_limit,
            title=title,
        )

    x = fields.get("x")
    y = fields.get("y")
    color = fields.get("color")
    agg = (fields.get("agg") or "none").lower()
    if agg not in _VALID_AGGS:
        raise ValueError(f"Unsupported agg: {agg!r}")

    # big_number is a degenerate case: a single aggregated value, no x dim.
    is_big_number = chart_type == "big_number"
    if not is_big_number and not x:
        raise ValueError("`x` is required for this chart type")

    # Y is OPTIONAL when agg='count' (counting rows → COUNT(*) per group).
    # Every other aggregation needs an explicit column.
    counting_rows = agg == "count" and not y
    if not y and not counting_rows:
        raise ValueError("`y` is required for this aggregation")

    # When counting rows, give the result column a stable alias so the
    # downstream shaper can find it.
    y_alias = y or ("count" if counting_rows else "")

    # Build engine.query spec.
    select: List[Any] = []
    group_by: List[str] = []

    if is_big_number:
        if counting_rows:
            select = [{"col": "", "agg": "count", "alias": "count"}]
        elif agg == "none":
            select = [{"col": y, "alias": y}]
        else:
            select = [{"col": y, "agg": agg, "alias": y}]
    else:
        select.append(x)
        group_by.append(x)
        if color:
            select.append(color)
            group_by.append(color)
        if counting_rows:
            select.append({"col": "", "agg": "count", "alias": "count"})
        elif agg == "none":
            select.append(y)
        else:
            select.append({"col": y, "agg": agg, "alias": y})

    if agg == "none":
        # No GROUP BY when not aggregating (keeps raw values for scatter/line
        # off raw-grain data).
        group_by = []

    spec: Dict[str, Any] = {
        "source": f"{project_id}.{table_name}",
        "select": select,
        "groupBy": group_by,
        "limit": int(row_limit) if row_limit else 5000,
    }

    raw_filters = fields.get("filters")
    if isinstance(raw_filters, list) and raw_filters:
        spec["filters"] = raw_filters

    if not is_big_number and x:
        spec["orderBy"] = [{"col": x, "direction": "asc"}]

    result = engine.query(user_id=user_id, spec=spec)
    rows: List[Dict[str, Any]] = result["rows"]

    # ---- shape into a ChartSpec ------------------------------------------
    spec_id = str(uuid.uuid4())
    # The series label is the aliased column we created above. Display
    # name shown to the user — when counting rows we say "count" instead
    # of an empty string.
    display_y = y_alias or "value"
    encoding: Dict[str, Any] = {"x": x, "y": display_y}
    if color:
        encoding["color"] = color

    if is_big_number:
        value: Any = None
        if rows:
            row = rows[0]
            value = _normalize_value(row.get(y_alias) if y_alias in row else next(iter(row.values())))
        big_title = (
            f"{agg.upper()}({display_y})" if agg != "none"
            else (y or "value")
        )
        return {
            "id": spec_id,
            "type": "chart",
            "title": title or big_title,
            "chart_type": "big_number",
            "encoding": encoding,
            "data": {
                "value": value,
                "labels": [],
                "datasets": [],
            },
        }

    if not color:
        labels = [str(_normalize_value(r.get(x))) for r in rows]
        values = [_normalize_value(r.get(y_alias)) for r in rows]
        datasets = [{"label": display_y, "data": values}]
        return {
            "id": spec_id,
            "type": "chart",
            "title": title or _default_title(chart_type, display_y, x, agg),
            "chart_type": chart_type,
            "encoding": encoding,
            "data": {"labels": labels, "datasets": datasets},
        }

    # Color/series: pivot rows into one dataset per distinct color value.
    label_set: List[Any] = []
    label_index: Dict[Any, int] = {}
    series_index: Dict[Any, Dict[Any, Any]] = {}
    series_order: List[Any] = []

    for r in rows:
        x_val = _normalize_value(r.get(x))
        c_val = _normalize_value(r.get(color))
        y_val = _normalize_value(r.get(y_alias))
        if x_val not in label_index:
            label_index[x_val] = len(label_set)
            label_set.append(x_val)
        if c_val not in series_index:
            series_index[c_val] = {}
            series_order.append(c_val)
        series_index[c_val][x_val] = y_val

    labels = [str(v) for v in label_set]
    datasets = []
    for c_val in series_order:
        bucket = series_index[c_val]
        data = [bucket.get(x_val, None) for x_val in label_set]
        datasets.append({"label": str(c_val), "data": data})

    return {
        "id": spec_id,
        "type": "chart",
        "title": title or _default_title(chart_type, display_y, x, agg),
        "chart_type": chart_type,
        "encoding": encoding,
        "data": {"labels": labels, "datasets": datasets},
    }


def _default_title(chart_type: str, y: str, x: Optional[str], agg: str) -> str:
    label_y = y or ""
    if agg and agg != "none":
        label_y = f"{agg.upper()}({y})"
    if chart_type == "pie_chart" or chart_type == "donut_chart":
        return f"{label_y} by {x}" if x else label_y
    if chart_type == "scatter_plot":
        return f"{y} vs {x}" if x else y
    return f"{label_y} by {x}" if x else label_y


# ---- Phase 8 — multi-shelf builder ----


def is_multi_shelf_fields(fields: Dict[str, Any]) -> bool:
    """Detect the multi-shelf shape: any of x/y/color/filters/calculated is a list."""
    for k in ("x", "y", "color", "filters", "calculated"):
        v = fields.get(k)
        if isinstance(v, list) and v:
            return True
    return False


def build_chart_spec_multi(
    *,
    engine: Engine,
    user_id: str,
    project_id: str,
    table_name: str,
    fields: Dict[str, Any],
    chart_type: str,
    row_limit: int = 5000,
    title: Optional[str] = None,
) -> Dict[str, Any]:
    """Tableau-style: multi-field shelves with optional calculated fields.

    fields = {
      "x":          ["dim1", "dim2", ...],
      "y":          [{"col": "metric", "agg": "sum", "alias?": "..."}, ...],
      "color":      ["series_dim"],     # 0 or 1 supported in V1
      "filters":    [{"col": "...", "op": "eq"|"in"|..., "value": ...}, ...],
      "calculated": [{"name": "...", "expr": "..."}, ...],
    }
    """
    chart_type = (chart_type or "bar_chart").lower()
    if chart_type not in _VALID_CHART_TYPES:
        raise ValueError(f"Unsupported chart_type: {chart_type!r}")

    x_dims: List[str] = [str(s) for s in (fields.get("x") or []) if s]
    y_meas: List[Dict[str, Any]] = list(fields.get("y") or [])
    color_dims: List[str] = [str(s) for s in (fields.get("color") or []) if s]
    raw_filters = fields.get("filters") or []
    calculated: List[Dict[str, Any]] = list(fields.get("calculated") or [])

    # Y is OPTIONAL when X is set — empty Y collapses to COUNT(*) per X group.
    # Only big_number with no measure makes no sense.
    if not y_meas:
        if chart_type == "big_number" and not x_dims:
            raise ValueError("`y` (measures) is required for big_number")
        y_meas = [{"col": "", "agg": "count", "alias": "count"}]
    if chart_type != "big_number" and not x_dims:
        raise ValueError("`x` (dimensions) is required for this chart type")

    # Validate calculated expressions up-front so we don't blow up mid-query.
    calc_select_extras: List[str] = []
    calc_aliases: List[str] = []
    for c in calculated:
        name = (c.get("name") or "").strip()
        expr = (c.get("expr") or "").strip()
        if not name or not expr:
            continue
        if not name.replace("_", "").isalnum():
            raise ValueError(f"Calculated field name must be alphanumeric: {name!r}")
        clean_expr = validate_expr(expr)
        # Build a raw SELECT fragment. The engine's _build_select doesn't
        # support free-form expressions, so we pass them through a side
        # channel: a synthetic dict select item with op="raw".
        calc_select_extras.append(f"({clean_expr}) AS {_q(name)}")
        calc_aliases.append(name)

    # Pure SQL build (skip engine.query so we can inject calculated fields).
    select_parts: List[str] = []
    group_parts: List[str] = []

    for d in x_dims:
        select_parts.append(_q(d))
        group_parts.append(_q(d))
    for cd in color_dims:
        select_parts.append(_q(cd))
        group_parts.append(_q(cd))

    for m in y_meas:
        col = m.get("col") or m.get("column") or ""
        agg = (m.get("agg") or m.get("aggregation") or "none").lower()
        if agg not in _VALID_AGGS:
            raise ValueError(f"Unsupported agg: {agg!r}")
        # `count` is the only agg where an empty col is meaningful — it
        # collapses to COUNT(*). Every other agg needs a real column.
        if agg in ("count", "count_distinct") and not col:
            alias = m.get("alias") or m.get("as") or "count"
            expr_sql = "COUNT(*)"
        else:
            if not col:
                raise ValueError(f"Measure with agg={agg!r} requires a column")
            alias = m.get("alias") or m.get("as") or col
            if agg == "count_distinct":
                expr_sql = f"COUNT(DISTINCT {_q(col)})"
            elif agg == "none":
                expr_sql = _q(col)
            else:
                expr_sql = f"{agg.upper()}({_q(col)})"
        select_parts.append(f"{expr_sql} AS {_q(alias)}")

    select_parts.extend(calc_select_extras)

    # Filters → WHERE clause
    where_clauses: List[str] = []
    where_params: List[Any] = []
    for f in raw_filters or []:
        col = f.get("col") or f.get("column")
        op = (f.get("op") or "=").lower()
        val = f.get("value")
        if not col:
            continue
        if op in ("=", "!=", "<", "<=", ">", ">=", "like", "ilike"):
            where_clauses.append(f"{_q(col)} {op.upper()} ?")
            where_params.append(val)
        elif op in ("eq",):
            where_clauses.append(f"{_q(col)} = ?")
            where_params.append(val)
        elif op == "in" and isinstance(val, list):
            if not val:
                where_clauses.append("FALSE")
            else:
                placeholders = ",".join(["?"] * len(val))
                where_clauses.append(f"{_q(col)} IN ({placeholders})")
                where_params.extend(val)
        elif op == "between" and isinstance(val, list) and len(val) == 2:
            where_clauses.append(f"{_q(col)} BETWEEN ? AND ?")
            where_params.extend(val)
        elif op == "is null":
            where_clauses.append(f"{_q(col)} IS NULL")
        elif op == "is not null":
            where_clauses.append(f"{_q(col)} IS NOT NULL")
        elif op == "contains":
            where_clauses.append(f"{_q(col)} LIKE ?")
            where_params.append(f"%{val}%")
        else:
            raise ValueError(f"Unsupported filter op: {op!r}")

    # We need the parquet path. The engine doesn't expose a "run raw SQL"
    # public API in a tenant-safe way, so we mirror the read_parquet pattern
    # used by Engine.query.
    cat = engine.catalog.get(user_id=user_id, project_id=project_id, table_name=table_name)
    if not cat:
        raise LookupError(f"Table not registered: {project_id}.{table_name}")
    parquet_path = cat["parquet_path"]
    parquet_lit = "'" + str(parquet_path).replace("'", "''") + "'"

    sql_parts: List[str] = ["SELECT", ", ".join(select_parts) or "*", "FROM", f"read_parquet({parquet_lit}) AS t"]
    if where_clauses:
        sql_parts.append("WHERE")
        sql_parts.append(" AND ".join(where_clauses))
    if group_parts:
        sql_parts.append("GROUP BY")
        sql_parts.append(", ".join(group_parts))
    if x_dims:
        sql_parts.append("ORDER BY")
        sql_parts.append(", ".join(_q(d) for d in x_dims))
    sql_parts.append(f"LIMIT {int(row_limit) if row_limit else 5000}")
    sql = " ".join(sql_parts)

    import duckdb as _duckdb
    with _duckdb.connect() as con:
        result = con.execute(sql, where_params).fetch_arrow_table()
    pdf = result.to_pandas()
    rows = pdf.to_dict(orient="records")

    # ---- shape ----------------------------------------------------------
    spec_id = str(uuid.uuid4())
    primary_y = y_meas[0]
    # Resolve alias the same way the SELECT loop above did so we can pluck
    # the value back out of each row by name.
    def _alias_for(m: Dict[str, Any]) -> str:
        col = m.get("col") or m.get("column") or ""
        agg_ = (m.get("agg") or m.get("aggregation") or "none").lower()
        return (
            m.get("alias")
            or m.get("as")
            or (col if col else ("count" if agg_ in ("count", "count_distinct") else "value"))
        )

    y_alias = _alias_for(primary_y)
    primary_x = x_dims[0] if x_dims else None
    primary_color = color_dims[0] if color_dims else None

    encoding: Dict[str, Any] = {"x": primary_x, "y": y_alias}
    if primary_color:
        encoding["color"] = primary_color

    # Reuse the single-shelf shaper for the simple case (1 dim, 1 measure, 0/1 color).
    if chart_type == "big_number":
        value: Any = None
        if rows:
            r0 = rows[0]
            value = _normalize_value(r0.get(y_alias) if y_alias in r0 else next(iter(r0.values())))
        primary_col = primary_y.get("col") or ""
        big_title = (
            f"{(primary_y.get('agg') or '').upper()}({primary_col or '*'})".strip()
        )
        return {
            "id": spec_id, "type": "chart",
            "title": title or big_title,
            "chart_type": "big_number",
            "encoding": encoding,
            "data": {"value": value, "labels": [], "datasets": []},
        }

    if not primary_color:
        # Composite x labels when multiple dimensions are pinned to Columns.
        labels = [
            " · ".join(str(_normalize_value(r.get(d))) for d in x_dims)
            for r in rows
        ]
        # One dataset per measure.
        datasets = []
        for m in y_meas:
            alias = _alias_for(m)
            agg = (m.get("agg") or "none").lower()
            col = m.get("col") or ""
            if agg == "none":
                label = col or alias
            elif not col and agg in ("count", "count_distinct"):
                label = "COUNT(*)"
            else:
                label = f"{agg.upper()}({col})"
            datasets.append({
                "label": label,
                "data": [_normalize_value(r.get(alias)) for r in rows],
            })
        # Calculated fields as additional datasets.
        for name in calc_aliases:
            datasets.append({
                "label": name,
                "data": [_normalize_value(r.get(name)) for r in rows],
            })
        primary_col = primary_y.get("col") or y_alias
        return {
            "id": spec_id, "type": "chart",
            "title": title or f"{primary_col} by {primary_x or '(rows)'}",
            "chart_type": chart_type,
            "encoding": encoding,
            "data": {"labels": labels, "datasets": datasets},
        }

    # Color/series pivot — measure is the single primary y.
    label_set: List[Any] = []
    label_index: Dict[Any, int] = {}
    series_index: Dict[Any, Dict[Any, Any]] = {}
    series_order: List[Any] = []
    for r in rows:
        x_val = " · ".join(str(_normalize_value(r.get(d))) for d in x_dims)
        c_val = _normalize_value(r.get(primary_color))
        y_val = _normalize_value(r.get(y_alias))
        if x_val not in label_index:
            label_index[x_val] = len(label_set)
            label_set.append(x_val)
        if c_val not in series_index:
            series_index[c_val] = {}
            series_order.append(c_val)
        series_index[c_val][x_val] = y_val
    labels = [str(v) for v in label_set]
    datasets = [
        {"label": str(c_val), "data": [series_index[c_val].get(x_val) for x_val in label_set]}
        for c_val in series_order
    ]
    primary_col = primary_y.get("col") or y_alias
    return {
        "id": spec_id, "type": "chart",
        "title": title or f"{primary_col} by {primary_x} ({primary_color})",
        "chart_type": chart_type,
        "encoding": encoding,
        "data": {"labels": labels, "datasets": datasets},
    }


def _q(name: Any) -> str:
    """Quote a SQL identifier safely. (Mirrors engine._q_ident.)"""
    s = str(name or "")
    if not s:
        raise ValueError("identifier must be non-empty")
    return '"' + s.replace('"', '""') + '"'
