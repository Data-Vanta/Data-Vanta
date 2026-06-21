"""
Minimal Python sandbox for thinking-mode code execution.

MVP trust model:
  - The LLM generates code; we execute it in a fresh subprocess with a CPU
    timeout and no network access (via env + a pre-exec AST import check
    against a denylist).
  - The subprocess has a scratch working directory (auto-deleted) and the
    user's data pre-materialized as a Parquet file for the code to read.
  - This is defense-in-depth, not a security boundary. Do not expose to
    untrusted users without additional isolation (e.g. Docker-in-Docker,
    nsjail, or gVisor).

On non-Windows platforms we also apply RLIMIT_AS (address space) and
RLIMIT_CPU via the `resource` module. On Windows we rely on the subprocess
timeout alone.
"""
from __future__ import annotations

import ast
import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

# Modules the LLM is NOT allowed to import. Covers network egress and the
# most common ways to shell out.
IMPORT_DENYLIST = {
    "socket",
    "urllib",
    "urllib.request",
    "urllib.parse",
    "http",
    "http.client",
    "http.server",
    "httpx",
    "requests",
    "aiohttp",
    "websocket",
    "websockets",
    "ftplib",
    "smtplib",
    "poplib",
    "imaplib",
    "telnetlib",
    "xmlrpc",
    "paramiko",
    "ctypes",
    "subprocess",
    "multiprocessing",
    "pty",
    "pdb",
    "importlib.metadata",  # prevents package introspection tricks
    "pip",
}

# Safe output limit — 64KB per stream. Anything larger is a signal the code
# is broken, not doing analytics.
MAX_OUTPUT_BYTES = 64 * 1024
DEFAULT_TIMEOUT_SECONDS = 20


@dataclass
class SandboxResult:
    ok: bool
    stdout: str
    stderr: str
    return_code: int
    # Any extra JSON payload the code wrote to `OUTPUT_JSON_PATH`.
    result_json: Optional[dict] = None
    # Paths to any PNGs the code wrote into the scratch dir.
    chart_paths: list[str] = field(default_factory=list)
    duration_ms: int = 0
    error: Optional[str] = None


class Sandbox:
    """A single-use scratch directory + subprocess runner.

    Use as a context manager so the scratch dir is cleaned up even when
    the run throws.
    """

    def __init__(
        self,
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
        persistent_dir: Optional[Path] = None,
    ):
        self.timeout = timeout_seconds
        self._scratch: Optional[str] = None
        # When set, this directory is used in place of a tempfile.mkdtemp
        # scratch and is NOT wiped on __exit__ — the caller owns cleanup
        # so chart PNGs / result JSON survive past the run.
        self._persistent_dir: Optional[Path] = persistent_dir
        self._persistent: bool = persistent_dir is not None

    # ---------- lifecycle ----------

    def __enter__(self) -> "Sandbox":
        if self._persistent_dir is not None:
            self._persistent_dir.mkdir(parents=True, exist_ok=True)
            self._scratch = str(self._persistent_dir)
        else:
            self._scratch = tempfile.mkdtemp(prefix="vanta-sb-")
        return self

    def __exit__(self, *exc):
        if self._persistent:
            # Caller owns this directory; leave artifacts on disk so the
            # GET-route can serve them. Just drop our reference.
            self._scratch = None
            return
        if self._scratch and os.path.isdir(self._scratch):
            shutil.rmtree(self._scratch, ignore_errors=True)
        self._scratch = None

    # ---------- helpers ----------

    @property
    def scratch(self) -> str:
        if not self._scratch:
            raise RuntimeError("Sandbox not entered")
        return self._scratch

    def write_parquet(self, name: str, rows: list[dict]) -> str:
        """
        Write `rows` to a Parquet file inside the sandbox. Returns the path.
        The LLM-generated code reads this via pandas.read_parquet.
        """
        import pandas as pd

        path = os.path.join(self.scratch, name)
        df = pd.DataFrame(rows)
        df.to_parquet(path, index=False)
        return path

    # ---------- import check ----------

    @staticmethod
    def _check_imports(code: str) -> Optional[str]:
        try:
            tree = ast.parse(code)
        except SyntaxError as e:
            return f"SyntaxError: {e.msg} (line {e.lineno})"

        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    base = alias.name.split(".")[0]
                    if alias.name in IMPORT_DENYLIST or base in IMPORT_DENYLIST:
                        return f"Import '{alias.name}' is not allowed in the sandbox."
            elif isinstance(node, ast.ImportFrom):
                mod = node.module or ""
                base = mod.split(".")[0]
                if mod in IMPORT_DENYLIST or base in IMPORT_DENYLIST:
                    return f"Import from '{mod}' is not allowed in the sandbox."
        return None

    # ---------- execute ----------

    def run(
        self,
        code: str,
        data_path: Optional[str] = None,
        alias_paths: Optional[dict] = None,
    ) -> SandboxResult:
        """
        Execute `code` in a subprocess inside the sandbox. `data_path`, if
        given, is injected as the `VANTA_DATA_PATH` env var so the code can
        read the primary dataframe.

        `alias_paths` (Phase 7b) is an optional `{alias: parquet_path}` map;
        the sandbox preamble exposes `df_for(alias)` that lazy-loads the
        Parquet at the matching path. Use this when the chat has multiple
        attachments and the agent needs to switch between them.
        """
        import time

        reject = self._check_imports(code)
        if reject:
            return SandboxResult(
                ok=False,
                stdout="",
                stderr=reject,
                return_code=-1,
                error=reject,
            )

        # Wrap the user code: define helpers, expose OUTPUT_JSON_PATH, auto-
        # save any remaining matplotlib figures into the scratch dir.
        wrapped = self._wrap(code)
        script_path = os.path.join(self.scratch, "__run.py")
        output_json_path = os.path.join(self.scratch, "__output.json")
        with open(script_path, "w", encoding="utf-8") as f:
            f.write(wrapped)

        env = os.environ.copy()
        # Kill network egress routes as best-effort.
        env["HTTP_PROXY"] = "http://127.0.0.1:1"
        env["HTTPS_PROXY"] = "http://127.0.0.1:1"
        env["NO_PROXY"] = ""
        env["VANTA_DATA_PATH"] = data_path or ""
        env["VANTA_OUTPUT_JSON"] = output_json_path
        env["VANTA_SCRATCH"] = self.scratch
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        if alias_paths:
            # Pass the alias -> parquet path map as a JSON env var. The
            # sandbox preamble parses it once and exposes `df_for(alias)`.
            import json as _json_env
            env["VANTA_ALIAS_PATHS"] = _json_env.dumps(alias_paths, default=str)

        preexec = None
        if sys.platform != "win32":
            try:
                import resource  # Unix-only

                def _limits():
                    # Address space: 2 GB
                    resource.setrlimit(resource.RLIMIT_AS, (2 * 1024 ** 3, 2 * 1024 ** 3))
                    # CPU time equal to wall-clock timeout (subprocess enforces wall).
                    resource.setrlimit(resource.RLIMIT_CPU, (self.timeout, self.timeout))

                preexec = _limits
            except ImportError:  # pragma: no cover
                preexec = None

        started = time.time()
        try:
            proc = subprocess.run(
                [sys.executable, script_path],
                cwd=self.scratch,
                env=env,
                capture_output=True,
                timeout=self.timeout,
                preexec_fn=preexec,
            )
            duration_ms = int((time.time() - started) * 1000)
            stdout = proc.stdout.decode("utf-8", errors="replace")[:MAX_OUTPUT_BYTES]
            stderr = proc.stderr.decode("utf-8", errors="replace")[:MAX_OUTPUT_BYTES]

            result_json = None
            if os.path.isfile(output_json_path):
                try:
                    with open(output_json_path, "r", encoding="utf-8") as f:
                        result_json = json.load(f)
                except Exception:
                    result_json = None

            chart_paths = sorted(
                os.path.join(self.scratch, f)
                for f in os.listdir(self.scratch)
                if f.lower().endswith((".png", ".jpg", ".jpeg", ".svg"))
                and not f.startswith("__")
            )

            return SandboxResult(
                ok=proc.returncode == 0,
                stdout=stdout,
                stderr=stderr,
                return_code=proc.returncode,
                result_json=result_json,
                chart_paths=chart_paths,
                duration_ms=duration_ms,
            )
        except subprocess.TimeoutExpired:
            return SandboxResult(
                ok=False,
                stdout="",
                stderr=f"Execution exceeded {self.timeout}s timeout.",
                return_code=-1,
                duration_ms=int((time.time() - started) * 1000),
                error="timeout",
            )
        except Exception as e:  # pragma: no cover
            return SandboxResult(
                ok=False,
                stdout="",
                stderr=str(e),
                return_code=-1,
                error=str(e),
            )

    # ---------- wrapper ----------

    @staticmethod
    def _wrap(user_code: str) -> str:
        preamble = textwrap.dedent(
            """
            import os
            import json
            import traceback

            # Auto-load the dataframe if the caller provided one.
            DATA_PATH = os.environ.get("VANTA_DATA_PATH") or ""
            OUTPUT_JSON = os.environ.get("VANTA_OUTPUT_JSON") or ""
            df = None
            try:
                if DATA_PATH and os.path.isfile(DATA_PATH):
                    import pandas as pd
                    df = pd.read_parquet(DATA_PATH)
            except Exception as _e:
                print(f"[vanta] failed to load data: {_e!r}")

            # Multi-source helper. `df_for("alias")` lazily reads the parquet
            # at the configured path for that alias. Cached per-process.
            _ALIAS_PATHS = {}
            try:
                _alias_raw = os.environ.get("VANTA_ALIAS_PATHS") or ""
                if _alias_raw:
                    _ALIAS_PATHS = json.loads(_alias_raw)
            except Exception as _e:
                print(f"[vanta] failed to parse alias paths: {_e!r}")
            _ALIAS_DF_CACHE = {}

            def df_for(alias):
                # Load (and cache) a DataFrame by its attachment alias.
                # Returns None if the alias is not configured or the file
                # is unreadable.
                if alias in _ALIAS_DF_CACHE:
                    return _ALIAS_DF_CACHE[alias]
                path = _ALIAS_PATHS.get(alias)
                if not path or not os.path.isfile(path):
                    print(f"[vanta] df_for({alias!r}): no parquet at {path!r}")
                    return None
                try:
                    import pandas as pd
                    out = pd.read_parquet(path)
                    _ALIAS_DF_CACHE[alias] = out
                    return out
                except Exception as _e:
                    print(f"[vanta] df_for({alias!r}) failed: {_e!r}")
                    return None

            # Suppress matplotlib's "FigureCanvasAgg is non-interactive"
            # UserWarning that the LLM's plt.show() pattern emits.
            #
            # Three belt+suspenders moves: (1) MPLBACKEND env hits matplotlib
            # before its first import so the backend is picked without
            # falling through any interactive guesswork; (2) global warning
            # filter swallows UserWarning anyway; (3) plt.show is monkey-
            # patched to a no-op so even Agg's noisy show() never runs.
            import os as _os
            _os.environ["MPLBACKEND"] = "Agg"
            import warnings as _warnings
            _warnings.filterwarnings("ignore")
            try:
                import matplotlib
                matplotlib.use("Agg")
                try:
                    import matplotlib.pyplot as _plt
                    _plt.show = lambda *a, **k: None
                except Exception:
                    pass
            except Exception:
                pass

            def _save_result(payload):
                if not OUTPUT_JSON:
                    return
                try:
                    with open(OUTPUT_JSON, "w", encoding="utf-8") as _f:
                        json.dump(payload, _f, default=str)
                except Exception as _e:
                    print(f"[vanta] failed to save result: {_e!r}")

            # Convenience: `result(x)` ships back to the agent as structured JSON.
            result = _save_result
            """
        ).strip()

        footer = textwrap.dedent(
            """
            # Save every remaining matplotlib figure as PNG.
            try:
                import matplotlib.pyplot as plt
                for _i, _fig in enumerate(plt.get_fignums()):
                    plt.figure(_fig).savefig(os.path.join(os.environ.get("VANTA_SCRATCH", "."), f"chart_{_i}.png"), dpi=120, bbox_inches="tight")
            except Exception:
                pass
            """
        ).strip()

        # Wrap the user's code in a hint-on-failure handler. When KeyError
        # / AttributeError fires (LLM hallucinated a column name), append
        # the actual df columns + dtypes so the next agent step has the
        # info it needs to self-correct without another diagnostic round
        # trip. Also catches the common pandas "['col'] not in index" path.
        return (
            f"{preamble}\n\n"
            "try:\n"
            f"{textwrap.indent(user_code, '    ')}\n"
            "except (KeyError, AttributeError) as _e:\n"
            "    traceback.print_exc()\n"
            "    try:\n"
            "        if df is not None:\n"
            "            print()\n"
            "            print('[vanta] hint: available columns ->', list(df.columns))\n"
            "            print('[vanta] hint: dtypes ->')\n"
            "            print(df.dtypes.to_string())\n"
            "    except Exception:\n"
            "        pass\n"
            "except Exception as _e:\n"
            "    traceback.print_exc()\n"
            "\n"
            f"{footer}\n"
        )
