"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ConnectorIcon, { type ConnectorType } from "@/components/dashboard/ConnectorIcons";
import ConnectorWizard, { CONNECTOR_TYPES } from "@/components/dashboard/ConnectorWizard";
import ConnectorManageDrawer from "@/components/dashboard/ConnectorManageDrawer";
import { useDashboard } from "@/components/dashboard/DashboardLayout";

interface Connector {
    id: string;
    type: ConnectorType;
    name: string;
    lastTestedAt: string | null;
    lastTestOk: boolean | null;
    lastTestMessage: string | null;
    createdAt: string;
    updatedAt: string;
}

interface CatalogTable {
    table_name: string;
    project_id: string;
    source: string;
    source_ref?: string | null;
    row_count?: number | null;
}

const CATEGORIES: { label: string; types: ConnectorType[] }[] = [
    { label: "SQL Databases", types: ["postgres", "mysql", "mssql", "oracle"] },
    { label: "Cloud Warehouses", types: ["bigquery", "snowflake", "redshift"] },
    { label: "Document Stores", types: ["mongodb"] },
];

// Mirror the back-end's `_safe_table_name` (engine/connectors.py): squash any
// non [A-Za-z0-9_] run to a single underscore, collapse repeats, trim, lower.
// Connectors store ingested tables as `<safe(connector_name)>_<safe(source_table)>`,
// so we use the same normalization on the connector name to recover the prefix.
function safeName(raw: string): string {
    return (raw || "")
        .trim()
        .replace(/[^A-Za-z0-9_]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
        .toLowerCase() || "untitled";
}

export default function ConnectorsPage() {
    const router = useRouter();
    const { addAttachment, setCurrentDataset } = useDashboard();

    const [connectors, setConnectors] = useState<Connector[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [wizardType, setWizardType] = useState<ConnectorType | null>(null);
    const [allTables, setAllTables] = useState<CatalogTable[]>([]);
    const [manageConn, setManageConn] = useState<Connector | null>(null);

    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1";
    const chartApiUrl = process.env.NEXT_PUBLIC_CHART_API_URL || "http://127.0.0.1:8000";

    const load = useCallback(async () => {
        setLoading(true);
        setErr(null);
        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${apiUrl}/connectors`, { headers: { "x-auth-token": token } });
            const body = await res.json();
            if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
            setConnectors(body.data || []);
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Could not load connectors");
        } finally {
            setLoading(false);
        }
    }, [apiUrl]);

    const loadTables = useCallback(async () => {
        try {
            const token = localStorage.getItem("authToken") || "";
            if (!token) return;
            const res = await fetch(`${chartApiUrl}/data/tables/default`, {
                headers: { "x-auth-token": token },
            });
            if (!res.ok) return;
            const json = await res.json();
            setAllTables(Array.isArray(json.tables) ? json.tables : []);
        } catch (e) {
            // Tables list is best-effort; the page works without it.
            console.warn("Could not load ingested tables:", e);
        }
    }, [chartApiUrl]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { loadTables(); }, [loadTables]);

    async function removeConnector(id: string) {
        if (!confirm("Delete this connection? Ingested tables stay in your warehouse.")) return;
        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${apiUrl}/connectors/${id}`, {
                method: "DELETE",
                headers: { "x-auth-token": token },
            });
            if (!res.ok && res.status !== 204) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message || `HTTP ${res.status}`);
            }
            setConnectors((prev) => prev.filter((c) => c.id !== id));
        } catch (e) {
            alert(e instanceof Error ? e.message : "Could not delete");
        }
    }

    // Two-step filter:
    // 1) Prefer tables whose name starts with the connector's safeName prefix
    //    — this is the canonical ingest convention (engine/connectors.py
    //    `_safe_table_name`).
    // 2) Fallback when the prefix yields zero hits (e.g. the user renamed
    //    the connector after ingest): show all tables of the same source
    //    type, but ONLY when there's exactly one connector of that type
    //    (otherwise we'd surface a sibling connector's tables under the
    //    wrong card).
    const tablesForConnector = useCallback((c: Connector): CatalogTable[] => {
        const prefix = safeName(c.name) + "_";
        const matches = allTables.filter((t) => (t.table_name || "").toLowerCase().startsWith(prefix));
        if (matches.length > 0) return matches;
        // Only fall back when this is the unambiguous owner of its source type.
        const sameTypeCount = connectors.filter((x) => x.type === c.type).length;
        if (sameTypeCount === 1) {
            return allTables.filter((t) => (t.source || "").toLowerCase() === String(c.type).toLowerCase());
        }
        // Multiple same-type connectors and prefix yielded nothing — bail
        // rather than risk surfacing tables that belong to a sibling connector.
        return [];
    }, [allTables, connectors]);

    const openChatWith = useCallback((tableName: string) => {
        const projectId = "default";
        addAttachment({
            kind: "connector_table",
            id: `local:${tableName}`,
            projectId,
            tableName,
            alias: tableName,
        });
        setCurrentDataset({
            id: `${projectId}.${tableName}`,
            name: tableName,
            projectId,
            tableName,
            source: "lakehouse",
        });
        router.push("/dashboard");
    }, [addAttachment, setCurrentDataset, router]);

    /**
     * "Chat with all tables" — attach every ingested table for this connector
     * to the current chat. The first becomes the primary `df`; the rest are
     * available via `df_for("alias")` inside run_python (Phase 7b).
     */
    const openChatWithAll = useCallback((tables: CatalogTable[]) => {
        if (!tables.length) return;
        const projectId = "default";
        for (const t of tables) {
            addAttachment({
                kind: "connector_table",
                id: `local:${t.table_name}`,
                projectId: t.project_id || projectId,
                tableName: t.table_name,
                alias: t.table_name,
            });
        }
        const primary = tables[0];
        setCurrentDataset({
            id: `${primary.project_id || projectId}.${primary.table_name}`,
            name: primary.table_name,
            projectId: primary.project_id || projectId,
            tableName: primary.table_name,
            source: "lakehouse",
        });
        router.push("/dashboard");
    }, [addAttachment, setCurrentDataset, router]);

    const byType = useMemo(() => {
        return connectors.reduce<Record<string, Connector[]>>((acc, c) => {
            (acc[c.type] ||= []).push(c);
            return acc;
        }, {});
    }, [connectors]);

    return (
        <div className="flex-1 relative h-full overflow-y-auto">
            <div
                aria-hidden
                className="absolute inset-0 pointer-events-none"
                style={{
                    background:
                        "radial-gradient(ellipse 60% 30% at 50% 0%, rgba(188,255,60,0.05), transparent 60%)",
                }}
            />
            <div className="relative max-w-6xl mx-auto px-8 py-10">
                <header className="mb-10 max-w-2xl">
                    <p className="text-xs font-semibold text-vanta-neon tracking-widest uppercase mb-2">
                        Connectors
                    </p>
                    <h1
                        className="text-3xl md:text-4xl font-bold text-(--text-primary) mb-2"
                        style={{ fontFamily: "var(--font-heading)" }}
                    >
                        Plug in any data source
                    </h1>
                    <p className="text-(--text-muted)">
                        Connect eight database types. Credentials are encrypted with AES-256-GCM
                        and never leave your backend.
                    </p>
                </header>

                {err && (
                    <div className="mb-6 rounded-xl border border-(--error)/30 bg-(--error-bg) text-(--error) px-4 py-3">
                        {err}
                    </div>
                )}

                {CATEGORIES.map((cat) => (
                    <section key={cat.label} className="mb-10">
                        <h2 className="text-sm font-semibold text-(--text-secondary) uppercase tracking-wider mb-4">
                            {cat.label}
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {cat.types.map((type) => {
                                const meta = CONNECTOR_TYPES.find((m) => m.type === type)!;
                                const existing = byType[type] || [];
                                return (
                                    <ConnectorCard
                                        key={type}
                                        type={type}
                                        meta={meta}
                                        existing={existing}
                                        loading={loading}
                                        onAdd={() => setWizardType(type)}
                                        onDelete={removeConnector}
                                        onManage={setManageConn}
                                        tablesForConnector={tablesForConnector}
                                        onChatWithTable={openChatWith}
                                        onChatWithAll={openChatWithAll}
                                    />
                                );
                            })}
                        </div>
                    </section>
                ))}
            </div>

            {wizardType && (
                <ConnectorWizard
                    type={wizardType}
                    isOpen={!!wizardType}
                    onClose={() => setWizardType(null)}
                    onCompleted={() => { load(); loadTables(); }}
                />
            )}

            <ConnectorManageDrawer
                connector={manageConn}
                isOpen={!!manageConn}
                onClose={() => setManageConn(null)}
                onChanged={() => { load(); loadTables(); }}
            />
        </div>
    );
}

function ConnectorCard({
    type,
    meta,
    existing,
    loading,
    onAdd,
    onDelete,
    onManage,
    tablesForConnector,
    onChatWithTable,
    onChatWithAll,
}: {
    type: ConnectorType;
    meta: { label: string; description: string };
    existing: Connector[];
    loading: boolean;
    onAdd: () => void;
    onDelete: (id: string) => void;
    onManage: (c: Connector) => void;
    tablesForConnector: (c: Connector) => CatalogTable[];
    onChatWithTable: (tableName: string) => void;
    onChatWithAll: (tables: CatalogTable[]) => void;
}) {
    return (
        <div className="relative rounded-2xl border border-(--border-primary) bg-(--bg-secondary)/60 hover:bg-(--bg-secondary) hover:border-vanta-neon/40 p-5 transition-all overflow-hidden">
            <div
                aria-hidden
                className="absolute -top-16 -right-16 w-32 h-32 rounded-full opacity-0 hover:opacity-100 transition-opacity pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(188,255,60,0.2), transparent 70%)" }}
            />
            <div className="relative">
                <div className="flex items-start gap-3 mb-3">
                    <div className="w-11 h-11 rounded-xl bg-(--bg-tertiary) border border-(--border-primary) flex items-center justify-center flex-none">
                        <ConnectorIcon type={type} size={24} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-(--text-primary) truncate">{meta.label}</h3>
                        <p className="text-[11px] text-(--text-muted) mt-0.5 line-clamp-2 leading-snug">
                            {meta.description}
                        </p>
                    </div>
                </div>

                {loading ? (
                    <div className="h-12 rounded-lg bg-(--bg-tertiary) animate-pulse" />
                ) : existing.length === 0 ? (
                    <button
                        onClick={onAdd}
                        className="w-full h-10 rounded-lg bg-vanta-neon text-black text-sm font-semibold hover:bg-vanta-neon/90 transition-colors"
                    >
                        + Add connection
                    </button>
                ) : (
                    <div className="space-y-1.5">
                        {existing.slice(0, 3).map((c) => {
                            const tables = tablesForConnector(c);
                            return (
                                <div
                                    key={c.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => onManage(c)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            onManage(c);
                                        }
                                    }}
                                    className="group flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-(--bg-tertiary) border border-(--border-secondary) hover:border-vanta-neon/40 hover:bg-(--bg-hover) cursor-pointer transition-colors focus:outline-none focus:border-vanta-neon/60"
                                    title="Click to view schema, tables, and ingested data"
                                >
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-medium text-(--text-primary) truncate">{c.name}</p>
                                        <p className="text-[10px] text-(--text-muted) mt-0.5">
                                            {c.lastTestedAt
                                                ? c.lastTestOk
                                                    ? "✓ tested"
                                                    : `✗ ${(c.lastTestMessage || "failed").slice(0, 32)}`
                                                : "not tested yet"}
                                        </p>
                                    </div>
                                    <div
                                        className="flex items-center gap-1.5 flex-none"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        {tables.length > 0 && (
                                            <>
                                                <button
                                                    onClick={() => onChatWithAll(tables)}
                                                    className="text-[10px] bg-vanta-neon/10 border border-vanta-neon/40 text-vanta-neon hover:bg-vanta-neon/20 rounded px-1.5 py-0.5 cursor-pointer"
                                                    title={`Chat with all ${tables.length} tables at once`}
                                                >
                                                    All ({tables.length})
                                                </button>
                                                <select
                                                    aria-label={`Chat with a table from ${c.name}`}
                                                    defaultValue=""
                                                    onChange={(e) => {
                                                        const v = e.target.value;
                                                        if (v) onChatWithTable(v);
                                                        e.currentTarget.value = "";
                                                    }}
                                                    className="text-[10px] bg-(--bg-secondary) border border-(--border-primary) rounded px-1.5 py-0.5 text-(--text-secondary) hover:text-vanta-neon hover:border-vanta-neon/40 focus:outline-none focus:border-vanta-neon/60 max-w-[110px] cursor-pointer"
                                                    title="Chat with one specific table"
                                                >
                                                    <option value="">One…</option>
                                                    {tables.map((t) => (
                                                        <option key={t.table_name} value={t.table_name}>
                                                            {t.table_name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </>
                                        )}
                                        <button
                                            onClick={() => onDelete(c.id)}
                                            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-(--error-bg)"
                                            title="Delete"
                                        >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2">
                                                <polyline points="3 6 5 6 21 6" />
                                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                        <button
                            onClick={onAdd}
                            className="w-full h-8 text-xs font-semibold text-(--text-secondary) hover:text-vanta-neon transition-colors border border-dashed border-(--border-primary) rounded-md hover:border-vanta-neon/50"
                        >
                            + Add another
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
