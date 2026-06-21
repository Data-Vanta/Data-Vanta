"use client";
import { useEffect, useRef, useState } from "react";
import Markdown from "./Markdown";

/**
 * Thinking-mode streaming chat panel.
 *
 * Consumes the SSE stream from Chart-API `/execute-code-prompt` and renders
 * events as they arrive: thought → code → stdout → chart → result.
 *
 * The parent supplies the trigger — when `request` flips to a new value,
 * the stream starts. Set it back to `null` to cancel.
 */

// G2: per-event download helpers. Code → step.py blob, result → result.md
// blob, chart → chart.png blob extracted from the inline data_url. B9 was
// deferred so data_url stays inline on every chart event (live + persisted),
// which means the chart download can rely on it without a network round-trip.
function downloadBlob(filename: string, blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function downloadText(filename: string, text: string, mime: string) {
    downloadBlob(filename, new Blob([text], { type: mime }));
}

function dataUrlToBlob(dataUrl: string): Blob | null {
    const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
    if (!m) return null;
    const [, type, b64] = m;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
}

// D3: Attachment payload mirrors Chart-API's `Attachment` Pydantic model.
// `project_id`/`table_name` are present for connector-table sources;
// `file_id` is present for file sources (forward-compat — Chart-API
// doesn't yet resolve file_id server-side).
export type ThinkingAttachment =
    | { kind: 'file'; file_id: string; alias?: string }
    | { kind: 'connector_table'; project_id: string; table_name: string; alias?: string }
    | { kind: 'connector_live'; connector_id: string; connector_type?: string; alias?: string };

export interface ThinkingRequest {
    prompt: string;
    project_id: string;
    table_name: string;
    model_id?: string | null;
    system_prompt?: string | null;
    memories?: string[] | null;
    attachments?: ThinkingAttachment[];
}

// B2 added `run_id` to every SSE event payload. Surface it as optional on
// each variant so the parent's onDone(run) callback can pull it without a
// type assertion.
// Exported (B8) so the chat page's persisted-message types can stay in
// sync without duplicating the union.
export type ThinkingEvent =
    | { type: "ready"; table: string; rows: number; columns: number; model: string; run_id?: string }
    | { type: "thought"; text: string; run_id?: string }
    | { type: "code"; code: string; run_id?: string }
    | { type: "stdout"; text: string; run_id?: string }
    | { type: "stderr"; text: string; run_id?: string }
    | { type: "chart"; path: string; data_url?: string | null; run_id?: string }
    | { type: "result"; text: string; run_id?: string }
    | { type: "error"; message: string; run_id?: string }
    | { type: "done"; run_id?: string };
type Event = ThinkingEvent;

export default function ThinkingStream({
    request,
    events: replayEvents,
    onDone,
}: {
    request: ThinkingRequest | null;
    /**
     * Static replay mode (B8): when provided AND `request` is null, render
     * these pre-built events without firing any SSE / fetch. Used when
     * hydrating thinking-mode messages from `metadata.thinking.events` on
     * session reload. Live runs (request != null) ignore this prop.
     */
    events?: Event[];
    /**
     * Called once the stream finishes (SSE `done`, HTTP error, or fetch throw).
     * Receives a run summary the parent can persist (B7). `null` when the
     * stream failed before any `result` event landed.
     */
    onDone?: (run: { runId?: string; result?: string; events: Event[] } | null) => void;
}) {
    const [events, setEvents] = useState<Event[]>([]);
    const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
    const [meta, setMeta] = useState<{ rows: number; columns: number; model: string } | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Static replay (B8): when no live request but events were supplied by
    // the parent (from persisted metadata.thinking.events), seed local state
    // and skip the SSE flow entirely. Runs whenever the replay payload
    // changes (e.g., user switches to a different reloaded session).
    useEffect(() => {
        if (request) return;
        if (!replayEvents || replayEvents.length === 0) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setEvents(replayEvents);
        const ready = replayEvents.find((e) => e.type === "ready") as
            | Extract<Event, { type: "ready" }>
            | undefined;
        setMeta(ready ? { rows: ready.rows, columns: ready.columns, model: ready.model } : null);
        setStatus("done");
    }, [request, replayEvents]);

    useEffect(() => {
        if (!request) return;

        // Reset for new request. The react-hooks/set-state-in-effect rule
        // fires here as a heuristic, but the reset is correct: the effect is
        // a canonical subscribe-on-request-change (kick off the SSE stream),
        // and the prior run's UI must clear before new events arrive.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setEvents([]);
        setMeta(null);
        setStatus("running");

        const controller = new AbortController();
        abortRef.current = controller;

        // Local mirror of the events array so onDone can read the full list
        // synchronously. setEvents is async and the closure here would
        // otherwise observe stale state when the `done` event arrives.
        const accumulated: Event[] = [];
        // Track the latest run_id seen on any event (B2 stamps run_id on every
        // SSE event, including `done`). Fallback for streams where the result
        // event was missing but a run_id still made it through.
        let latestRunId: string | undefined;

        (async () => {
            try {
                const chartUrl =
                    process.env.NEXT_PUBLIC_CHART_API_URL || "http://127.0.0.1:8000";
                const token = localStorage.getItem("authToken") || "";
                const res = await fetch(`${chartUrl}/execute-code-prompt`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(token ? { "x-auth-token": token } : {}),
                    },
                    body: JSON.stringify(request),
                    signal: controller.signal,
                });

                if (!res.ok || !res.body) {
                    const text = await res.text().catch(() => "");
                    const errEvt: Event = {
                        type: "error",
                        message: `HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`,
                    };
                    accumulated.push(errEvt);
                    setEvents((prev) => [...prev, errEvt]);
                    setStatus("error");
                    onDone?.(null);
                    return;
                }

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buf = "";
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buf += decoder.decode(value, { stream: true });
                    // SSE framing is "data: <json>\n\n"
                    const parts = buf.split("\n\n");
                    buf = parts.pop() || "";
                    for (const part of parts) {
                        const line = part.split("\n").find((l) => l.startsWith("data:"));
                        if (!line) continue;
                        const payload = line.replace(/^data:\s*/, "");
                        try {
                            const evt: Event = JSON.parse(payload);
                            if (evt.run_id) latestRunId = evt.run_id;
                            if (evt.type === "ready") {
                                setMeta({ rows: evt.rows, columns: evt.columns, model: evt.model });
                            } else if (evt.type === "done") {
                                setStatus("done");
                                // Pull runId from result event first, then from
                                // latestRunId (any event including done itself).
                                // result/runId may be undefined if the stream
                                // never produced one — caller handles that.
                                const resultEvt = accumulated.find(
                                    (e) => e.type === "result"
                                ) as Extract<Event, { type: "result" }> | undefined;
                                onDone?.({
                                    runId: resultEvt?.run_id ?? latestRunId,
                                    result: resultEvt?.text,
                                    events: accumulated.slice(),
                                });
                            } else if (evt.type === "error") {
                                accumulated.push(evt);
                                setEvents((prev) => [...prev, evt]);
                                setStatus("error");
                            } else {
                                accumulated.push(evt);
                                setEvents((prev) => [...prev, evt]);
                            }
                        } catch {
                            // ignore parse errors on partial frames
                        }
                    }
                }
            } catch (e) {
                if ((e as { name?: string })?.name === "AbortError") return;
                const errEvt: Event = {
                    type: "error",
                    message: e instanceof Error ? e.message : String(e),
                };
                accumulated.push(errEvt);
                setEvents((prev) => [...prev, errEvt]);
                setStatus("error");
                onDone?.(null);
            }
        })();

        return () => {
            controller.abort();
        };
    }, [request, onDone]);

    // Autoscroll on new events
    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [events]);

    if (!request && events.length === 0) return null;

    return (
        <div
            ref={containerRef}
            className="rounded-2xl border border-(--border-primary) bg-(--bg-secondary)/60 backdrop-blur-sm p-4 space-y-3 max-h-[60vh] overflow-y-auto"
        >
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-vanta-neon font-semibold">
                <span className={`w-1.5 h-1.5 rounded-full ${status === "running" ? "bg-vanta-neon animate-pulse" : status === "error" ? "bg-(--error)" : "bg-(--text-muted)"}`} />
                Thinking{status === "running" ? "…" : ""}
                {meta && (
                    <span className="ml-auto text-[10px] text-(--text-muted) normal-case tracking-normal">
                        {meta.rows} rows · {meta.columns} cols · {meta.model}
                    </span>
                )}
            </div>

            {events.map((evt, i) => (
                <EventView key={i} evt={evt} />
            ))}

            {status === "running" && events.length === 0 && (
                <div className="text-(--text-muted) text-sm italic">Loading data…</div>
            )}
        </div>
    );
}

function EventView({ evt }: { evt: Event }) {
    if (evt.type === "thought") {
        return (
            <div className="flex gap-2 items-start text-sm text-(--text-secondary)">
                <span className="flex-none text-vanta-neon mt-0.5">·</span>
                <span className="italic">{evt.text}</span>
            </div>
        );
    }
    if (evt.type === "code") {
        return (
            <div className="space-y-1">
                <pre className="text-[11px] font-mono leading-relaxed text-(--text-primary) bg-(--bg-primary)/80 border border-(--border-secondary) rounded-lg p-3 overflow-x-auto">
                    <code>{evt.code}</code>
                </pre>
                <button
                    type="button"
                    aria-label="Download generated Python step as step.py"
                    className="text-[10px] uppercase tracking-wider text-(--text-muted) hover:text-vanta-neon"
                    onClick={() => downloadText("step.py", evt.code, "text/x-python")}
                >
                    Download .py
                </button>
            </div>
        );
    }
    if (evt.type === "stdout") {
        return (
            <pre className="text-[11px] font-mono leading-relaxed text-(--text-muted) bg-(--bg-primary)/40 rounded-lg p-2 whitespace-pre-wrap max-h-48 overflow-y-auto">
                {evt.text}
            </pre>
        );
    }
    if (evt.type === "stderr") {
        return (
            <pre className="text-[11px] font-mono leading-relaxed text-(--error) bg-(--error-bg) rounded-lg p-2 whitespace-pre-wrap max-h-48 overflow-y-auto">
                {evt.text}
            </pre>
        );
    }
    if (evt.type === "chart") {
        const dataUrl = evt.data_url;
        if (dataUrl) {
            return (
                <div className="space-y-1">
                    <div className="rounded-lg overflow-hidden border border-(--border-secondary)">
                        {/* data: URLs can't round-trip through next/image and never leave the client */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={dataUrl} alt={evt.path} className="w-full h-auto" />
                    </div>
                    <button
                        type="button"
                        aria-label="Download chart as chart.png"
                        className="text-[10px] uppercase tracking-wider text-(--text-muted) hover:text-vanta-neon"
                        onClick={() => {
                            const blob = dataUrlToBlob(dataUrl);
                            if (blob) downloadBlob("chart.png", blob);
                        }}
                    >
                        Download .png
                    </button>
                </div>
            );
        }
        // Replay path: data_url was stripped before persistence to keep the
        // metadata.thinking.events row small. Show a placeholder card so the
        // user knows a chart existed in the original run. The image itself
        // returns when the proxy route lands (B9 follow-up).
        return (
            <div className="rounded-lg border border-dashed border-(--border-secondary) bg-(--bg-primary)/40 p-4 text-xs text-(--text-muted) italic flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M3 9h18M9 21V9" />
                </svg>
                <span>
                    Chart from this run{evt.path ? ` (${evt.path})` : ""} —
                    image unavailable on reload (run live to see it).
                </span>
            </div>
        );
    }
    if (evt.type === "result") {
        return (
            <div className="text-sm text-(--text-primary) bg-vanta-neon/5 border border-vanta-neon/30 rounded-lg p-3 space-y-2">
                <Markdown>{evt.text}</Markdown>
                <button
                    type="button"
                    aria-label="Download result as result.md"
                    className="text-[10px] uppercase tracking-wider text-(--text-muted) hover:text-vanta-neon"
                    onClick={() => downloadText("result.md", evt.text, "text/markdown")}
                >
                    Download .md
                </button>
            </div>
        );
    }
    if (evt.type === "error") {
        return (
            <div className="text-sm text-red-400 bg-(--error-bg) border border-(--error)/30 rounded-lg p-3">
                <Markdown>{evt.message}</Markdown>
            </div>
        );
    }
    return null;
}
