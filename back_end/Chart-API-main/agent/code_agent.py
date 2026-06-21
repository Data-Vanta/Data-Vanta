"""
Thinking-mode agent loop.

Given a user prompt + a dataframe, run an LLM tool-calling loop where the
model can:
  1. `run_python(code, thought)` — execute pandas/matplotlib code in the
     sandbox and see the stdout + any returned JSON.
  2. `final_answer(answer)` — emit the final natural-language response.

The loop is capped at MAX_STEPS to keep costs and latency bounded.

`run_code_agent` is an async generator yielding SSE-style events:

    {"type": "thought", "text": str}
    {"type": "code", "code": str}
    {"type": "stdout", "text": str}
    {"type": "stderr", "text": str}
    {"type": "chart", "path": str, "data_url": str|None}
    {"type": "result", "text": str}         # final answer
    {"type": "error", "message": str}       # fatal error
    {"type": "done"}                        # always last
"""
from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncGenerator, Optional

from openai import AsyncOpenAI

from .sandbox import Sandbox
from .tool_schemas import TOOLS

MAX_STEPS = 6


@dataclass
class AgentContext:
    """Per-call context the agent needs to reason over the user's data."""
    prompt: str
    rows: list[dict]                 # up to ~10k rows already fetched from lakehouse
    schema: list[dict]               # [{name, type, nullable}, ...]
    table_name: str
    system_prompt: Optional[str] = None   # per-chat
    memories: Optional[list[str]] = None  # global memory content strings
    # Phase 7 — live sources the agent can query directly via run_sql.
    live_sources: Optional[list[dict]] = None   # [{connector_id, alias, type}]
    auth_token: Optional[str] = None            # forwarded for /connectors/:id/sql
    # Phase 7b — extra ingested sources beyond the primary. Each entry:
    # {"alias": str, "rows": list[dict], "schema": list[dict],
    #  "table_name": str (for prompt context)}.
    extra_sources: Optional[list[dict]] = None


def _build_system_message(
    ctx: AgentContext,
    sources: Optional[list[dict]] = None,
) -> str:
    schema_block = "\n".join(
        f"  - {c.get('name')}: {c.get('type')}"
        for c in (ctx.schema or [])[:50]
    )
    sample = ctx.rows[:5]
    sample_json = json.dumps(sample, default=str)[:2000]

    parts = [
        "You are Vanta, a data analyst that reasons by writing small Python snippets.",
        "A pandas DataFrame called `df` is pre-loaded with the user's data.",
        f"Table name: {ctx.table_name}",
        "Schema:",
        schema_block or "  (empty)",
        f"Sample rows (first 5, JSON): {sample_json}",
    ]

    # D3: surface the chat's attached sources by alias so the LLM can refer
    # to them by name (e.g. "the Q3 sales table"). For D3 only the first
    # source is actually loaded into `df`; multi-source df_for(alias)
    # loading is future work.
    #
    # Suppress the block for the single-source fallback path with no real
    # alias (i.e. the FE didn't seed an attachment) so the legacy prompt
    # stays byte-identical to pre-D3 and doesn't drift in low-info chats.
    informative_sources = [
        s for s in (sources or [])
        if s.get("alias") and s.get("alias") != f"{s.get('project_id') or ''}.{s.get('table_name') or ''}"
    ]
    show_block = bool(sources) and (len(sources) > 1 or len(informative_sources) > 0)
    if show_block:
        parts.append("")
        parts.append("Available data sources:")
        for s in sources:
            project_id = s.get("project_id") or ""
            table_name = s.get("table_name") or ""
            alias = s.get("alias") or f"{project_id}.{table_name}"
            parts.append(f"- {alias}: {project_id}.{table_name}")
        parts.append(
            "(Only the first source is currently pre-loaded as `df`; "
            "the rest are listed for reference.)"
        )

    parts.extend([
        "",
        "Plan: 1) run short, focused pandas snippets, 2) inspect stdout,",
        "3) iterate if needed, 4) call `final_answer` with a crisp summary.",
        "Prefer charts via matplotlib (plt.plot, plt.bar, etc.) when a shape",
        "would help. Figures are auto-saved as PNGs and returned inline —",
        "do NOT call plt.show(); just plt.savefig is enough.",
        "Never import socket/requests/urllib/subprocess.",
        "",
        "STRICT — column names:",
        "- Use ONLY the columns listed in the Schema block above. Do NOT",
        "  invent columns like 'revenue', 'sales', 'profit' unless the",
        "  schema names them. If you need a derived metric, COMPUTE it",
        "  from existing columns in your snippet (e.g. revenue =",
        "  quantity * unit_price) — don't assume it's pre-computed.",
        "- If you're unsure, your FIRST run_python should be diagnostic:",
        "  `print(df.columns.tolist()); print(df.head(3))`. Then proceed",
        "  with confidence using actual names.",
        "- A KeyError from a column you guessed is a wasted step. The",
        "  sandbox prints `[vanta] hint: available columns -> [...]`",
        "  after a KeyError; use that list verbatim in your next snippet.",
        "",
        "IMPORTANT — `final_answer` etiquette:",
        "- Be concise. The user already sees the stdout from your run_python",
        "  calls and the inline chart images. Do NOT echo numbers or",
        "  filenames the script already printed. Do NOT restate the chart's",
        "  obvious contents. Add only NEW insight (interpretation, trend,",
        "  recommendation). One short paragraph or a tight bullet list.",
        "- Call `final_answer` exactly ONCE per request.",
    ])

    if ctx.extra_sources:
        parts.append("")
        parts.append(
            "Additional dataframes (call df_for(\"alias\") inside run_python):"
        )
        for src in ctx.extra_sources[:8]:
            alias = src.get("alias") or "(unnamed)"
            tname = src.get("table_name") or alias
            sch = "\n".join(
                f"      - {c.get('name')}: {c.get('type')}"
                for c in (src.get("schema") or [])[:30]
            )
            sample = json.dumps((src.get("rows") or [])[:3], default=str)[:600]
            parts.append(f"  - alias={alias!r} (table={tname})")
            if sch:
                parts.append(f"    schema:\n{sch}")
            if sample and sample != "[]":
                parts.append(f"    sample (first 3): {sample}")

    if ctx.live_sources:
        parts.append("")
        parts.append(
            "Live data sources (call run_sql with connector_id + read-only SQL):"
        )
        for ls in ctx.live_sources[:8]:
            cid = ls.get("connector_id") or ls.get("id") or ""
            alias = ls.get("alias") or ls.get("name") or "(unnamed)"
            type_ = ls.get("type") or "unknown"
            parts.append(f"  - alias={alias} | type={type_} | connector_id={cid}")
        parts.append(
            "  Use run_sql ONLY when the user's question requires live or "
            "fresh data not present in df. Wrap results into a DataFrame "
            "via run_python after the call."
        )

    if ctx.memories:
        parts.append("")
        parts.append("Persistent user context (memories):")
        parts.extend(f"- {m}" for m in ctx.memories[:20])

    if ctx.system_prompt:
        parts.append("")
        parts.append("Session instructions from the user:")
        parts.append(ctx.system_prompt)

    return "\n".join(parts)


def _png_to_data_url(path: str) -> Optional[str]:
    try:
        with open(path, "rb") as f:
            b = base64.b64encode(f.read()).decode("ascii")
        return f"data:image/png;base64,{b}"
    except Exception:
        return None


async def _call_run_sql(*, connector_id: str, sql: str, auth_token: str) -> dict:
    """Call the user-auth gateway's /connectors/:id/sql endpoint.

    We go through user-auth (not Chart-API directly) so the credential
    decryption + per-user authz checks live in one place. Returns the
    {columns, rows} payload or raises.
    """
    if not connector_id:
        raise ValueError("connector_id is required")
    if not auth_token:
        raise ValueError("auth_token missing — cannot resolve connector")
    import httpx as _httpx
    base = os.environ.get("USER_AUTH_INTERNAL_URL", "http://localhost:5000")
    url = f"{base}/api/v1/connectors/{connector_id}/sql"
    async with _httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            url,
            headers={
                "Content-Type": "application/json",
                "x-auth-token": auth_token,
            },
            json={"sql": sql, "rowLimit": 10000, "timeoutSec": 10},
        )
    if r.status_code >= 400:
        try:
            body = r.json()
            msg = body.get("message") or body.get("detail") or r.text
        except Exception:
            msg = r.text
        raise RuntimeError(f"user-auth {r.status_code}: {msg}")
    body = r.json()
    return body.get("data") or body


async def run_code_agent(
    ctx: AgentContext,
    client: AsyncOpenAI,
    model: str,
    *,
    run_id: str,
    persistent_dir: Path,
    sources: Optional[list[dict]] = None,
) -> AsyncGenerator[dict, None]:
    """
    Run the agent loop. Yields events (see module docstring) until the model
    calls final_answer, runs out of steps, or errors.

    Artifacts (`step_N.py`, chart PNGs, `result.md`) are written into
    `persistent_dir`; SSE events carry `run_id` and the artifact's path
    relative to that directory so callers can build download URLs later.

    `sources` is an optional list of {project_id, table_name, alias} dicts
    representing the chat's attached data sources. When supplied, the
    system prompt lists them so the LLM can reference each by alias.
    For D3, only the first source is pre-loaded as `df`; multi-source
    df_for(alias) loading is future work.
    """
    messages: list[dict] = [
        {"role": "system", "content": _build_system_message(ctx, sources)},
        {"role": "user", "content": ctx.prompt},
    ]

    with Sandbox(persistent_dir=persistent_dir) as sb:
        # Pre-materialize the primary dataframe + every extra source so the
        # sandbox can mmap each via VANTA_DATA_PATH and df_for(alias).
        data_path: Optional[str] = None
        alias_paths: dict[str, str] = {}
        try:
            if ctx.rows:
                data_path = sb.write_parquet("data.parquet", ctx.rows)
            for src in ctx.extra_sources or []:
                alias = src.get("alias")
                rows = src.get("rows") or []
                if not alias or not rows:
                    continue
                # Sanitize alias to a safe filename. Sandbox.write_parquet
                # expects a basename; underscores avoid path traversal.
                fname = "alias_" + "".join(
                    ch if ch.isalnum() or ch in "_-" else "_" for ch in alias
                )[:80] + ".parquet"
                alias_paths[alias] = sb.write_parquet(fname, rows)
        except Exception as e:
            yield {"type": "error", "message": f"Failed to prepare data: {e!r}"}
            yield {"type": "done"}
            return

        for step in range(MAX_STEPS):
            try:
                # max_tokens cap keeps us inside the "free / low credit"
                # envelope on OpenRouter. Frontier models default to a
                # 65 k output budget which blows through $ quickly and
                # hard-fails 402 on free accounts.
                resp = await client.chat.completions.create(
                    model=model,
                    messages=messages,
                    tools=TOOLS,
                    tool_choice="auto",
                    temperature=0.2,
                    max_tokens=4000,
                )
            except Exception as e:
                yield {"type": "error", "message": f"LLM error: {e!r}"}
                yield {"type": "done"}
                return

            msg = resp.choices[0].message
            tool_calls = getattr(msg, "tool_calls", None) or []

            # Bookkeeping — include assistant message in history.
            messages.append({
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in tool_calls
                ],
            })

            if not tool_calls:
                # Model answered without invoking tools — treat its content
                # as the final answer.
                answer = msg.content or ""
                try:
                    (persistent_dir / "result.md").write_text(answer, encoding="utf-8")
                except Exception:
                    # Disk-write failures shouldn't kill the stream; the
                    # caller can still rely on the inline `text` field.
                    pass
                yield {
                    "type": "result",
                    "text": answer,
                    "run_id": run_id,
                    "path": "result.md",
                }
                yield {"type": "done"}
                return

            for tc in tool_calls:
                name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}

                if name == "final_answer":
                    answer = args.get("answer") or ""
                    try:
                        (persistent_dir / "result.md").write_text(answer, encoding="utf-8")
                    except Exception:
                        pass
                    yield {
                        "type": "result",
                        "text": answer,
                        "run_id": run_id,
                        "path": "result.md",
                    }
                    yield {"type": "done"}
                    return

                if name == "run_python":
                    code = args.get("code") or ""
                    thought = args.get("thought") or ""

                    # Persist the submitted snippet so artifact downloads
                    # in later phases can retrieve the exact code the LLM
                    # ran for this step.
                    step_path = persistent_dir / f"step_{step}.py"
                    try:
                        step_path.write_text(code, encoding="utf-8")
                    except Exception:
                        # Don't kill the stream over a disk hiccup; the
                        # `code` field still carries the inline source.
                        pass

                    if thought:
                        yield {"type": "thought", "text": thought}
                    yield {
                        "type": "code",
                        "code": code,
                        "thought": thought,
                        "run_id": run_id,
                        "path": step_path.name,
                    }

                    sb_result = sb.run(
                        code,
                        data_path=data_path,
                        alias_paths=alias_paths or None,
                    )

                    if sb_result.stdout:
                        yield {"type": "stdout", "text": sb_result.stdout}
                    if sb_result.stderr:
                        yield {"type": "stderr", "text": sb_result.stderr}

                    # Emit any generated chart as a data URL so the frontend
                    # can render it inline without an extra fetch. The
                    # persisted relative path lets later phases serve the
                    # PNG via a GET-route instead of resending base64.
                    for path in sb_result.chart_paths:
                        data_url = _png_to_data_url(path)
                        try:
                            rel = str(Path(path).relative_to(persistent_dir))
                        except ValueError:
                            # Sandbox should always write into the
                            # persistent dir, but fall back to basename
                            # if some future change moves files around.
                            rel = os.path.basename(path)
                        yield {
                            "type": "chart",
                            "path": rel,
                            "data_url": data_url,
                            "run_id": run_id,
                        }

                    # Feed the tool result back into the conversation so the
                    # model can decide what to do next.
                    tool_msg = {
                        "stdout": sb_result.stdout,
                        "stderr": sb_result.stderr,
                        "return_code": sb_result.return_code,
                        "result_json": sb_result.result_json,
                        "charts": [os.path.basename(p) for p in sb_result.chart_paths],
                        "duration_ms": sb_result.duration_ms,
                    }
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": json.dumps(tool_msg, default=str)[:12000],
                    })
                    continue

                if name == "run_sql":
                    connector_id = args.get("connector_id") or ""
                    sql = args.get("sql") or ""
                    thought = args.get("thought") or ""
                    if thought:
                        yield {"type": "thought", "text": thought}

                    # Resolve through user-auth so the same encrypted-cred
                    # path (and validateAuth check) gates this call. A
                    # missing or stale auth_token surfaces as a tool error
                    # the model can read and recover from.
                    try:
                        sql_result = await _call_run_sql(
                            connector_id=connector_id,
                            sql=sql,
                            auth_token=ctx.auth_token or "",
                        )
                        yield {
                            "type": "stdout",
                            "text": (
                                f"[run_sql] {len(sql_result.get('rows', []))} "
                                f"rows from {connector_id}"
                            ),
                        }
                    except Exception as e:
                        sql_result = {"error": str(e)}
                        yield {"type": "stderr", "text": f"run_sql failed: {e}"}

                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": json.dumps(sql_result, default=str)[:12000],
                    })
                    continue

                # Unknown tool
                yield {
                    "type": "stderr",
                    "text": f"Model invoked unknown tool '{name}'.",
                }
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps({"error": f"unknown tool '{name}'"}),
                })

        # Step cap exhausted.
        yield {
            "type": "error",
            "message": f"Step limit ({MAX_STEPS}) reached without final_answer.",
        }
        yield {"type": "done"}
