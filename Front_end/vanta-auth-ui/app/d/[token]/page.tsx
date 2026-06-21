"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ChartRenderer from "@/components/charts/ChartRenderer";

interface Widget {
    id: string;
    type: string;
    config: Record<string, unknown>;
    gridX: number;
    gridY: number;
    gridW: number;
    gridH: number;
}
interface PublicDashboard {
    name: string;
    description: string | null;
    widgets: Widget[];
}

export default function PublicDashboardPage() {
    const { token } = useParams<{ token: string }>();
    const [board, setBoard] = useState<PublicDashboard | null>(null);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1";
                const res = await fetch(`${apiUrl}/dashboards/public/${token}`);
                const body = await res.json();
                if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
                setBoard(body.data);
            } catch (e) {
                setErr(e instanceof Error ? e.message : "Could not load");
            }
        })();
    }, [token]);

    return (
        <div className="min-h-screen bg-(--bg-primary) text-(--text-primary)" style={{ fontFamily: "var(--font-body)" }}>
            <header className="border-b border-(--border-secondary) bg-(--bg-primary)/80 backdrop-blur sticky top-0 z-10">
                <div className="mx-auto max-w-7xl px-6 h-14 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
                        <span className="w-6 h-6 rounded-md bg-vanta-neon text-black flex items-center justify-center font-black text-xs">V</span>
                        <span>Vanta</span>
                    </Link>
                    <span className="text-[10px] uppercase tracking-widest text-(--text-muted)">
                        Shared dashboard · read-only
                    </span>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-6 py-8">
                {err ? (
                    <div className="rounded-xl border border-(--error)/30 bg-(--error-bg) text-(--error) px-4 py-3">
                        {err}
                    </div>
                ) : !board ? (
                    <p className="text-(--text-muted)">Loading…</p>
                ) : (
                    <>
                        <h1 className="text-3xl md:text-4xl font-bold mb-2" style={{ fontFamily: "var(--font-heading)" }}>
                            {board.name}
                        </h1>
                        {board.description && <p className="text-(--text-muted) mb-8 max-w-2xl">{board.description}</p>}

                        {board.widgets.length === 0 ? (
                            <p className="text-(--text-muted)">Nothing pinned here yet.</p>
                        ) : (
                            <div className="grid grid-cols-12 gap-4 auto-rows-[90px]">
                                {[...board.widgets].sort((a, b) => a.gridY - b.gridY || a.gridX - b.gridX).map((w) => (
                                    <div
                                        key={w.id}
                                        className="rounded-2xl border border-(--border-primary) bg-(--bg-secondary)/80 p-4 overflow-hidden"
                                        style={{
                                            gridColumn: `span ${Math.min(Math.max(w.gridW, 1), 12)} / span ${Math.min(Math.max(w.gridW, 1), 12)}`,
                                            gridRow: `span ${Math.min(Math.max(w.gridH, 1), 12)} / span ${Math.min(Math.max(w.gridH, 1), 12)}`,
                                        }}
                                    >
                                        <WidgetView widget={w} token={token as string} />
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </main>
        </div>
    );
}

function WidgetView({ widget, token }: { widget: Widget; token: string }) {
    if (widget.type === "markdown") {
        return <div className="text-sm whitespace-pre-wrap leading-relaxed h-full overflow-y-auto">{String((widget.config as { content?: string })?.content || "")}</div>;
    }
    if (widget.type === "chart") {
        const cfg = widget.config as { chartSpec?: Record<string, unknown>; title?: string };
        return (
            <div className="h-full flex flex-col">
                {cfg.title && <div className="text-sm font-semibold mb-2">{cfg.title}</div>}
                <div className="flex-1 min-h-0">
                    {cfg.chartSpec ? <ChartRenderer chart={cfg.chartSpec as never} height="100%" /> : <div className="text-xs text-(--text-muted) italic">No chart data.</div>}
                </div>
            </div>
        );
    }
    if (widget.type === "big-number") {
        const cfg = widget.config as { value?: string; label?: string };
        return (
            <div className="h-full flex flex-col justify-center">
                <div className="text-4xl font-bold text-vanta-neon" style={{ fontFamily: "var(--font-heading)" }}>{cfg.value}</div>
                <div className="text-xs text-(--text-muted) uppercase tracking-wider mt-1">{cfg.label}</div>
            </div>
        );
    }
    if (widget.type === "query") {
        return <PublicQueryWidget widget={widget} token={token} />;
    }
    return null;
}

function PublicQueryWidget({ widget, token }: { widget: Widget; token: string }) {
    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1";
    const cfg = widget.config as { title?: string; refreshIntervalSec?: number };

    const [chart, setChart] = useState<Record<string, unknown> | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const intervalRef = useRef<number | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(
                `${apiUrl}/dashboards/public/${token}/widgets/${widget.id}/refresh`,
                { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
            );
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
            setChart(body.data?.chartSpec || null);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Refresh failed");
        } finally {
            setLoading(false);
        }
    }, [apiUrl, token, widget.id]);

    useEffect(() => {
        refresh();
        const sec = Number(cfg.refreshIntervalSec || 0);
        if (intervalRef.current !== null) {
            window.clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        if (sec > 0) {
            intervalRef.current = window.setInterval(() => { refresh(); }, sec * 1000);
        }
        return () => {
            if (intervalRef.current !== null) {
                window.clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, [refresh, cfg.refreshIntervalSec]);

    return (
        <div className="h-full flex flex-col">
            {cfg.title && <div className="text-sm font-semibold mb-2 truncate">{cfg.title}</div>}
            <div className="flex-1 min-h-0">
                {error ? (
                    <div className="text-xs text-(--error)">{error}</div>
                ) : chart ? (
                    <ChartRenderer chart={chart as never} height="100%" />
                ) : (
                    <div className="text-xs text-(--text-muted) italic">{loading ? "Loading…" : "No data."}</div>
                )}
            </div>
        </div>
    );
}
