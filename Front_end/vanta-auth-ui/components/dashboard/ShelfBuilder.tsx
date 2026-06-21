"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ChartRenderer from "@/components/charts/ChartRenderer";
import QuickUploadModal from "./QuickUploadModal";

/**
 * Tableau-style shelf builder.
 *
 * Full-screen overlay. Three-pane layout:
 *   Left rail   (260px): Marks (chart type) + searchable Fields list with
 *                        click-to-add action buttons per field row.
 *   Center     (flex):   Shelves (Columns / Rows / Color / Filters) on
 *                        top, large live preview below.
 *
 * Fields with numeric DuckDB types auto-classify as measures; everything
 * else as a dimension. The action buttons on each field row reflect that:
 * dimensions show +X, +Color, +Filter; measures show +Y (with the active
 * aggregation) and +Filter.
 *
 * "Count rows" is a one-click action — it adds a Y measure with col=""
 * and agg=count, which the backend resolves to COUNT(*).
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

type Agg = "sum" | "avg" | "count" | "count_distinct" | "min" | "max" | "median" | "stdev" | "none";

interface MeasureChip {
    col: string;     // empty string = COUNT(*)
    agg: Agg;
}

interface FilterChip {
    col: string;
    op: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "between" | "contains" | "is null" | "is not null";
    value: string;
}

interface CalculatedField {
    name: string;
    expr: string;
}

const CHART_TYPES: Array<{ id: string; label: string; icon: string }> = [
    { id: "bar_chart", label: "Bar", icon: "▮▮▮" },
    { id: "line_chart", label: "Line", icon: "／＼" },
    { id: "area_chart", label: "Area", icon: "▰▰▰" },
    { id: "pie_chart", label: "Pie", icon: "◔" },
    { id: "donut_chart", label: "Donut", icon: "◍" },
    { id: "scatter_plot", label: "Scatter", icon: "·∴·" },
    { id: "heatmap", label: "Heatmap", icon: "▦" },
    { id: "big_number", label: "Big number", icon: "123" },
];

const AGG_LABELS: Record<Agg, string> = {
    sum: "SUM", avg: "AVG", count: "COUNT", count_distinct: "COUNT DIST",
    min: "MIN", max: "MAX", median: "MED", stdev: "STDEV", none: "NONE",
};

const MEASURE_AGG_OPTIONS: Agg[] = ["sum", "avg", "count", "count_distinct", "min", "max", "median", "stdev", "none"];

function isMeasureType(type: string | undefined): boolean {
    const t = (type || "").toLowerCase();
    return /(int|bigint|smallint|tinyint|float|double|decimal|numeric|real|hugeint)/.test(t);
}

function safeName(raw: string): string {
    return (raw || "")
        .trim()
        .replace(/[^A-Za-z0-9_]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
        .toLowerCase() || "untitled";
}

export interface ShelfBuilderConfig {
    source: {
        kind: "connector_table";
        projectId: string;
        tableName: string;
        connectorId?: string;
        sourceSchema?: string;
        sourceName?: string;
    };
    fields: {
        x: string[];
        y: MeasureChip[];
        color: string[];
        filters: FilterChip[];
        calculated: CalculatedField[];
    };
    chartType: string;
    title?: string;
    refreshIntervalSec?: number;
    reingestOnRefresh?: boolean;
}

export default function ShelfBuilder({
    isOpen,
    onClose,
    onSave,
}: {
    isOpen: boolean;
    onClose: () => void;
    onSave: (cfg: ShelfBuilderConfig) => Promise<void> | void;
}) {
    const router = useRouter();
    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1";
    const chartApiUrl = process.env.NEXT_PUBLIC_CHART_API_URL || "http://127.0.0.1:8000";
    const projectId = "default";

    const [tables, setTables] = useState<CatalogTable[]>([]);
    const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
    const [pickedTable, setPickedTable] = useState<string>("");
    const [showInlineUpload, setShowInlineUpload] = useState(false);
    const [columns, setColumns] = useState<ColumnRow[]>([]);
    const [columnsLoading, setColumnsLoading] = useState(false);

    const [xDims, setXDims] = useState<string[]>([]);
    const [yMeas, setYMeas] = useState<MeasureChip[]>([]);
    const [colorDims, setColorDims] = useState<string[]>([]);
    const [filters, setFilters] = useState<FilterChip[]>([]);
    const [calculated, setCalculated] = useState<CalculatedField[]>([]);
    const [chartType, setChartType] = useState<string>("bar_chart");
    const [title, setTitle] = useState<string>("");
    const [defaultAgg, setDefaultAgg] = useState<Agg>("sum");

    const [fieldSearch, setFieldSearch] = useState("");

    const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
    const [previewing, setPreviewing] = useState(false);
    const [previewErr, setPreviewErr] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const [showCalcModal, setShowCalcModal] = useState(false);
    const [showFilterAdder, setShowFilterAdder] = useState<string | null>(null); // column being filtered

    const reset = useCallback(() => {
        setPickedTable("");
        setColumns([]);
        setXDims([]); setYMeas([]); setColorDims([]); setFilters([]); setCalculated([]);
        setChartType("bar_chart"); setTitle("");
        setDefaultAgg("sum");
        setFieldSearch("");
        setPreview(null); setPreviewErr(null);
        setShowFilterAdder(null);
    }, []);

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

    useEffect(() => {
        if (!isOpen) return;
        reset();
        loadTables();
        const token = localStorage.getItem("authToken") || "";
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
    }, [isOpen, apiUrl, loadTables, reset]);

    useEffect(() => {
        if (!isOpen || !pickedTable) {
            setColumns([]);
            return;
        }
        let cancelled = false;
        setColumnsLoading(true);
        const token = localStorage.getItem("authToken") || "";
        fetch(`${chartApiUrl}/data/schema/${projectId}/${pickedTable}`, {
            headers: { "x-auth-token": token },
        })
            .then((r) => r.ok ? r.json() : { columns: [] })
            .then((j) => {
                if (cancelled) return;
                setColumns(Array.isArray(j.columns) ? j.columns : []);
                setXDims([]); setYMeas([]); setColorDims([]); setFilters([]);
            })
            .catch(() => { if (!cancelled) setColumns([]); })
            .finally(() => { if (!cancelled) setColumnsLoading(false); });
        return () => { cancelled = true; };
    }, [isOpen, pickedTable, chartApiUrl]);

    const dimensions = useMemo(() => columns.filter((c) => !isMeasureType(c.type)), [columns]);
    const measures = useMemo(() => columns.filter((c) => isMeasureType(c.type)), [columns]);

    const reingestHints = useMemo(() => {
        if (!pickedTable) return {};
        const tableRow = tables.find((t) => t.table_name === pickedTable);
        if (!tableRow || (tableRow.source || "").toLowerCase() === "upload") return {};
        let sourceSchema: string | undefined;
        let sourceName: string | undefined;
        const ref = (tableRow.source_ref || "").trim();
        if (ref) {
            const idx = ref.indexOf(".");
            if (idx > 0) { sourceSchema = ref.slice(0, idx); sourceName = ref.slice(idx + 1); }
            else { sourceName = ref; }
        }
        const candidates = connectors.filter((c) => c.type === tableRow.source);
        let connectorId: string | undefined;
        const byPrefix = candidates.find((c) => pickedTable.startsWith(`${safeName(c.name)}_`));
        if (byPrefix) connectorId = byPrefix.id;
        else if (candidates.length === 1) connectorId = candidates[0].id;
        return { connectorId, sourceSchema, sourceName };
    }, [pickedTable, tables, connectors]);

    // Filtered field lists for the search box.
    const filteredDims = useMemo(() => {
        const q = fieldSearch.trim().toLowerCase();
        if (!q) return dimensions;
        return dimensions.filter((c) => c.name.toLowerCase().includes(q));
    }, [dimensions, fieldSearch]);
    const filteredMeasures = useMemo(() => {
        const q = fieldSearch.trim().toLowerCase();
        if (!q) return measures;
        return measures.filter((c) => c.name.toLowerCase().includes(q));
    }, [measures, fieldSearch]);
    const filteredCalcs = useMemo(() => {
        const q = fieldSearch.trim().toLowerCase();
        if (!q) return calculated;
        return calculated.filter((c) => c.name.toLowerCase().includes(q));
    }, [calculated, fieldSearch]);

    // Validation. Y is OPTIONAL — when empty, the backend defaults to
    // COUNT(*) per X group, which is the natural "show me a chart of X"
    // behaviour. X is required for everything except big_number.
    const xReady = chartType === "big_number" || xDims.length > 0;
    const yReady = yMeas.length > 0 || (chartType !== "big_number" && xDims.length > 0);
    const fieldsReady = !!pickedTable && xReady && yReady;

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
                        source: { projectId, tableName: pickedTable },
                        fields: {
                            x: xDims,
                            y: yMeas,
                            color: colorDims,
                            filters,
                            calculated,
                        },
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
    }, [isOpen, pickedTable, xDims, yMeas, colorDims, filters, calculated, chartType, title, apiUrl, fieldsReady]);

    // ---- mutators -----------------------------------------------------
    const addX = (col: string) => setXDims((m) => m.includes(col) ? m : [...m, col]);
    const addColor = (col: string) => setColorDims((m) => m.length ? m : [col]);
    const addY = (col: string, agg: Agg) =>
        setYMeas((m) => m.some((mm) => mm.col === col && mm.agg === agg) ? m : [...m, { col, agg }]);
    const addCountAll = () =>
        setYMeas((m) => m.some((mm) => mm.col === "" && mm.agg === "count") ? m : [...m, { col: "", agg: "count" }]);
    const removeX = (col: string) => setXDims((m) => m.filter((x) => x !== col));
    const removeColor = (col: string) => setColorDims((m) => m.filter((x) => x !== col));
    const removeYAt = (i: number) => setYMeas((m) => m.filter((_, idx) => idx !== i));
    const setYAggAt = (i: number, agg: Agg) =>
        setYMeas((m) => m.map((mm, idx) => idx === i ? { ...mm, agg } : mm));
    const removeFilterAt = (i: number) => setFilters((m) => m.filter((_, idx) => idx !== i));

    const handleSave = async () => {
        if (!fieldsReady || saving) return;
        setSaving(true);
        try {
            await onSave({
                source: {
                    kind: "connector_table",
                    projectId,
                    tableName: pickedTable,
                    ...reingestHints,
                },
                fields: {
                    x: xDims,
                    y: yMeas,
                    color: colorDims,
                    filters,
                    calculated,
                },
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
        <div className="fixed inset-0 z-100 bg-(--bg-primary) text-(--text-primary) flex flex-col">
            {/* HEADER */}
            <header className="flex items-center justify-between px-6 h-14 border-b border-(--border-primary) bg-(--bg-secondary)">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="text-[10px] uppercase tracking-widest text-vanta-neon font-semibold">Build chart</span>
                    <select
                        value={pickedTable}
                        onChange={(e) => setPickedTable(e.target.value)}
                        className="h-8 px-2 text-xs rounded-md bg-(--bg-tertiary) border border-(--border-primary) min-w-[180px] max-w-[280px]"
                    >
                        <option value="">Pick a table…</option>
                        <optgroup label="Connector tables">
                            {tables.filter((t) => (t.source || "").toLowerCase() !== "upload").map((t) => (
                                <option key={t.table_name} value={t.table_name}>
                                    {t.table_name}{t.source ? ` · ${t.source}` : ""}
                                </option>
                            ))}
                        </optgroup>
                        <optgroup label="Uploaded files">
                            {tables.filter((t) => (t.source || "").toLowerCase() === "upload").map((t) => (
                                <option key={t.table_name} value={t.table_name}>
                                    {t.source_ref || t.table_name}
                                </option>
                            ))}
                        </optgroup>
                    </select>
                    <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Title (optional)"
                        className="h-8 px-2 text-xs rounded-md bg-(--bg-tertiary) border border-(--border-primary) flex-1 max-w-[320px]"
                    />
                </div>
                <div className="flex items-center gap-2 flex-none">
                    <button
                        onClick={() => setShowInlineUpload(true)}
                        className="h-8 px-3 text-xs rounded-md bg-(--bg-tertiary) hover:bg-vanta-neon/10 hover:text-vanta-neon"
                        title="Upload a new CSV/Excel into the warehouse"
                    >
                        + Upload file
                    </button>
                    <button
                        onClick={() => { onClose(); router.push("/dashboard/connectors"); }}
                        className="h-8 px-3 text-xs rounded-md bg-(--bg-tertiary) hover:bg-vanta-neon/10 hover:text-vanta-neon"
                        title="Add a database connection"
                    >
                        + Add connector
                    </button>
                    <button
                        onClick={onClose}
                        className="h-8 px-3 text-xs rounded-md bg-(--bg-tertiary) hover:bg-(--bg-hover)"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!fieldsReady || saving}
                        className="h-8 px-4 text-xs font-bold rounded-md bg-vanta-neon text-black hover:bg-vanta-neon/90 disabled:opacity-50"
                        title={!fieldsReady ? "Add at least one X dimension and one Y measure" : "Save to a board"}
                    >
                        {saving ? "Saving…" : "Save to board"}
                    </button>
                </div>
            </header>

            {/* BODY */}
            <div className="flex-1 grid grid-cols-[280px_1fr] min-h-0">
                {/* LEFT RAIL */}
                <aside className="border-r border-(--border-secondary) overflow-y-auto bg-(--bg-secondary)/40 flex flex-col">
                    {/* Marks */}
                    <section className="p-3 border-b border-(--border-secondary)">
                        <p className="text-[10px] uppercase tracking-wider font-semibold text-(--text-muted) mb-2">
                            Mark
                        </p>
                        <div className="grid grid-cols-2 gap-1.5">
                            {CHART_TYPES.map((c) => (
                                <button
                                    key={c.id}
                                    onClick={() => setChartType(c.id)}
                                    className={`flex flex-col items-center justify-center h-14 rounded-md text-[10px] font-medium transition-all border ${
                                        chartType === c.id
                                            ? "bg-vanta-neon text-black border-vanta-neon shadow-md shadow-vanta-neon/20"
                                            : "bg-(--bg-tertiary) text-(--text-secondary) border-(--border-primary) hover:border-vanta-neon/40 hover:text-(--text-primary)"
                                    }`}
                                >
                                    <span className="text-base font-bold mb-0.5" style={{ fontFamily: "monospace" }}>{c.icon}</span>
                                    {c.label}
                                </button>
                            ))}
                        </div>
                    </section>

                    {/* Default agg picker */}
                    <section className="p-3 border-b border-(--border-secondary)">
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-[10px] uppercase tracking-wider font-semibold text-(--text-muted)">
                                Default agg
                            </p>
                            <select
                                value={defaultAgg}
                                onChange={(e) => setDefaultAgg(e.target.value as Agg)}
                                className="text-[10px] h-6 px-1.5 rounded bg-(--bg-tertiary) border border-(--border-primary)"
                                title="Aggregation applied when you click +Y on a measure"
                            >
                                {MEASURE_AGG_OPTIONS.map((a) => (
                                    <option key={a} value={a}>{AGG_LABELS[a]}</option>
                                ))}
                            </select>
                        </div>
                        <button
                            onClick={addCountAll}
                            disabled={!pickedTable}
                            className="w-full h-8 px-2 text-[11px] rounded bg-vanta-neon/10 border border-vanta-neon/40 text-vanta-neon hover:bg-vanta-neon/20 font-semibold disabled:opacity-40"
                            title="Adds COUNT(*) as a Y measure — no column needed"
                        >
                            + Count rows (Y)
                        </button>
                    </section>

                    {/* Field search + list */}
                    <section className="p-3 flex-1 overflow-y-auto">
                        <input
                            value={fieldSearch}
                            onChange={(e) => setFieldSearch(e.target.value)}
                            placeholder="Search fields…"
                            disabled={!pickedTable}
                            className="w-full h-8 px-2 text-[11px] rounded-md bg-(--bg-tertiary) border border-(--border-primary) mb-3 disabled:opacity-50"
                        />
                        {!pickedTable && (
                            <p className="text-[11px] text-(--text-muted) italic">
                                Pick a table above to load its fields.
                            </p>
                        )}

                        {pickedTable && columnsLoading && (
                            <div className="space-y-1">
                                {[0, 1, 2, 3].map((i) => (
                                    <div key={i} className="h-7 rounded bg-(--bg-tertiary) animate-pulse" />
                                ))}
                            </div>
                        )}

                        {pickedTable && !columnsLoading && (
                            <>
                                <FieldGroup
                                    title="Dimensions"
                                    rows={filteredDims}
                                    accent="text-blue-400"
                                    renderActions={(c) => (
                                        <DimActions
                                            inX={xDims.includes(c.name)}
                                            inColor={colorDims.includes(c.name)}
                                            onAddX={() => addX(c.name)}
                                            onAddColor={() => addColor(c.name)}
                                            onAddFilter={() => setShowFilterAdder(c.name)}
                                        />
                                    )}
                                />
                                <FieldGroup
                                    title="Measures"
                                    rows={filteredMeasures}
                                    accent="text-amber-400"
                                    renderActions={(c) => (
                                        <MeasureActions
                                            onAddY={() => addY(c.name, defaultAgg)}
                                            onAddFilter={() => setShowFilterAdder(c.name)}
                                            agg={defaultAgg}
                                        />
                                    )}
                                />

                                <div className="mt-4">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="text-[10px] uppercase tracking-wider font-semibold text-(--text-muted)">Calculated</span>
                                        <button
                                            onClick={() => setShowCalcModal(true)}
                                            className="text-[10px] text-vanta-neon hover:underline"
                                        >
                                            + new
                                        </button>
                                    </div>
                                    {filteredCalcs.length === 0 ? (
                                        <p className="text-[10px] text-(--text-muted) italic">
                                            No calculated fields.
                                        </p>
                                    ) : (
                                        <ul className="space-y-1">
                                            {filteredCalcs.map((c) => (
                                                <li key={c.name} className="flex items-center gap-1 text-[11px] group">
                                                    <span className="font-mono text-vanta-neon truncate flex-1" title={c.expr}>
                                                        {c.name}
                                                    </span>
                                                    <button
                                                        onClick={() => addX(c.name)}
                                                        className="text-[9px] px-1 h-5 rounded bg-(--bg-tertiary) hover:bg-vanta-neon/20"
                                                        title="Add to X"
                                                    >X</button>
                                                    <button
                                                        onClick={() => addY(c.name, "none")}
                                                        className="text-[9px] px-1 h-5 rounded bg-(--bg-tertiary) hover:bg-vanta-neon/20"
                                                        title="Add to Y (raw)"
                                                    >Y</button>
                                                    <button
                                                        onClick={() => setCalculated((m) => m.filter((x) => x.name !== c.name))}
                                                        className="opacity-0 group-hover:opacity-100 text-(--error) text-xs px-0.5"
                                                        title="Delete"
                                                    >×</button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </>
                        )}
                    </section>
                </aside>

                {/* CENTER */}
                <main className="overflow-y-auto p-5 space-y-3 flex flex-col min-h-0">
                    <div className="space-y-2 flex-none">
                        <ChipShelf
                            label={chartType === "big_number" ? "Columns (X) — n/a for big number" : "Columns (X)"}
                            empty={chartType === "big_number"
                                ? "Big number ignores X."
                                : "Click +X on any field on the left."}
                            disabled={chartType === "big_number"}
                        >
                            {xDims.map((c) => (
                                <Chip key={c} color="blue" onRemove={() => removeX(c)}>{c}</Chip>
                            ))}
                        </ChipShelf>

                        <YShelf
                            label="Rows (Y) — measures"
                            empty={
                                xDims.length > 0
                                    ? "Empty Y → counts rows per X. Click +Y on a measure to override."
                                    : "Click +Y on a measure (optional — defaults to COUNT(*))."
                            }
                            chips={yMeas}
                            onRemoveAt={removeYAt}
                            onChangeAggAt={setYAggAt}
                        />

                        <ChipShelf
                            label="Color / Series"
                            empty="Click +Color on a dimension."
                            disabled={chartType === "big_number"}
                        >
                            {colorDims.map((c) => (
                                <Chip key={c} color="violet" onRemove={() => removeColor(c)}>{c}</Chip>
                            ))}
                        </ChipShelf>

                        <ChipShelf
                            label="Filters"
                            empty="Click +Filter on any field."
                        >
                            {filters.map((f, i) => (
                                <Chip
                                    key={`${f.col}-${i}`}
                                    color="orange"
                                    onRemove={() => removeFilterAt(i)}
                                >
                                    <span className="font-medium">{f.col}</span>
                                    <span className="opacity-70 mx-1">{f.op}</span>
                                    <span className="font-mono opacity-90">{f.value}</span>
                                </Chip>
                            ))}
                        </ChipShelf>
                    </div>

                    {/* PREVIEW */}
                    <div className="flex-1 min-h-0 rounded-xl border border-(--border-primary) bg-(--bg-secondary) p-4 flex flex-col">
                        <div className="flex items-center justify-between text-[11px] mb-2">
                            <span className="font-semibold text-(--text-secondary) uppercase tracking-wider">
                                Preview
                            </span>
                            <span className="text-(--text-muted)">
                                {previewing
                                    ? "refreshing…"
                                    : preview
                                    ? `${chartType.replace("_", " ")}`
                                    : ""}
                            </span>
                        </div>
                        <div className="flex-1 min-h-0">
                            {previewErr ? (
                                <div className="h-full flex items-center justify-center text-center px-6">
                                    <div>
                                        <p className="text-sm text-(--error) mb-1">{previewErr}</p>
                                        <p className="text-[11px] text-(--text-muted)">
                                            Check that <code>back_end/user-auth-main</code> and{" "}
                                            <code>back_end/Chart-API-main</code> are running.
                                        </p>
                                    </div>
                                </div>
                            ) : preview ? (
                                <ChartRenderer chart={preview as never} height="100%" />
                            ) : (
                                <div className="h-full flex items-center justify-center text-center px-6">
                                    <p className="text-xs text-(--text-muted)">
                                        {!pickedTable
                                            ? "Pick a table above."
                                            : !xReady
                                            ? "Add an X dimension to group by."
                                            : "Loading preview…"}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </main>
            </div>

            {showCalcModal && (
                <CalcFieldEditor
                    onCancel={() => setShowCalcModal(false)}
                    onSave={(field) => {
                        setCalculated((m) => [...m.filter((x) => x.name !== field.name), field]);
                        setShowCalcModal(false);
                    }}
                    columns={columns}
                />
            )}

            {showFilterAdder && (
                <FilterAdderModal
                    column={showFilterAdder}
                    onCancel={() => setShowFilterAdder(null)}
                    onAdd={(f) => {
                        setFilters((m) => [...m, f]);
                        setShowFilterAdder(null);
                    }}
                />
            )}

            {/* Inline upload — keeps the shelf builder open. After the
                user uploads, refetch /data/tables so the new file shows
                up in the source picker without a manual refresh. */}
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

// ----- subcomponents ------------------------------------------------------

function FieldGroup({
    title, rows, accent, renderActions,
}: {
    title: string;
    rows: ColumnRow[];
    accent: string;
    renderActions: (c: ColumnRow) => React.ReactNode;
}) {
    return (
        <div className="mb-4">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-(--text-muted) mb-1.5">
                {title} <span className="text-(--text-muted)/70">· {rows.length}</span>
            </div>
            {rows.length === 0 ? (
                <p className="text-[10px] text-(--text-muted) italic">none</p>
            ) : (
                <ul className="space-y-1">
                    {rows.map((c) => (
                        <li
                            key={c.name}
                            className="flex items-center gap-1.5 group rounded-md hover:bg-(--bg-tertiary) px-1.5 py-1"
                        >
                            <div className="flex-1 min-w-0">
                                <p className={`text-[11px] font-mono ${accent} truncate`} title={c.name}>
                                    {c.name}
                                </p>
                                <p className="text-[9px] text-(--text-muted) truncate">{c.type}</p>
                            </div>
                            <div className="flex items-center gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity flex-none">
                                {renderActions(c)}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function DimActions({
    inX, inColor, onAddX, onAddColor, onAddFilter,
}: {
    inX: boolean;
    inColor: boolean;
    onAddX: () => void;
    onAddColor: () => void;
    onAddFilter: () => void;
}) {
    return (
        <>
            <SmallBtn onClick={onAddX} active={inX} title="Add to Columns (X)">X</SmallBtn>
            <SmallBtn onClick={onAddColor} active={inColor} title="Add to Color / Series">C</SmallBtn>
            <SmallBtn onClick={onAddFilter} title="Add a filter on this field">F</SmallBtn>
        </>
    );
}

function MeasureActions({
    agg, onAddY, onAddFilter,
}: {
    agg: Agg;
    onAddY: () => void;
    onAddFilter: () => void;
}) {
    return (
        <>
            <SmallBtn onClick={onAddY} title={`Add to Rows (Y) — ${AGG_LABELS[agg]}`}>
                Y<span className="ml-0.5 opacity-70">{AGG_LABELS[agg].slice(0, 3)}</span>
            </SmallBtn>
            <SmallBtn onClick={onAddFilter} title="Add a filter">F</SmallBtn>
        </>
    );
}

function SmallBtn({
    children, onClick, active, title,
}: {
    children: React.ReactNode;
    onClick: () => void;
    active?: boolean;
    title: string;
}) {
    return (
        <button
            onClick={onClick}
            title={title}
            className={`text-[9px] px-1.5 h-5 min-w-[20px] rounded font-semibold transition-colors ${
                active
                    ? "bg-vanta-neon text-black"
                    : "bg-(--bg-tertiary) text-(--text-secondary) hover:bg-vanta-neon/20 hover:text-vanta-neon"
            }`}
        >
            {children}
        </button>
    );
}

function ChipShelf({
    label, empty, children, disabled,
}: {
    label: string;
    empty: string;
    children: React.ReactNode;
    disabled?: boolean;
}) {
    const childArray = Array.isArray(children) ? children : [children];
    const hasChildren = childArray.flat().filter(Boolean).length > 0;
    return (
        <div className={`rounded-md bg-(--bg-secondary)/60 border ${disabled ? "border-(--border-secondary) opacity-60" : "border-(--border-primary)"} px-3 py-2 flex items-center gap-2 min-h-[42px]`}>
            <span className="text-[10px] uppercase tracking-wider font-semibold text-(--text-muted) w-36 flex-none">{label}</span>
            <div className="flex-1 flex flex-wrap gap-1.5 items-center">
                {hasChildren ? children : (
                    <span className="text-[10px] text-(--text-muted) italic">{empty}</span>
                )}
            </div>
        </div>
    );
}

function Chip({
    children, color, onRemove,
}: {
    children: React.ReactNode;
    color: "blue" | "amber" | "violet" | "orange";
    onRemove: () => void;
}) {
    const colors = {
        blue: "bg-blue-500/15 text-blue-300 border-blue-500/40",
        amber: "bg-amber-500/15 text-amber-300 border-amber-500/40",
        violet: "bg-violet-500/15 text-violet-300 border-violet-500/40",
        orange: "bg-orange-500/15 text-orange-300 border-orange-500/40",
    };
    return (
        <button
            onClick={onRemove}
            className={`inline-flex items-center text-[11px] px-2 h-7 rounded font-medium border ${colors[color]} hover:bg-(--error-bg) hover:text-(--error) hover:border-(--error)/40 transition-colors`}
            title="Click to remove"
        >
            <span className="font-mono truncate max-w-[160px]">{children}</span>
            <span className="ml-1.5 opacity-60">×</span>
        </button>
    );
}

function YShelf({
    label, empty, chips, onRemoveAt, onChangeAggAt,
}: {
    label: string;
    empty: string;
    chips: MeasureChip[];
    onRemoveAt: (i: number) => void;
    onChangeAggAt: (i: number, agg: Agg) => void;
}) {
    return (
        <div className="rounded-md bg-(--bg-secondary)/60 border border-(--border-primary) px-3 py-2 flex items-center gap-2 min-h-[42px]">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-(--text-muted) w-36 flex-none">{label}</span>
            <div className="flex-1 flex flex-wrap gap-1.5 items-center">
                {chips.length === 0 ? (
                    <span className="text-[10px] text-(--text-muted) italic">{empty}</span>
                ) : chips.map((m, i) => (
                    <span
                        key={`${m.col || "count_star"}-${i}`}
                        className="inline-flex items-center text-[11px] rounded bg-amber-500/15 text-amber-300 border border-amber-500/40 hover:bg-amber-500/25 transition-colors"
                    >
                        <select
                            value={m.agg}
                            onChange={(e) => onChangeAggAt(i, e.target.value as Agg)}
                            className="bg-transparent border-0 px-1.5 h-7 text-[10px] focus:outline-none cursor-pointer"
                            onClick={(e) => e.stopPropagation()}
                            title="Aggregation"
                        >
                            {MEASURE_AGG_OPTIONS.map((k) => <option key={k} value={k}>{AGG_LABELS[k]}</option>)}
                        </select>
                        <span className="px-1 opacity-50">·</span>
                        <span className="px-1 font-mono">{m.col || "*"}</span>
                        <button
                            onClick={() => onRemoveAt(i)}
                            className="px-1.5 h-7 hover:text-(--error) opacity-60 hover:opacity-100"
                            title="Remove"
                        >×</button>
                    </span>
                ))}
            </div>
        </div>
    );
}

function CalcFieldEditor({
    onSave, onCancel, columns,
}: {
    onSave: (f: CalculatedField) => void;
    onCancel: () => void;
    columns: ColumnRow[];
}) {
    const [name, setName] = useState("");
    const [expr, setExpr] = useState("");
    return (
        <div className="fixed inset-0 z-110 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-(--backdrop) backdrop-blur-sm" onClick={onCancel} />
            <div className="relative w-full max-w-md rounded-2xl bg-(--bg-secondary) border border-(--border-primary) p-5 shadow-2xl">
                <h3 className="text-sm font-bold text-(--text-primary) mb-3">New calculated field</h3>
                <label className="block mb-3">
                    <span className="text-[10px] uppercase tracking-wider text-(--text-muted)">Name</span>
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9_]/g, ""))}
                        placeholder="profit_margin"
                        className="mt-1 w-full h-9 px-2 text-xs rounded-md bg-(--bg-tertiary) border border-(--border-primary) font-mono"
                    />
                </label>
                <label className="block mb-3">
                    <span className="text-[10px] uppercase tracking-wider text-(--text-muted)">Expression (DuckDB SQL)</span>
                    <textarea
                        value={expr}
                        onChange={(e) => setExpr(e.target.value)}
                        rows={4}
                        placeholder='( "revenue" - "cost" ) / NULLIF("revenue", 0)'
                        className="mt-1 w-full px-2 py-2 text-xs rounded-md bg-(--bg-tertiary) border border-(--border-primary) font-mono leading-relaxed"
                    />
                </label>
                <p className="text-[10px] text-(--text-muted) mb-3">
                    Quote column names with double quotes. Subqueries, semicolons, and write
                    verbs are rejected. Available columns: {columns.slice(0, 8).map((c) => c.name).join(", ")}{columns.length > 8 ? "…" : ""}
                </p>
                <div className="flex gap-2">
                    <button
                        onClick={onCancel}
                        className="flex-1 h-9 rounded-md bg-(--bg-tertiary) text-xs font-medium"
                    >Cancel</button>
                    <button
                        onClick={() => name && expr && onSave({ name, expr })}
                        disabled={!name || !expr}
                        className="flex-[2] h-9 rounded-md bg-vanta-neon text-black text-xs font-bold disabled:opacity-50"
                    >Add field</button>
                </div>
            </div>
        </div>
    );
}

function FilterAdderModal({
    column, onCancel, onAdd,
}: {
    column: string;
    onCancel: () => void;
    onAdd: (f: FilterChip) => void;
}) {
    const [op, setOp] = useState<FilterChip["op"]>("=");
    const [value, setValue] = useState("");
    const noValue = op === "is null" || op === "is not null";
    return (
        <div className="fixed inset-0 z-110 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-(--backdrop) backdrop-blur-sm" onClick={onCancel} />
            <div className="relative w-full max-w-sm rounded-2xl bg-(--bg-secondary) border border-(--border-primary) p-5 shadow-2xl">
                <h3 className="text-sm font-bold text-(--text-primary) mb-3">
                    Filter on <span className="font-mono text-vanta-neon">{column}</span>
                </h3>
                <label className="block mb-3">
                    <span className="text-[10px] uppercase tracking-wider text-(--text-muted)">Operator</span>
                    <select
                        value={op}
                        onChange={(e) => setOp(e.target.value as FilterChip["op"])}
                        className="mt-1 w-full h-9 px-2 text-xs rounded-md bg-(--bg-tertiary) border border-(--border-primary)"
                    >
                        <option value="=">=</option>
                        <option value="!=">≠</option>
                        <option value="<">&lt;</option>
                        <option value="<=">≤</option>
                        <option value=">">&gt;</option>
                        <option value=">=">≥</option>
                        <option value="contains">contains</option>
                        <option value="is null">is null</option>
                        <option value="is not null">is not null</option>
                    </select>
                </label>
                {!noValue && (
                    <label className="block mb-3">
                        <span className="text-[10px] uppercase tracking-wider text-(--text-muted)">Value</span>
                        <input
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            placeholder="value"
                            className="mt-1 w-full h-9 px-2 text-xs rounded-md bg-(--bg-tertiary) border border-(--border-primary)"
                        />
                    </label>
                )}
                <div className="flex gap-2">
                    <button
                        onClick={onCancel}
                        className="flex-1 h-9 rounded-md bg-(--bg-tertiary) text-xs font-medium"
                    >Cancel</button>
                    <button
                        onClick={() => onAdd({ col: column, op, value })}
                        disabled={!noValue && !value}
                        className="flex-[2] h-9 rounded-md bg-vanta-neon text-black text-xs font-bold disabled:opacity-50"
                    >Add filter</button>
                </div>
            </div>
        </div>
    );
}
