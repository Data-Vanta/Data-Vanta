"use client";
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Responsive, WidthProvider } from "react-grid-layout/legacy";
import type { Layout, LayoutItem } from "react-grid-layout/legacy";
import AddWidgetMenu from "@/components/dashboard/AddWidgetMenu";
import QueryWidgetBuilder, { type QueryWidgetConfig } from "@/components/dashboard/QueryWidgetBuilder";
import ShelfBuilder, { type ShelfBuilderConfig } from "@/components/dashboard/ShelfBuilder";
import { WIDGETS } from "@/components/dashboard/widgets";

const ResponsiveGrid = WidthProvider(Responsive);

interface Widget {
    id: string;
    type: string;
    config: Record<string, unknown>;
    gridX: number;
    gridY: number;
    gridW: number;
    gridH: number;
}

interface Dashboard {
    id: string;
    name: string;
    description: string | null;
    visibility: "private" | "team" | "public-link";
    shareToken: string | null;
    widgets: Widget[];
}

interface ChartPickerEntry {
    sessionId: string;
    sessionTitle: string | null;
    messageId: string;
    chart: Record<string, unknown> & { title?: string };
}

interface ChatSessionSummary {
    id: string;
    title?: string | null;
}

interface ChatMessageWithMeta {
    id: string;
    metadata?: { chartSpecs?: Record<string, unknown>[] } | null;
}

export default function BoardDetailPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const [board, setBoard] = useState<Dashboard | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [chartPickerOpen, setChartPickerOpen] = useState(false);
    const [queryBuilderOpen, setQueryBuilderOpen] = useState(false);
    const [shelfBuilderOpen, setShelfBuilderOpen] = useState(false);
    const [chartPickerCharts, setChartPickerCharts] = useState<ChartPickerEntry[]>([]);
    const [chartPickerLoading, setChartPickerLoading] = useState(false);

    // Phase 13 — Power BI-style board-level cross-filters. A click on any
    // chart bar/slice adds a {col, op:'=', value} entry; the next refresh
    // of every query widget merges these in. "Clear all" wipes them.
    type BoardFilter = { col: string; op: string; value: string | number; sourceWidgetId?: string };
    const [boardFilters, setBoardFilters] = useState<BoardFilter[]>([]);
    const [refreshNonce, setRefreshNonce] = useState(0);

    const addBoardFilter = useCallback((f: BoardFilter) => {
        setBoardFilters((prev) => {
            // Toggle: clicking the same value twice removes the filter.
            const same = prev.find((p) => p.col === f.col && String(p.value) === String(f.value));
            if (same) return prev.filter((p) => p !== same);
            // Replace any previous filter on the same column — only one
            // value per column at a time keeps the UX predictable.
            return [...prev.filter((p) => p.col !== f.col), f];
        });
    }, []);
    const removeBoardFilter = useCallback((col: string) => {
        setBoardFilters((prev) => prev.filter((f) => f.col !== col));
    }, []);
    const clearBoardFilters = useCallback(() => setBoardFilters([]), []);
    const refreshAll = useCallback(() => setRefreshNonce((n) => n + 1), []);

    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1";

    const load = useCallback(async () => {
        setLoading(true);
        setErr(null);
        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${apiUrl}/dashboards/${id}`, { headers: { "x-auth-token": token } });
            const body = await res.json();
            if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
            setBoard(body.data);
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Could not load dashboard");
        } finally {
            setLoading(false);
        }
    }, [apiUrl, id]);

    useEffect(() => { if (id) load(); }, [id, load]);

    async function toggleShare() {
        if (!board) return;
        const next = board.visibility === "public-link" ? "private" : "public-link";
        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${apiUrl}/dashboards/${board.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json", "x-auth-token": token },
                body: JSON.stringify({ visibility: next }),
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
            setBoard((prev) => prev ? { ...prev, visibility: body.data.visibility, shareToken: body.data.shareToken } : prev);
            if (next === "public-link" && body.data.shareToken) {
                const url = `${window.location.origin}/d/${body.data.shareToken}`;
                await navigator.clipboard?.writeText(url).catch(() => undefined);
                alert(`Link copied!\n${url}`);
            }
        } catch (e) {
            alert(e instanceof Error ? e.message : "Could not update");
        }
    }

    async function removeWidget(widgetId: string) {
        if (!board) return;
        if (!confirm("Remove this widget?")) return;
        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${apiUrl}/dashboards/${board.id}/widgets/${widgetId}`, {
                method: "DELETE",
                headers: { "x-auth-token": token },
            });
            if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
            setBoard((prev) => prev ? { ...prev, widgets: prev.widgets.filter((w) => w.id !== widgetId) } : prev);
        } catch (e) {
            alert(e instanceof Error ? e.message : "Could not delete");
        }
    }

    const handleLayoutChange = (next: Layout) => {
        if (!board) return;
        const token = localStorage.getItem("authToken") || "";
        const promises: Promise<unknown>[] = [];
        const updatedWidgets = board.widgets.map((w) => {
            const item = next.find((i: LayoutItem) => i.i === w.id);
            if (!item) return w;
            if (
                w.gridX === item.x &&
                w.gridY === item.y &&
                w.gridW === item.w &&
                w.gridH === item.h
            ) {
                return w;
            }
            promises.push(
                fetch(`${apiUrl}/dashboards/${board.id}/widgets/${item.i}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json", "x-auth-token": token },
                    body: JSON.stringify({ gridX: item.x, gridY: item.y, gridW: item.w, gridH: item.h }),
                })
            );
            return { ...w, gridX: item.x, gridY: item.y, gridW: item.w, gridH: item.h };
        });
        if (promises.length === 0) return;
        setBoard((prev) => prev ? { ...prev, widgets: updatedWidgets } : prev);
        // Fire-and-forget; errors are logged, layout state stays optimistic.
        Promise.all(promises).catch((err) => console.error("Layout PATCH failed", err));
    };

    const addWidget = useCallback(
        async (
            type: string,
            config: Record<string, unknown>,
            gridDefaults: { gridW: number; gridH: number }
        ) => {
            if (!board) return;
            const token = localStorage.getItem("authToken") || "";
            // Place the new widget at the BOTTOM of the grid instead of (0,0)
            // so it doesn't overlap existing widgets and trigger a chaotic
            // RGL compaction. nextY = max(gridY + gridH) across current
            // widgets. Empty board → nextY=0.
            const nextY = (board.widgets || []).reduce((acc, w) => {
                const bottom = (w.gridY ?? 0) + (w.gridH ?? 4);
                return bottom > acc ? bottom : acc;
            }, 0);
            try {
                const res = await fetch(`${apiUrl}/dashboards/${board.id}/widgets`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-auth-token": token },
                    body: JSON.stringify({
                        type,
                        config,
                        gridX: 0,
                        gridY: nextY,
                        gridW: gridDefaults.gridW,
                        gridH: gridDefaults.gridH,
                    }),
                });
                const body = await res.json();
                if (!res.ok) {
                    console.error("addWidget failed", res.status);
                    alert(body?.message || `Could not add widget (HTTP ${res.status})`);
                    return;
                }
                setBoard((prev) =>
                    prev ? { ...prev, widgets: [...(prev.widgets || []), body.data] } : prev
                );
            } catch (err) {
                console.error("addWidget failed", err);
                alert(err instanceof Error ? err.message : "Could not add widget");
            }
        },
        [apiUrl, board]
    );

    // Legacy helper still used by the empty-state CTA. AddWidgetMenu is now
    // registry-driven (see components/dashboard/AddWidgetMenu.tsx) so other
    // widget types like iframe come along for free without per-handler code.
    function addMarkdown() {
        const content = window.prompt(
            "Markdown content (supports headings, lists, tables, **bold**):"
        );
        if (content && content.trim()) {
            addWidget("markdown", { content }, { gridW: 6, gridH: 3 });
        }
    }

    /** Generic add-widget entry point used by the registry-driven menu. */
    const addWidgetByType = useCallback(
        (type: string, config: Record<string, unknown>) => {
            // Look up default grid in the widget registry. Without a match we
            // fall back to the markdown-ish 6x3 default.
            const grid = WIDGETS[type]?.defaultGrid ?? { gridW: 6, gridH: 3 };
            addWidget(type, config, grid);
        },
        [addWidget]
    );

    /**
     * Edit a widget's config in place. Asks for the right fields per type
     * (markdown content, big-number value/label, iframe url) and PATCHes the
     * existing widget. Backend already accepts a `config` PATCH body.
     */
    const editWidget = useCallback(
        async (widget: Widget) => {
            const cfg = (widget.config || {}) as Record<string, unknown>;
            let nextConfig: Record<string, unknown> | null = null;
            if (widget.type === "markdown") {
                const next = window.prompt(
                    "Markdown content:",
                    typeof cfg.content === "string" ? cfg.content : ""
                );
                if (next === null) return;
                nextConfig = { ...cfg, content: next };
            } else if (widget.type === "big-number") {
                const value = window.prompt(
                    "Number to display:",
                    typeof cfg.value === "string" ? cfg.value : String(cfg.value ?? "")
                );
                if (value === null) return;
                const label = window.prompt(
                    "Label (optional):",
                    typeof cfg.label === "string" ? cfg.label : ""
                );
                if (label === null) return;
                nextConfig = { ...cfg, value, label };
            } else if (widget.type === "iframe") {
                const url = window.prompt(
                    "Embed URL (https://…):",
                    typeof cfg.url === "string" ? cfg.url : ""
                );
                if (url === null) return;
                try {
                    const parsed = new URL(url);
                    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                        window.alert("Only http(s) URLs are allowed.");
                        return;
                    }
                } catch {
                    window.alert("That doesn't look like a valid URL.");
                    return;
                }
                const title = window.prompt(
                    "Title (optional):",
                    typeof cfg.title === "string" ? cfg.title : ""
                );
                if (title === null) return;
                nextConfig = { ...cfg, url, title };
            } else if (widget.type === "chart") {
                // Charts are pinned from chat — only the title is editable inline.
                const title = window.prompt(
                    "Chart title:",
                    typeof cfg.title === "string" ? cfg.title : ""
                );
                if (title === null) return;
                nextConfig = { ...cfg, title };
            }
            if (!nextConfig) return;

            const token = localStorage.getItem("authToken") || "";
            try {
                const res = await fetch(
                    `${apiUrl}/dashboards/${board?.id}/widgets/${widget.id}`,
                    {
                        method: "PATCH",
                        headers: {
                            "Content-Type": "application/json",
                            "x-auth-token": token,
                        },
                        body: JSON.stringify({ config: nextConfig }),
                    }
                );
                const body = await res.json().catch(() => ({}));
                if (!res.ok) {
                    alert(body?.message || `Could not save widget (HTTP ${res.status})`);
                    return;
                }
                setBoard((prev) =>
                    prev
                        ? {
                            ...prev,
                            widgets: (prev.widgets || []).map((w) =>
                                w.id === widget.id ? { ...w, config: nextConfig as Record<string, unknown> } : w
                            ),
                        }
                        : prev
                );
            } catch (err) {
                console.error("editWidget failed", err);
                alert(err instanceof Error ? err.message : "Could not save widget");
            }
        },
        [apiUrl, board?.id]
    );

    /**
     * Programmatic config patch from a widget's renderer (e.g. QueryWidget
     * adjusting refreshIntervalSec). PATCH the server, optimistically update
     * the local board state. Errors are toasted via console; we don't roll
     * back on failure for now — next refresh corrects mismatches.
     */
    const handleWidgetConfigChange = useCallback(
        async (widgetId: string, nextConfig: Record<string, unknown>) => {
            if (!board?.id) return;
            const token = localStorage.getItem("authToken") || "";
            setBoard((prev) =>
                prev
                    ? {
                        ...prev,
                        widgets: (prev.widgets || []).map((w) =>
                            w.id === widgetId ? { ...w, config: nextConfig } : w
                        ),
                    }
                    : prev
            );
            try {
                const res = await fetch(
                    `${apiUrl}/dashboards/${board.id}/widgets/${widgetId}`,
                    {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json", "x-auth-token": token },
                        body: JSON.stringify({ config: nextConfig }),
                    }
                );
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    console.error("widget config save failed:", body?.message || res.status);
                }
            } catch (err) {
                console.error("widget config save failed", err);
            }
        },
        [apiUrl, board?.id]
    );

    useEffect(() => {
        if (!chartPickerOpen) return;
        const token = localStorage.getItem("authToken") || "";
        let cancelled = false;
        (async () => {
            setChartPickerLoading(true);
            try {
                const sessRes = await fetch(`${apiUrl}/chat/sessions`, {
                    headers: { "x-auth-token": token },
                });
                if (!sessRes.ok) {
                    if (!cancelled) setChartPickerCharts([]);
                    return;
                }
                const sessJson = await sessRes.json();
                const sessions: ChatSessionSummary[] = sessJson.data || [];
                const all: ChartPickerEntry[] = [];
                for (const s of sessions) {
                    const detRes = await fetch(`${apiUrl}/chat/sessions/${s.id}`, {
                        headers: { "x-auth-token": token },
                    });
                    if (!detRes.ok) continue;
                    const detJson = await detRes.json();
                    const messages: ChatMessageWithMeta[] = detJson.data?.messages || [];
                    for (const m of messages) {
                        const specs = m.metadata?.chartSpecs || [];
                        for (const spec of specs) {
                            all.push({
                                sessionId: s.id,
                                sessionTitle: s.title || null,
                                messageId: m.id,
                                chart: spec as Record<string, unknown> & { title?: string },
                            });
                        }
                    }
                }
                if (!cancelled) setChartPickerCharts(all);
            } catch (err) {
                console.error("chart picker load failed", err);
                if (!cancelled) setChartPickerCharts([]);
            } finally {
                if (!cancelled) setChartPickerLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [chartPickerOpen, apiUrl]);

    if (loading) {
        return (
            <div className="p-10 text-(--text-muted)">Loading dashboard…</div>
        );
    }
    if (err || !board) {
        return (
            <div className="p-10">
                <div className="rounded-xl border border-(--error)/30 bg-(--error-bg) text-(--error) px-4 py-3 mb-4">
                    {err || "Dashboard not found"}
                </div>
                <Link href="/dashboard/boards" className="text-vanta-neon font-semibold hover:underline">
                    ← Back to dashboards
                </Link>
            </div>
        );
    }

    const layout: LayoutItem[] = board.widgets.map((w) => ({
        i: w.id,
        x: w.gridX ?? 0,
        y: w.gridY ?? 0,
        w: w.gridW ?? 6,
        h: w.gridH ?? 4,
        minW: 2,
        minH: 2,
    }));

    return (
        // h-full + overflow-y-auto so the dashboard page scrolls when its
        // content (header + grid) exceeds the viewport. The parent
        // DashboardLayout intentionally has overflow-hidden so each page
        // owns its scroll — the chat page does it on the message list,
        // and this board page does it here so widgets below the fold
        // are reachable without a tiny nested scroll bar.
        <div className="h-full overflow-y-auto relative">
            <div className="relative max-w-7xl mx-auto px-8 py-8">
                <nav className="mb-6">
                    <Link href="/dashboard/boards" className="text-xs text-(--text-muted) hover:text-vanta-neon transition-colors">
                        ← Back to dashboards
                    </Link>
                </nav>

                <header className="flex items-start justify-between gap-4 mb-10 flex-wrap">
                    <div className="flex-1 min-w-[280px]">
                        <h1
                            className="text-3xl md:text-4xl font-bold text-(--text-primary) mb-2"
                            style={{ fontFamily: "var(--font-heading)" }}
                        >
                            {board.name}
                        </h1>
                        {board.description && (
                            <p className="text-(--text-muted) max-w-2xl">{board.description}</p>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={refreshAll}
                            className="px-3 h-10 rounded-xl bg-(--bg-secondary) border border-(--border-primary) hover:border-vanta-neon text-sm font-semibold text-(--text-secondary) hover:text-vanta-neon transition-all flex items-center gap-1.5"
                            title="Re-run every query widget on this board"
                        >
                            <span className="text-base leading-none">↻</span>
                            <span className="hidden md:inline">Refresh all</span>
                        </button>
                        <button
                            onClick={toggleShare}
                            className={`px-4 h-10 rounded-xl text-sm font-semibold transition-all ${board.visibility === "public-link"
                                ? "bg-vanta-neon text-black shadow-md shadow-vanta-neon/25"
                                : "bg-(--bg-secondary) border border-(--border-primary) text-(--text-secondary) hover:border-vanta-neon hover:text-(--text-primary)"
                                }`}
                        >
                            {board.visibility === "public-link" ? "Shared · copy link" : "Share link"}
                        </button>
                        <button
                            onClick={() => setIsEditing((e) => !e)}
                            className="px-4 h-10 rounded-xl bg-(--bg-secondary) border border-(--border-primary) hover:border-(--accent) text-sm font-semibold text-(--text-secondary) hover:text-(--text-primary) transition-all"
                        >
                            {isEditing ? "Done" : "Edit"}
                        </button>
                        {isEditing && (
                            <AddWidgetMenu
                                onAddSimple={addWidgetByType}
                                onAddChart={() => setChartPickerOpen(true)}
                                onAddQuery={() => setQueryBuilderOpen(true)}
                                onAddShelf={() => setShelfBuilderOpen(true)}
                            />
                        )}
                    </div>
                </header>

                {/* Phase 13 — board-level filters bar. Filled by chart-bar
                    clicks; visible whenever any cross-filter is active.
                    Each chip click removes its filter; "Clear all" resets. */}
                {boardFilters.length > 0 && (
                    <div className="mb-6 flex items-center gap-2 flex-wrap rounded-xl border border-vanta-neon/30 bg-vanta-neon/[0.04] px-4 py-2.5">
                        <span className="text-[10px] uppercase tracking-widest font-semibold text-vanta-neon flex items-center gap-1.5">
                            <span aria-hidden>⌘</span> Filters
                        </span>
                        {boardFilters.map((f) => (
                            <button
                                key={`${f.col}::${f.value}`}
                                onClick={() => removeBoardFilter(f.col)}
                                className="inline-flex items-center gap-1 text-[11px] px-2 h-6 rounded-md bg-vanta-neon/15 text-vanta-neon border border-vanta-neon/40 hover:bg-(--error-bg) hover:text-(--error) hover:border-(--error)/40 transition-colors"
                                title="Click to clear"
                            >
                                <span className="font-semibold">{f.col}</span>
                                <span className="opacity-60">{f.op}</span>
                                <span className="font-mono">{String(f.value)}</span>
                                <span className="ml-1 opacity-60">×</span>
                            </button>
                        ))}
                        <button
                            onClick={clearBoardFilters}
                            className="text-[10px] text-(--text-muted) hover:text-(--text-primary) ml-auto px-2 h-6 rounded-md hover:bg-(--bg-tertiary)"
                        >
                            Clear all
                        </button>
                    </div>
                )}

                {board.widgets.length === 0 ? (
                    <div className="relative rounded-3xl border border-(--border-primary) bg-(--bg-secondary)/60 p-12 text-center">
                        <p className="text-(--text-muted) mb-4">
                            Empty dashboard. Pin a chart from chat, or add a note.
                        </p>
                        <div className="flex items-center justify-center gap-3">
                            <button
                                onClick={() => router.push("/dashboard")}
                                className="px-5 h-11 rounded-xl bg-vanta-neon text-black font-bold hover:bg-vanta-neon/90 transition-all shadow-md shadow-vanta-neon/25"
                            >
                                Open a chat
                            </button>
                            <button
                                onClick={addMarkdown}
                                className="px-5 h-11 rounded-xl bg-(--bg-tertiary) hover:bg-(--bg-hover) text-(--text-primary) font-medium transition-colors"
                            >
                                Add a note
                            </button>
                        </div>
                    </div>
                ) : (
                    <ResponsiveGrid
                        className="layout"
                        layouts={{ lg: layout }}
                        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480 }}
                        cols={{ lg: 12, md: 10, sm: 6, xs: 4 }}
                        rowHeight={60}
                        margin={[16, 16]}
                        isDraggable={isEditing}
                        isResizable={isEditing}
                        onLayoutChange={handleLayoutChange}
                        draggableHandle=".widget-drag-handle"
                    >
                        {board.widgets.map((w) => (
                            <div key={w.id}>
                                <WidgetCard
                                    widget={w}
                                    isEditing={isEditing}
                                    onRemove={() => removeWidget(w.id)}
                                    onEdit={() => editWidget(w)}
                                    dashboardId={board?.id}
                                    onConfigChange={handleWidgetConfigChange}
                                    boardFilters={boardFilters.map(({ col, op, value }) => ({ col, op, value }))}
                                    onPointClick={(e) => addBoardFilter({
                                        col: e.field,
                                        op: "=",
                                        value: e.value,
                                        sourceWidgetId: e.widgetId,
                                    })}
                                    refreshNonce={refreshNonce}
                                />
                            </div>
                        ))}
                    </ResponsiveGrid>
                )}
            </div>

            {chartPickerOpen && (
                <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-(--backdrop) backdrop-blur-sm"
                        onClick={() => setChartPickerOpen(false)}
                    />
                    <div className="relative w-full max-w-2xl max-h-[80vh] bg-(--bg-secondary) border border-(--border-primary) rounded-2xl shadow-2xl flex flex-col overflow-hidden">
                        <header className="flex items-center justify-between px-6 py-4 border-b border-(--border-primary)">
                            <div>
                                <p className="text-[10px] uppercase tracking-widest text-vanta-neon font-semibold mb-1">
                                    Chart picker
                                </p>
                                <h3
                                    className="text-lg font-bold text-(--text-primary)"
                                    style={{ fontFamily: "var(--font-heading)" }}
                                >
                                    Pick a chart
                                </h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => setChartPickerOpen(false)}
                                className="w-8 h-8 rounded-lg bg-(--bg-tertiary) hover:bg-(--bg-hover) text-(--text-primary) flex items-center justify-center"
                                aria-label="Close"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M18 6L6 18M6 6l12 12" />
                                </svg>
                            </button>
                        </header>
                        <div className="p-4 overflow-y-auto space-y-2">
                            {chartPickerLoading ? (
                                <div className="h-20 rounded-lg bg-(--bg-tertiary) animate-pulse" />
                            ) : chartPickerCharts.length === 0 ? (
                                <p className="text-sm text-(--text-muted) px-2 py-6 text-center">
                                    No charts available yet. Generate some in chat first.
                                </p>
                            ) : (
                                chartPickerCharts.map((entry, i) => (
                                    <button
                                        key={`${entry.sessionId}-${entry.messageId}-${i}`}
                                        type="button"
                                        onClick={() => {
                                            addWidget(
                                                "chart",
                                                {
                                                    chartSpec: entry.chart,
                                                    title: entry.chart?.title,
                                                    sourceSessionId: entry.sessionId,
                                                    sourceMessageId: entry.messageId,
                                                },
                                                { gridW: 6, gridH: 4 }
                                            );
                                            setChartPickerOpen(false);
                                        }}
                                        className="block w-full text-left rounded-lg border border-(--border-primary) bg-(--bg-tertiary) hover:border-(--accent) px-3 py-2.5 transition-all"
                                    >
                                        <div className="text-sm font-medium text-(--text-primary)">
                                            {entry.chart?.title || "Untitled chart"}
                                        </div>
                                        <div className="text-xs text-(--text-muted) mt-0.5">
                                            From: {entry.sessionTitle || entry.sessionId}
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}

            <QueryWidgetBuilder
                isOpen={queryBuilderOpen}
                onClose={() => setQueryBuilderOpen(false)}
                onSave={async (cfg: QueryWidgetConfig) => {
                    addWidgetByType("query", cfg as unknown as Record<string, unknown>);
                }}
            />

            <ShelfBuilder
                isOpen={shelfBuilderOpen}
                onClose={() => setShelfBuilderOpen(false)}
                onSave={async (cfg: ShelfBuilderConfig) => {
                    addWidgetByType("query", cfg as unknown as Record<string, unknown>);
                }}
            />
        </div>
    );
}

function WidgetCard({
    widget,
    isEditing,
    onRemove,
    onEdit,
    dashboardId,
    onConfigChange,
    boardFilters,
    onPointClick,
    refreshNonce,
}: {
    widget: Widget;
    isEditing: boolean;
    onRemove: () => void;
    onEdit: () => void;
    dashboardId?: string;
    onConfigChange?: (widgetId: string, next: Record<string, unknown>) => void;
    boardFilters?: Array<{ col: string; op: string; value: unknown }>;
    onPointClick?: (event: { widgetId: string; field: string; value: string | number }) => void;
    refreshNonce?: number;
}) {
    return (
        <div className="relative h-full w-full rounded-xl border border-(--border-primary) bg-(--bg-secondary)/95 backdrop-blur-sm overflow-hidden flex flex-col shadow-sm hover:shadow-md hover:border-(--border-secondary) transition-all">
            <div
                className={`widget-drag-handle flex items-center justify-between px-3 py-2 text-[11px] font-semibold text-(--text-secondary) uppercase tracking-wide border-b border-(--border-primary)/60 bg-(--bg-tertiary)/30 ${isEditing ? "cursor-move" : ""}`}
            >
                <span className="truncate">{widgetLabel(widget)}</span>
                {isEditing && (
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                        <button
                            onClick={onEdit}
                            onMouseDown={(e) => e.stopPropagation()}
                            onTouchStart={(e) => e.stopPropagation()}
                            className="w-6 h-6 rounded-lg bg-(--bg-tertiary) hover:bg-vanta-neon/20 text-(--text-secondary) hover:text-vanta-neon flex items-center justify-center"
                            title="Edit widget"
                        >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z" />
                            </svg>
                        </button>
                        <button
                            onClick={onRemove}
                            onMouseDown={(e) => e.stopPropagation()}
                            onTouchStart={(e) => e.stopPropagation()}
                            className="w-6 h-6 rounded-lg bg-(--bg-tertiary) hover:bg-(--error-bg) text-(--error) flex items-center justify-center"
                            title="Remove"
                        >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M18 6L6 18M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                )}
            </div>
            <div className="flex-1 min-h-0 p-4 overflow-hidden">
                <WidgetBody
                    widget={widget}
                    isEditing={isEditing}
                    dashboardId={dashboardId}
                    onConfigChange={onConfigChange}
                    boardFilters={boardFilters}
                    onPointClick={onPointClick}
                    refreshNonce={refreshNonce}
                />
            </div>
        </div>
    );
}

function widgetLabel(widget: Widget): string {
    if (widget.type === "chart") {
        const cfg = widget.config as { title?: string };
        return cfg.title || "Chart";
    }
    if (widget.type === "big-number") {
        const cfg = widget.config as { label?: string };
        return cfg.label || "Big number";
    }
    if (widget.type === "markdown") {
        return "Note";
    }
    const spec = WIDGETS[widget.type];
    return spec ? spec.label : widget.type;
}

function WidgetBody({
    widget,
    isEditing,
    dashboardId,
    onConfigChange,
    boardFilters,
    onPointClick,
    refreshNonce,
}: {
    widget: Widget;
    isEditing: boolean;
    dashboardId?: string;
    onConfigChange?: (widgetId: string, next: Record<string, unknown>) => void;
    boardFilters?: Array<{ col: string; op: string; value: unknown }>;
    onPointClick?: (event: { widgetId: string; field: string; value: string | number }) => void;
    refreshNonce?: number;
}) {
    const spec = WIDGETS[widget.type];
    if (!spec) {
        return (
            <div className="text-xs text-(--text-muted) italic">
                Unsupported widget: {widget.type}
            </div>
        );
    }
    const Renderer = spec.Component;
    return (
        <Renderer
            config={widget.config}
            isEditing={isEditing}
            dashboardId={dashboardId}
            widgetId={widget.id}
            onConfigChange={
                onConfigChange ? (next) => onConfigChange(widget.id, next) : undefined
            }
            boardFilters={boardFilters}
            onPointClick={onPointClick}
            refreshNonce={refreshNonce}
        />
    );
}
