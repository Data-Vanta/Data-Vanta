"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ChartRenderer from "@/components/charts/ChartRenderer";
import type { WidgetRendererProps } from "./index";

/**
 * Query-backed widget. Calls the dashboard refresh endpoint on mount and
 * (optionally) every `config.refreshIntervalSec` seconds. Aggregation +
 * shaping happens server-side in `engine/widget_query.py`; this component
 * is a thin renderer + interval driver.
 */

interface QueryWidgetConfig {
    source?: {
        kind?: string;
        projectId?: string;
        tableName?: string;
        fileId?: string;
        connectorId?: string;
        sourceSchema?: string;
        sourceName?: string;
    };
    /** MVP shape: {x:string,y:string,agg,...}. Shelf shape: {x:string[],y:[],...} */
    fields?: Record<string, unknown>;
    chartType?: string;
    title?: string;
    refreshIntervalSec?: number;
    reingestOnRefresh?: boolean;
}

/** Resolve the click-emit field from either single-shelf or multi-shelf config. */
function resolveClickField(fields: Record<string, unknown> | undefined): string | null {
    if (!fields) return null;
    const x = fields.x;
    if (typeof x === "string" && x) return x;
    if (Array.isArray(x) && x.length > 0 && typeof x[0] === "string") return x[0] as string;
    return null;
}

const REFRESH_OPTIONS: Array<{ label: string; value: number }> = [
    { label: "Off", value: 0 },
    { label: "1m", value: 60 },
    { label: "5m", value: 300 },
    { label: "15m", value: 900 },
    { label: "1h", value: 3600 },
];

export default function QueryWidget({
    config,
    isEditing,
    dashboardId,
    widgetId,
    onConfigChange,
    boardFilters,
    onPointClick,
    refreshNonce,
}: WidgetRendererProps) {
    const cfg = (config || {}) as QueryWidgetConfig;
    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1";

    const [chart, setChart] = useState<Record<string, unknown> | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
    const intervalRef = useRef<number | null>(null);

    const refresh = useCallback(async (opts?: { reingest?: boolean }) => {
        if (!dashboardId || !widgetId) {
            setError("Save the widget before refreshing.");
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const token = localStorage.getItem("authToken") || "";
            const qs = opts?.reingest ? "?reingest=true" : "";
            const res = await fetch(
                `${apiUrl}/dashboards/${dashboardId}/widgets/${widgetId}/refresh${qs}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-auth-token": token },
                    // Forward any board-level cross-filters; the controller
                    // merges these into the saved widget's own filters
                    // before forwarding to the engine.
                    body: JSON.stringify({
                        extraFilters: boardFilters || [],
                    }),
                },
            );
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (res.status === 404) {
                    throw new Error("Refresh route missing — restart user-auth to load it.");
                }
                throw new Error(body.message || `HTTP ${res.status}`);
            }
            const spec = body.data?.chartSpec || null;
            setChart(spec);
            setLastRefreshed(new Date());
        } catch (e) {
            setError(e instanceof Error ? e.message : "Refresh failed");
        } finally {
            setLoading(false);
        }
    }, [apiUrl, dashboardId, widgetId, boardFilters]);

    // Initial load + interval setup. Re-fires whenever the saved interval changes.
    // Also re-fires when boardFilters or refreshNonce changes so the widget
    // stays in sync with cross-filter clicks and "Refresh all" clicks.
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
    }, [refresh, cfg.refreshIntervalSec, refreshNonce]);

    const setInterval = (sec: number) => {
        if (!onConfigChange) return;
        onConfigChange({ ...config, refreshIntervalSec: sec });
    };

    const setReingestOnRefresh = (val: boolean) => {
        if (!onConfigChange) return;
        onConfigChange({ ...config, reingestOnRefresh: val });
    };

    const canReingest =
        cfg.source?.kind === "connector_table"
        && !!cfg.source?.connectorId
        && !!cfg.source?.sourceName;

    return (
        <div className="h-full flex flex-col">
            <div className="flex items-center gap-2 mb-2">
                {cfg.title && (
                    <div className="text-sm font-semibold text-(--text-primary) truncate">{cfg.title}</div>
                )}
                <div className="flex-1" />
                {lastRefreshed && (
                    <span className="text-[10px] text-(--text-muted)" title={lastRefreshed.toISOString()}>
                        {lastRefreshed.toLocaleTimeString()}
                    </span>
                )}
                <button
                    onClick={() => refresh()}
                    disabled={loading}
                    className="text-[10px] px-2 h-6 rounded bg-(--bg-tertiary) hover:bg-(--bg-hover) text-(--text-secondary) hover:text-vanta-neon disabled:opacity-50"
                    title="Refresh now (cached)"
                >
                    {loading ? "…" : "↻"}
                </button>
                {canReingest && (
                    <button
                        onClick={() => refresh({ reingest: true })}
                        disabled={loading}
                        className="text-[10px] px-2 h-6 rounded bg-(--bg-tertiary) hover:bg-(--bg-hover) text-(--text-secondary) hover:text-vanta-neon disabled:opacity-50"
                        title="Re-pull from the source database, then refresh"
                    >
                        ⤓
                    </button>
                )}
                {isEditing && (
                    <select
                        value={Number(cfg.refreshIntervalSec || 0)}
                        onChange={(e) => setInterval(Number(e.target.value))}
                        className="text-[10px] h-6 px-1 rounded bg-(--bg-tertiary) border border-(--border-primary) text-(--text-secondary)"
                        title="Auto-refresh interval"
                    >
                        {REFRESH_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                    </select>
                )}
                {isEditing && canReingest && (
                    <label
                        className="text-[10px] flex items-center gap-1 text-(--text-muted) cursor-pointer"
                        title="When on, every auto-refresh re-pulls from the source DB before re-rendering."
                    >
                        <input
                            type="checkbox"
                            checked={!!cfg.reingestOnRefresh}
                            onChange={(e) => setReingestOnRefresh(e.target.checked)}
                            className="accent-vanta-neon"
                        />
                        live
                    </label>
                )}
            </div>
            <div className="flex-1 min-h-0">
                {error ? (
                    <div className="text-xs text-(--error)">{error}</div>
                ) : chart ? (
                    (() => {
                        const clickField = resolveClickField(cfg.fields);
                        return (
                            <ChartRenderer
                                chart={chart as never}
                                height="100%"
                                onPointClick={
                                    onPointClick && widgetId && clickField
                                        ? (e) => onPointClick({
                                            widgetId,
                                            field: clickField,
                                            value: e.label,
                                        })
                                        : undefined
                                }
                            />
                        );
                    })()
                ) : (
                    <div className="text-xs text-(--text-muted) italic">
                        {loading ? "Loading…" : "No data yet."}
                    </div>
                )}
            </div>
        </div>
    );
}
