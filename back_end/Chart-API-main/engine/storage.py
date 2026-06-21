"""
Filesystem layout for the local-disk warehouse.

  {root}/warehouse/{user_id}/{project_id}/{table_name}.parquet

`root` is resolved from DUCKDB_WAREHOUSE_PATH (default ./data). All
paths are sanitised — user/project/table IDs go through a strict regex
filter so a malicious table name can't climb out of its directory.
"""
from __future__ import annotations

import os
import re
import shutil
from pathlib import Path

_ID_RE = re.compile(r"^[A-Za-z0-9_-][A-Za-z0-9_\- .]{0,120}$")


class Storage:
    def __init__(self, root: str | os.PathLike | None = None):
        # Env wins if set; otherwise the process CWD gets a ./data sibling.
        self.root = Path(root or os.environ.get("DUCKDB_WAREHOUSE_PATH") or "./data").resolve()
        self.warehouse = self.root / "warehouse"
        self.warehouse.mkdir(parents=True, exist_ok=True)

    # ---------- safety ----------

    @staticmethod
    def _safe(component: str, field: str) -> str:
        if not isinstance(component, str) or not _ID_RE.match(component):
            raise ValueError(f"Invalid {field}: {component!r}")
        # Normalise .. / leading dots etc. already blocked by the regex above.
        return component

    # ---------- path resolution ----------

    def table_path(self, user_id: str, project_id: str, table_name: str) -> Path:
        u = self._safe(user_id, "user_id")
        p = self._safe(project_id, "project_id")
        t = self._safe(table_name, "table_name")
        project_dir = self.warehouse / u / p
        project_dir.mkdir(parents=True, exist_ok=True)
        return project_dir / f"{t}.parquet"

    def exists(self, user_id: str, project_id: str, table_name: str) -> bool:
        return self.table_path(user_id, project_id, table_name).is_file()

    def delete(self, user_id: str, project_id: str, table_name: str) -> bool:
        p = self.table_path(user_id, project_id, table_name)
        if p.is_file():
            p.unlink()
            return True
        return False

    def project_dir(self, user_id: str, project_id: str) -> Path:
        u = self._safe(user_id, "user_id")
        p = self._safe(project_id, "project_id")
        return self.warehouse / u / p

    def wipe_user(self, user_id: str) -> None:
        """Dev/test helper. Deletes every file for a user. Not exposed via API."""
        u = self._safe(user_id, "user_id")
        path = self.warehouse / u
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)


def runs_dir(user_id: str, run_id: str) -> Path:
    """User-scoped artifact directory for a thinking-mode run.

    Layout: {root}/runs/{user_id}/{run_id}/

    Mirrors the warehouse layout but lives in a sibling 'runs' tree
    so artifact deletion never touches user data parquet files. The
    root is resolved from DUCKDB_WAREHOUSE_PATH (default ./data) —
    the same source Storage uses for its warehouse base.

    Returns the directory after ensuring it exists. The id segments
    pass through Storage._safe, so traversal-style values raise
    ValueError before any path is touched.
    """
    safe_user = Storage._safe(user_id, "user_id")
    safe_run = Storage._safe(run_id, "run_id")
    root = Path(os.environ.get("DUCKDB_WAREHOUSE_PATH") or "./data").resolve()
    p = root / "runs" / safe_user / safe_run
    p.mkdir(parents=True, exist_ok=True)
    return p
