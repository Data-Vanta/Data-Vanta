"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ChartRenderer from "@/components/charts/ChartRenderer";
import QuickUploadModal from "./QuickUploadModal";

/**
 * Power-BI-style "Add chart from data" builder modal.
 *
 * Single modal, three sections: source → field pickers → chart type, with a
 * live preview that re-runs the engine query on changes (debounced). Save
 * fires the parent's onSave with a fully-formed `query` widget config.
 */

interface CatalogTable {
    table_name: string;
    project_id: string;
    source: string;
    source_ref?: string | null;
    row_count?: number | null;
}

interface ColumnRow {
    name: string;
    type: string;
    nullable?: boolean;
}

interface ConnectorRow {
    id: string;
    type: string;
    name: string;
}

type SourceKind = "connector_table" | "file";
type Agg = "sum" | "avg" | "count" | "count_distinct" | "min" | "max" | "none";

// Mirror engine/connectors.py `_safe_table_name`.
function safeName(raw: string): string {
    return (raw || "")
        .trim()
        .replace(/[^A-Za-z0-9_]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
        .toLowerCase() || "untitled";
}

const CHART_TYPES: Array<{ id: string; label: string; icon: string }> = [
    { id: "bar_chart", label: "Bar", icon: "▮▮▮" },
    { id: "line_chart", label: "Line", icon: "/\\/" },
    { id: "area_chart", label: "Area", icon: "▰▰▰" },
    { id: "pie_chart", label: "Pie", icon: "◔" },
    { id: "donut_chart", label: "Donut", icon: "◍" },
    { id: "scatter_plot", label: "Scatter", icon: "·∴·" },
    { id: "big_number", label: "Big number", icon: "#" },
];

const AGG_OPTIONS: Array<{ value: Agg; label: string }> = [
    { value: "sum", label: "Sum" },
    { value: "avg", label: "Average" },
    { value: "count", label: "Count" },
    { value: "count_distinct", label: "Count distinct" },
    { value: "min", label: "Min" },
    { value: "max", label: "Max" },
    { value: "none", label: "None (raw values)" },
];

export interface QueryWidgetConfig {
    source: {
        kind: SourceKind;
        projectId: string;
        tableName: string;
        fileId?: string;
        // Reingest hints (Phase 10) — captured at build time so we can later
        // re-pull from the source DB on refresh without a heuristic lookup.
        connectorId?: string;
        sourceSchema?: string;
        sourceName?: string;
    };
    fields: { x: string; y: string; agg: Agg; color?: string };
    chartType: string;
    title?: string;
    refreshIntervalSec?: number;
    reingestOnRefresh?: boolean;
}

export default function QueryWidgetBuilder({
    isOpen,
    onClose,
    onSave,
}: {
    isOpen: boolean;
    onClose: () => void;
    onSave: (config: QueryWidgetConfig) => Promise<void> | void;
}) {
    const router = useRouter();
    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1";
    const chartApiUrl = process.env.NEXT_PUBLIC_CHART_API_URL || "http://127.0.0.1:8000";
    const projectId = "default";

    const [sourceKind, setSourceKind] = useState<SourceKind>("connector_table");
    const [tables, setTables] = useState<CatalogTable[]>([]);
    const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
    const [userAuthFiles, setUserAuthFiles] = useState<Array<{ id: string; name: string }>>([]);
    const [importingFileId, setImportingFileId] = useState<string | null>(null);
    const [importErr, setImportErr] = useState<string | null>(null);
    const [pickedTable, setPickedTable] = useState<string>(""); // warehouse table_name (any source)
    const [showInlineUpload, setShowInlineUpload] = useState(false);

    const [columns, setColumns] = useState<ColumnRow[]>([]);
    const [columnsLoading, setColumnsLoading] = useState(false);

    const [x, setX] = useState<string>("");
    const [y, setY] = useState<string>("");
    const [color, setColor] = useState<string>("");
    const [agg, setAgg] = useState<Agg>("sum");
    const [chartType, setChartType] = useState<string>("bar_chart");
    const [title, setTitle] = useState<string>("");

    const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
    const [previewing, setPreviewing] = useState(false);
    const [previewErr, setPreviewErr] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const reset = useCallback(() => {
        setSourceKind("connector_table");
        setPickedTable("");
        setColumns([]);
        setX(""); setY(""); setColor(""); setAgg("sum");
        setChartType("bar_chart"); setTitle("");
        setPreview(null); setPreviewErr(null);
    }, []);

    // Load every warehouse table + the user's connectors on open.
    // Files-as-source is just `source === 'upload'` rows in the warehouse;
    // there's no separate user-auth file lookup needed here.
    const loadTables = useCallback(async () => {
        const token = localStorage.getItem("authToken") || "";
        try {
            const r = await fetch(`${chartApiUrl}/data/tables/${projectId}`, {
                headers: { "x-auth-token": token },
            });
            const j = r.ok ? await r.json() : { tables: [] };
            setTables(Array.isArray(j.tables) ? j.tables : []);
        } catch {
            setTables([]);
        }
    }, [chartApiUrl]);

    // Files in user-auth's Files table that don't yet have a corresponding
    // DuckDB warehouse row. The builder offers an "Import" button that
    // forwards their bytes to /data/upload, after which they show up
    // alongside other warehouse files.
    const loadUserAuthFiles = useCallback(async () => {
        const token = localStorage.getItem("authToken") || "";
        try {
            const r = await fetch(`${apiUrl}/file/`, { headers: { "x-auth-token": token } });
            if (!r.ok) { setUserAuthFiles([]); return; }
            const j = await r.json();
            const rows = (j.data || []).map((f: Record<string, unknown>) => ({
                id: String(f.id ?? f._id ?? ""),
                name: String(f.originalFilename ?? f.original_filename ?? ""),
            })).filter((f: { id: string }) => f.id);
            setUserAuthFiles(rows);
        } catch {
            setUserAuthFiles([]);
        }
    }, [apiUrl]);

    const importUserAuthFile = useCallback(async (fileId: string) => {
        setImportingFileId(fileId);
        setImportErr(null);
        try {
            const token = localStorage.getItem("authToken") || "";
            const r = await fetch(`${apiUrl}/file/${fileId}/ingest`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-auth-token": token },
                body: JSON.stringify({ projectId }),
            });
            const body = await r.json().catch(() => ({}));
            if (!r.ok) {
                if (r.status === 404) {
                    throw new Error("Ingest route missing — restart user-auth.");
                }
                throw new Error(body.message || `HTTP ${r.status}`);
            }
            await loadTables();
            const newTable = body.data?.tableName;
            if (newTable) setPickedTable(newTable);
        } catch (e) {
            setImportErr(e instanceof Error ? e.message : "Import failed");
        } finally {
            setImportingFileId(null);
        }
    }, [apiUrl, loadTables]);

    useEffect(() => {
        if (!isOpen) return;
        reset();
        loadTables();
        loadUserAuthFiles();
        const token = localStorage.getItem("authToken") || "";
        // Connectors list is best-effort — we use it to capture connectorId
        // for the re-ingest path, but the chart still works without it.
        fetch(`${apiUrl}/connectors`, { headers: { "x-auth-token": token } })
            .then((r) => r.ok ? r.json() : { data: [] })
            .then((j) => {
                const rows: ConnectorRow[] = (j.data || []).map((c: Record<string, unknown>) => ({
                    id: String(c.id ?? ""),
                    type: String(c.type ?? "").toLowerCase(),
                    name: String(c.name ?? ""),
                })).filter((c: ConnectorRow) => c.id);
                setConnectors(rows);
            })
            .catch(() => setConnectors([]));
    }, [isOpen, apiUrl, loadTables, loadUserAuthFiles, reset]);

    // Files in user-auth that aren't yet in the warehouse — by source_ref,
    // since when they ARE in the warehouse the source_ref records the
    // original filename. Anything in user-auth without a matching entry
    // shows up as "needs import".
    const filesNeedingImport = useMemo(() => {
        const ingestedNames = new Set(
            tables
                .filter((t) => (t.source || "").toLowerCase() === "upload")
                .map((t) => (t.source_ref || t.table_name).toLowerCase()),
        );
        return userAuthFiles.filter(
            (f) => f.name && !ingestedNames.has(f.name.toLowerCase()),
        );
    }, [tables, userAuthFiles]);

    // Partition warehouse tables by origin so the two tabs can pull from
    // the same source-of-truth without a separate fetch.
    const connectorTables = useMemo(
        () => tables.filter((t) => (t.source || "").toLowerCase() !== "upload"),
        [tables],
    );
    const fileTables = useMemo(
        () => tables.filter((t) => (t.source || "").toLowerCase() === "upload"),
        [tables],
    );

    // The picked warehouse table is the source-of-truth. Both connector
    // ingests and file uploads land in the same warehouse, so the builder
    // just queries it the same way regardless of origin.
    const sourceTableName = pickedTable;

    useEffect(() => {
        if (!isOpen || !sourceTableName) {
            setColumns([]);
            return;
        }
        let cancelled = false;
        setColumnsLoading(true);
        const token = localStorage.getItem("authToken") || "";
        fetch(`${chartApiUrl}/data/schema/${projectId}/${sourceTableName}`, {
            headers: { "x-auth-token": token },
        })
            .then((r) => r.ok ? r.json() : { columns: [] })
            .then((j) => {
                if (cancelled) return;
                const cols: ColumnRow[] = Array.isArray(j.columns) ? j.columns : [];
                setColumns(cols);
                setX(""); setY(""); setColor("");
            })
            .catch(() => { if (!cancelled) setColumns([]); })
            .finally(() => { if (!cancelled) setColumnsLoading(false); });
        return () => { cancelled = true; };
    }, [isOpen, sourceTableName, chartApiUrl]);

    // Y is OPTIONAL whenever the user has picked an X dimension. Empty Y
    // collapses to COUNT(*) per X group regardless of the agg dropdown —
    // i.e. "show me a chart of X" works with one click. Big_number still
    // needs an explicit Y because it has no X to count by.
    const yIsOptional = chartType !== "big_number" && !!x;
    const yReady = !!y || yIsOptional;
    const xReady = chartType === "big_number" || !!x;
    const fieldsReady = !!sourceTableName && yReady && xReady;
    // What we actually send to the backend: when Y is blank, override agg
    // to count so the backend produces COUNT(*).
    const effectiveAgg: Agg = !y ? "count" : agg;

    // Debounced preview.
    useEffect(() => {
        if (!isOpen) return;
        if (!fieldsReady) {
            setPreview(null);
            setPreviewErr(null);
            return;
        }
        let cancelled = false;
        setPreviewing(true);
        setPreviewErr(null);
        const handle = window.setTimeout(async () => {
            try {
                const token = localStorage.getItem("authToken") || "";
                const res = await fetch(`${apiUrl}/dashboards/preview-widget`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-auth-token": token },
                    body: JSON.stringify({
                        source: { projectId, tableName: sourceTableName },
                        // Empty y + effectiveAgg='count' tells the backend
                        // to produce COUNT(*) per X group. Sum/avg/min/etc
                        // still need an explicit Y column.
                        fields: { x, y, agg: effectiveAgg, ...(color ? { color } : {}) },
                        chartType,
                        title: title || null,
                        rowLimit: 5000,
                    }),
                });
                const body = await res.json().catch(() => ({}));
                if (cancelled) return;
                if (!res.ok) {
                    if (res.status === 404) {
                        throw new Error(
                            "Preview endpoint not found. Restart the user-auth service to load the new route.",
                        );
                    }
                    throw new Error(body.message || `HTTP ${res.status}`);
                }
                setPreview(body.data?.chartSpec || null);
            } catch (e) {
                if (cancelled) return;
                setPreview(null);
                setPreviewErr(e instanceof Error ? e.message : "Preview failed");
            } finally {
                if (!cancelled) setPreviewing(false);
            }
        }, 400);
        return () => { cancelled = true; window.clearTimeout(handle); };
    }, [isOpen, sourceTableName, x, y, agg, color, chartType, title, apiUrl, fieldsReady]);

    const canSave = fieldsReady && !saving;

    // Resolve connectorId + schema/name for re-ingest, when picking a connector table.
    // File-backed (source='upload') tables don't have a re-ingest path.
    const reingestHints = useMemo(() => {
        if (sourceKind !== "connector_table" || !sourceTableName) return {};
        const tableRow = tables.find((t) => t.table_name === sourceTableName);
        if (!tableRow || (tableRow.source || "").toLowerCase() === "upload") return {};

        // source_ref looks like "schema.name" (or just "name" for single-schema DBs).
        let sourceSchema: string | undefined;
        let sourceName: string | undefined;
        const ref = (tableRow.source_ref || "").trim();
        if (ref) {
            const idx = ref.indexOf(".");
            if (idx > 0) {
                sourceSchema = ref.slice(0, idx);
                sourceName = ref.slice(idx + 1);
            } else {
                sourceName = ref;
            }
        }

        // Match the connector by type + safeName(connector.name) prefix on table_name.
        const candidates = connectors.filter((c) => c.type === tableRow.source);
        let connectorId: string | undefined;
        const byPrefix = candidates.find((c) => sourceTableName.startsWith(`${safeName(c.name)}_`));
        if (byPrefix) {
            connectorId = byPrefix.id;
        } else if (candidates.length === 1) {
            // Heuristic fallback: when there's exactly one connector of that type,
            // assume it ingested this table.
            connectorId = candidates[0].id;
        }

        return { connectorId, sourceSchema, sourceName };
    }, [sourceKind, sourceTableName, tables, connectors]);

    const handleSave = async () => {
        if (!canSave) return;
        setSaving(true);
        try {
            // Both kinds end up as a warehouse table query; the kind label
            // is preserved on the widget config so renderer/refresh can
            // tell file-uploads apart from connector ingests if needed.
            await onSave({
                source: {
                    kind: sourceKind,
                    projectId,
                    tableName: sourceTableName,
                    ...reingestHints,
                },
                fields: { x, y, agg: effectiveAgg, ...(color ? { color } : {}) },
                chartType,
                title: title || undefined,
                refreshIntervalSec: 0,
                reingestOnRefresh: false,
            });
            onClose();
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-(--backdrop) backdrop-blur-sm" onClick={onClose} />

            <div className="relative w-full max-w-5xl rounded-2xl bg-(--bg-secondary) border border-(--border-primary) shadow-2xl flex flex-col max-h-[90vh]">
                <header className="flex items-center justify-between p-5 border-b border-(--border-primary)">
                    <div>
                        <p className="text-[10px] uppercase tracking-widest text-vanta-neon font-semibold mb-0.5">
                            Build a chart
                        </p>
                        <h2
                            className="text-lg font-bold text-(--text-primary)"
                            style={{ fontFamily: "var(--font-heading)" }}
                        >
                            Pick data → fields → chart
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 rounded-lg bg-(--bg-tertiary) hover:bg-(--bg-hover) text-(--text-muted) hover:text-(--text-primary) flex items-center justify-center"
                        aria-label="Close"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                </header>

                <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-0 min-h-[440px]">
                    {/* LEFT: pickers */}
                    <div className="p-5 space-y-4 border-r border-(--border-secondary)">
                        <section>
                            <label className="block text-xs font-semibold text-(--text-secondary) uppercase tracking-wider mb-2">
                                Source
                            </label>
                            <div className="flex gap-2 mb-2">
                                {([
                                    { id: "connector_table" as SourceKind, label: "Connector table" },
                                    { id: "file" as SourceKind, label: "Uploaded file" },
                                ]).map((opt) => (
                                    <button
                                        key={opt.id}
                                        onClick={() => {
                                            if (opt.id !== sourceKind) {
                                                setSourceKind(opt.id);
                                                setPickedTable("");
                                            }
                                        }}
                                        className={`flex-1 h-9 rounded-md text-xs font-semibold transition-colors ${
                                            sourceKind === opt.id
                                                ? "bg-vanta-neon text-black"
                                                : "bg-(--bg-tertiary) text-(--text-muted) hover:text-(--text-primary)"
                                        }`}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                            {sourceKind === "connector_table" ? (
                                connectorTables.length === 0 ? (
                                    <div className="space-y-2">
                                        <p className="text-[11px] text-(--text-muted) px-1">
                                            No connector tables yet.
                                        </p>
                                        <button
                                            onClick={() => { onClose(); router.push("/dashboard/connectors"); }}
                                            className="w-full h-9 rounded-md bg-(--bg-tertiary) border border-vanta-neon/30 text-vanta-neon text-xs font-semibold hover:bg-vanta-neon/10"
                                        >
                                            + Add a connector
                                        </button>
                                    </div>
                                ) : (
                                    <select
                                        value={pickedTable}
                                        onChange={(e) => setPickedTable(e.target.value)}
                                        className="w-full h-10 px-3 rounded-md bg-(--bg-tertiary) border border-(--border-primary) text-sm text-(--text-primary)"
                                    >
                                        <option value="">Pick a table…</option>
                                        {connectorTables.map((t) => (
                                            <option key={t.table_name} value={t.table_name}>
                                                {t.table_name}{t.source ? ` · ${t.source}` : ""}
                                            </option>
                                        ))}
                                    </select>
                                )
                            ) : (
                                <div className="space-y-2">
                                    {fileTables.length === 0 && filesNeedingImport.length === 0 ? (
                                        <p className="text-[11px] text-(--text-muted) px-1">
                                            No uploaded files yet — upload one to use it here.
                                        </p>
                                    ) : (
                                        <select
                                            value={pickedTable}
                                            onChange={(e) => setPickedTable(e.target.value)}
                                            className="w-full h-10 px-3 rounded-md bg-(--bg-tertiary) border border-(--border-primary) text-sm text-(--text-primary)"
                                        >
                                            <option value="">Pick a file…</option>
                                            {fileTables.map((t) => (
                                                <option key={t.table_name} value={t.table_name}>
                                                    {t.source_ref || t.table_name}
                                                    {typeof t.row_count === "number" ? ` · ${t.row_count.toLocaleString()} rows` : ""}
                                                </option>
                                            ))}
                                        </select>
                                    )}

                                    {filesNeedingImport.length > 0 && (
                                        <div className="rounded-md border border-(--border-primary) bg-(--bg-tertiary)/40 p-2 space-y-1.5">
                                            <p className="text-[10px] uppercase tracking-wider text-(--text-muted) font-semibold">
                                                Files needing import ({filesNeedingImport.length})
                                            </p>
                                            <ul className="space-y-1">
                                                {filesNeedingImport.slice(0, 5).map((f) => {
                                                    const isImporting = importingFileId === f.id;
                                                    return (
                                                        <li key={f.id} className="flex items-center gap-2 text-[11px]">
                                                            <span className="flex-1 truncate text-(--text-primary)" title={f.name}>{f.name}</span>
                                                            <button
                                                                onClick={() => importUserAuthFile(f.id)}
                                                                disabled={isImporting}
                                                                className="px-2 h-6 rounded bg-vanta-neon/15 border border-vanta-neon/40 text-vanta-neon text-[10px] font-semibold hover:bg-vanta-neon/25 disabled:opacity-60"
                                                            >
                                                                {isImporting ? "…" : "Import"}
                                                            </button>
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                            {importErr && (
                                                <p className="text-[10px] text-(--error) px-1">{importErr}</p>
                                            )}
                                        </div>
                                    )}

                                    <button
                                        onClick={() => setShowInlineUpload(true)}
                                        className="w-full h-9 rounded-md bg-(--bg-tertiary) border border-vanta-neon/30 text-vanta-neon text-xs font-semibold hover:bg-vanta-neon/10"
                                    >
                                        + Upload a CSV / Excel now
                                    </button>
                                </div>
                            )}
                        </section>

                        <section>
                            <label className="block text-xs font-semibold text-(--text-secondary) uppercase tracking-wider mb-2">
                                Fields
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                                <FieldSelect
                                    label={chartType === "big_number" ? "X (n/a for big number)" : "X — group by"}
                                    value={x}
                                    onChange={setX}
                                    columns={columns}
                                    disabled={!sourceTableName || columnsLoading || chartType === "big_number"}
                                />
                                <FieldSelect
                                    label={yIsOptional ? "Y — measure (optional, defaults to count)" : "Y — measure"}
                                    value={y}
                                    onChange={setY}
                                    columns={columns}
                                    optional={yIsOptional}
                                    disabled={!sourceTableName || columnsLoading}
                                    placeholderForOptional={yIsOptional ? "(count rows)" : undefined}
                                />
                                <div>
                                    <label className="text-[10px] uppercase tracking-wider text-(--text-muted) font-semibold">Aggregation</label>
                                    <select
                                        value={agg}
                                        onChange={(e) => setAgg(e.target.value as Agg)}
                                        className="mt-1 w-full h-9 px-2 rounded-md bg-(--bg-tertiary) border border-(--border-primary) text-xs text-(--text-primary)"
                                    >
                                        {AGG_OPTIONS.map((o) => (
                                            <option key={o.value} value={o.value}>{o.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <FieldSelect
                                    label="Color / Series"
                                    value={color}
                                    onChange={setColor}
                                    columns={columns}
                                    optional
                                    disabled={!sourceTableName || columnsLoading || chartType === "big_number"}
                                />
                            </div>
                            {yIsOptional && !y && (
                                <p className="text-[11px] text-(--text-muted) mt-2">
                                    Pick X and you&apos;re done — empty Y → <code className="font-mono">COUNT(*)</code> per X group. Pick a Y column for SUM/AVG/MIN/MAX.
                                </p>
                            )}
                        </section>

                        <section>
                            <label className="block text-xs font-semibold text-(--text-secondary) uppercase tracking-wider mb-2">
                                Chart type
                            </label>
                            <div className="grid grid-cols-4 gap-1.5">
                                {CHART_TYPES.map((c) => (
                                    <button
                                        key={c.id}
                                        onClick={() => setChartType(c.id)}
                                        className={`flex flex-col items-center justify-center h-16 rounded-md text-[10px] font-medium transition-all border ${
                                            chartType === c.id
                                                ? "bg-vanta-neon text-black border-vanta-neon"
                                                : "bg-(--bg-tertiary) text-(--text-secondary) border-(--border-primary) hover:border-vanta-neon/40"
                                        }`}
                                    >
                                        <span className="text-base font-bold mb-0.5" style={{ fontFamily: "monospace" }}>{c.icon}</span>
                                        {c.label}
                                    </button>
                                ))}
                            </div>
                        </section>

                        <section>
                            <label className="block text-xs font-semibold text-(--text-secondary) uppercase tracking-wider mb-2">
                                Title (optional)
                            </label>
                            <input
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="Auto-generated from fields"
                                className="w-full h-10 px-3 rounded-md bg-(--bg-tertiary) border border-(--border-primary) text-sm text-(--text-primary) placeholder:text-(--text-muted)"
                            />
                        </section>
                    </div>

                    {/* RIGHT: preview */}
                    <div className="p-5 flex flex-col min-h-[440px] bg-(--bg-tertiary)/30">
                        <p className="text-xs font-semibold text-(--text-secondary) uppercase tracking-wider mb-3">
                            Preview {previewing && <span className="text-(--text-muted) font-normal normal-case">· refreshing…</span>}
                        </p>
                        <div className="flex-1 min-h-0 rounded-md bg-(--bg-secondary) border border-(--border-primary) p-3">
                            {previewErr ? (
                                <div className="text-xs text-(--error)">{previewErr}</div>
                            ) : preview ? (
                                <ChartRenderer chart={preview as never} height="100%" />
                            ) : (
                                <div className="h-full flex items-center justify-center text-xs text-(--text-muted) text-center px-4">
                                    {!sourceTableName ? (
                                        "Pick a source table to begin."
                                    ) : !xReady ? (
                                        "Pick an X column to group by."
                                    ) : !yReady ? (
                                        "Pick a Y measure for big-number charts."
                                    ) : (
                                        "Loading preview…"
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <footer className="p-5 border-t border-(--border-primary) flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 h-11 rounded-xl bg-(--bg-tertiary) hover:bg-(--bg-hover) text-(--text-primary) font-medium"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!canSave}
                        className="flex-[2] h-11 rounded-xl bg-vanta-neon text-black font-bold hover:bg-vanta-neon/90 disabled:opacity-60"
                    >
                        {saving ? "Saving…" : "Add to board"}
                    </button>
                </footer>
            </div>

            {/* Inline upload — keeps the builder open. After upload finishes,
                re-fetch tables so the new file appears in the picker. */}
            <QuickUploadModal
                isOpen={showInlineUpload}
                onClose={() => {
                    setShowInlineUpload(false);
                    loadTables();
                }}
            />
        </div>
    );
}

function FieldSelect({
    label,
    value,
    onChange,
    columns,
    optional,
    placeholderForOptional,
    disabled,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    columns: ColumnRow[];
    optional?: boolean;
    placeholderForOptional?: string;
    disabled?: boolean;
}) {
    return (
        <div>
            <label className="text-[10px] uppercase tracking-wider text-(--text-muted) font-semibold">{label}</label>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                className="mt-1 w-full h-9 px-2 rounded-md bg-(--bg-tertiary) border border-(--border-primary) text-xs text-(--text-primary) disabled:opacity-50"
            >
                <option value="">
                    {optional ? (placeholderForOptional || "(none)") : "Pick a column…"}
                </option>
                {columns.map((c) => (
                    <option key={c.name} value={c.name}>
                        {c.name}{c.type ? ` · ${c.type}` : ""}
                    </option>
                ))}
            </select>
        </div>
    );
}
