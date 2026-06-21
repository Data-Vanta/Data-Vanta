"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ConnectorIcon, { type ConnectorType } from "./ConnectorIcons";
import { CREDENTIAL_FIELDS, type FieldSchema } from "./ConnectorWizard";
import { useDashboard } from "./DashboardLayout";

/**
 * Schema & tables drawer for an existing connector.
 *
 * Three sections:
 *   1. Header — name, type, last-test status, Re-test, Edit credentials.
 *   2. Source tables — fetched from /connectors/:id/tables. Each row expands
 *      to show columns (lazy fetch from /connectors/:id/columns), with
 *      per-row "Ingest" CTA.
 *   3. Ingested tables — filtered from /data/tables/{projectId} by source
 *      type AND a connector-name prefix. Each row supports column lookup,
 *      "Open in chat", "Re-ingest", and a trash action.
 */

const inputCls =
    "mt-1.5 w-full h-11 px-3 rounded-lg bg-(--bg-tertiary) border border-(--border-primary) text-(--text-primary) placeholder:text-(--text-muted) text-sm focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent)/25 transition-all";

interface RemoteTable {
    schema?: string;
    name: string;
    row_estimate?: number;
}

interface ColumnRow {
    name: string;
    type: string;
    nullable: boolean;
}

interface CatalogTable {
    table_name: string;
    project_id: string;
    source: string;
    source_ref?: string | null;
    row_count?: number | null;
}

interface ConnectorRecord {
    id: string;
    type: ConnectorType;
    name: string;
    lastTestedAt: string | null;
    lastTestOk: boolean | null;
    lastTestMessage: string | null;
}

// Mirror engine/connectors.py `_safe_table_name`.
function safeName(raw: string): string {
    return (raw || "")
        .trim()
        .replace(/[^A-Za-z0-9_]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
        .toLowerCase() || "untitled";
}

function tablesForConnector(conn: ConnectorRecord, all: CatalogTable[]): CatalogTable[] {
    const prefix = `${safeName(conn.name)}_`;
    const byPrefix = all.filter(
        (t) => t.source === conn.type && t.table_name.startsWith(prefix),
    );
    if (byPrefix.length > 0) return byPrefix;
    // Fallback: same source type only when there's no prefix match.
    return all.filter((t) => t.source === conn.type);
}

export default function ConnectorManageDrawer({
    connector,
    isOpen,
    onClose,
    onChanged,
}: {
    connector: ConnectorRecord | null;
    isOpen: boolean;
    onClose: () => void;
    onChanged?: () => void;
}) {
    const router = useRouter();
    const { addAttachment, setCurrentDataset } = useDashboard();

    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1";
    const chartApiUrl = process.env.NEXT_PUBLIC_CHART_API_URL || "http://127.0.0.1:8000";

    // Local mirror so we can update lastTestedAt/lastTestOk after Re-test
    // without forcing a full parent refetch.
    const [mirror, setMirror] = useState<ConnectorRecord | null>(connector);
    useEffect(() => { setMirror(connector); }, [connector]);

    const [remoteTables, setRemoteTables] = useState<RemoteTable[]>([]);
    const [remoteLoading, setRemoteLoading] = useState(false);
    const [remoteErr, setRemoteErr] = useState<string | null>(null);

    const [ingested, setIngested] = useState<CatalogTable[]>([]);
    const [ingestedLoading, setIngestedLoading] = useState(false);
    const [ingestedErr, setIngestedErr] = useState<string | null>(null);

    const [columnsBySource, setColumnsBySource] = useState<Record<string, ColumnRow[]>>({});
    const [columnsLoading, setColumnsLoading] = useState<Record<string, boolean>>({});
    const [columnsErr, setColumnsErr] = useState<Record<string, string>>({});
    const [expandedSource, setExpandedSource] = useState<Record<string, boolean>>({});

    const [columnsByIngested, setColumnsByIngested] = useState<Record<string, ColumnRow[]>>({});
    const [columnsIngestedLoading, setColumnsIngestedLoading] = useState<Record<string, boolean>>({});
    const [expandedIngested, setExpandedIngested] = useState<Record<string, boolean>>({});

    const [busyId, setBusyId] = useState<string | null>(null);
    const [testing, setTesting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [defaultProjectId, setDefaultProjectId] = useState("default");
    const [editingCreds, setEditingCreds] = useState(false);

    const conn = mirror;

    // ---- data load ----------------------------------------------------------
    const loadRemote = useCallback(async () => {
        if (!conn) return;
        setRemoteLoading(true);
        setRemoteErr(null);
        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${apiUrl}/connectors/${conn.id}/tables`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-auth-token": token },
                body: "{}",
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
            setRemoteTables(Array.isArray(body.data?.tables) ? body.data.tables : []);
        } catch (e) {
            setRemoteErr(e instanceof Error ? e.message : "Could not list source tables");
            setRemoteTables([]);
        } finally {
            setRemoteLoading(false);
        }
    }, [apiUrl, conn]);

    const loadIngested = useCallback(async () => {
        if (!conn) return;
        setIngestedLoading(true);
        setIngestedErr(null);
        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${chartApiUrl}/data/tables/${defaultProjectId}`, {
                headers: { "x-auth-token": token },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            const all: CatalogTable[] = Array.isArray(json.tables) ? json.tables : [];
            setIngested(tablesForConnector(conn, all));
        } catch (e) {
            setIngestedErr(e instanceof Error ? e.message : "Could not list ingested tables");
            setIngested([]);
        } finally {
            setIngestedLoading(false);
        }
    }, [chartApiUrl, conn, defaultProjectId]);

    useEffect(() => {
        if (!isOpen || !conn) return;
        // Reset transient state when the drawer opens for a different connector.
        setColumnsBySource({});
        setColumnsErr({});
        setExpandedSource({});
        setColumnsByIngested({});
        setExpandedIngested({});
        setError(null);
        loadRemote();
        loadIngested();
    }, [isOpen, conn?.id, loadRemote, loadIngested]); // eslint-disable-line react-hooks/exhaustive-deps

    // ---- actions ------------------------------------------------------------
    const reTest = useCallback(async () => {
        if (!conn) return;
        setTesting(true);
        setError(null);
        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${apiUrl}/connectors/${conn.id}/test`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-auth-token": token },
                body: "{}",
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
            const result = body.data || {};
            setMirror((m) => m ? {
                ...m,
                lastTestedAt: new Date().toISOString(),
                lastTestOk: !!result.ok,
                lastTestMessage: result.message ?? null,
            } : m);
            onChanged?.();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Re-test failed");
        } finally {
            setTesting(false);
        }
    }, [apiUrl, conn, onChanged]);

    const fetchSourceColumns = useCallback(async (schema: string | undefined, name: string) => {
        if (!conn) return;
        const key = `${schema || ""}::${name}`;
        if (columnsBySource[key] || columnsLoading[key]) return;
        setColumnsLoading((m) => ({ ...m, [key]: true }));
        setColumnsErr((m) => ({ ...m, [key]: "" }));
        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${apiUrl}/connectors/${conn.id}/columns`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-auth-token": token },
                body: JSON.stringify({ schema, name }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
            const cols: ColumnRow[] = Array.isArray(body.data?.columns) ? body.data.columns : [];
            setColumnsBySource((m) => ({ ...m, [key]: cols }));
        } catch (e) {
            setColumnsErr((m) => ({ ...m, [key]: e instanceof Error ? e.message : "Failed" }));
        } finally {
            setColumnsLoading((m) => ({ ...m, [key]: false }));
        }
    }, [apiUrl, conn, columnsBySource, columnsLoading]);

    const fetchIngestedColumns = useCallback(async (projectId: string, tableName: string) => {
        const key = `${projectId}::${tableName}`;
        if (columnsByIngested[key] || columnsIngestedLoading[key]) return;
        setColumnsIngestedLoading((m) => ({ ...m, [key]: true }));
        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${chartApiUrl}/data/schema/${projectId}/${tableName}`, {
                headers: { "x-auth-token": token },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            const cols: ColumnRow[] = Array.isArray(json.columns) ? json.columns : [];
            setColumnsByIngested((m) => ({ ...m, [key]: cols }));
        } catch {
            setColumnsByIngested((m) => ({ ...m, [key]: [] }));
        } finally {
            setColumnsIngestedLoading((m) => ({ ...m, [key]: false }));
        }
    }, [chartApiUrl, columnsByIngested, columnsIngestedLoading]);

    const ingestOne = useCallback(async (schema: string | undefined, name: string) => {
        if (!conn) return;
        const key = `${schema || ""}::${name}`;
        setBusyId(key);
        setError(null);
        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${apiUrl}/connectors/${conn.id}/ingest`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-auth-token": token },
                body: JSON.stringify({
                    projectId: defaultProjectId,
                    tables: [{ schema, name }],
                }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
            await loadIngested();
            onChanged?.();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Ingest failed");
        } finally {
            setBusyId(null);
        }
    }, [apiUrl, conn, defaultProjectId, loadIngested, onChanged]);

    const dropIngested = useCallback(async (projectId: string, tableName: string) => {
        if (!confirm(`Drop "${tableName}" from your warehouse? Source data is untouched.`)) return;
        const key = `${projectId}::${tableName}`;
        setBusyId(key);
        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${chartApiUrl}/data/tables/${projectId}/${tableName}`, {
                method: "DELETE",
                headers: { "x-auth-token": token },
            });
            if (!res.ok && res.status !== 204) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.detail || body.message || `HTTP ${res.status}`);
            }
            await loadIngested();
            onChanged?.();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not drop table");
        } finally {
            setBusyId(null);
        }
    }, [chartApiUrl, loadIngested, onChanged]);

    const openInChat = useCallback((tableName: string) => {
        if (!conn) return;
        addAttachment({
            kind: "connector_table",
            id: `local:${tableName}`,
            projectId: defaultProjectId,
            tableName,
            alias: tableName,
        });
        setCurrentDataset({
            id: `${defaultProjectId}.${tableName}`,
            name: tableName,
            projectId: defaultProjectId,
            tableName,
            source: "lakehouse",
        });
        onClose();
        router.push("/dashboard");
    }, [addAttachment, conn, defaultProjectId, onClose, router, setCurrentDataset]);

    /**
     * Attach EVERY ingested table for this connector to the current chat.
     * The first becomes the primary `df`; the rest are reachable via
     * `df_for("alias")` inside the agent's run_python tool (Phase 7b).
     */
    const openAllInChat = useCallback(() => {
        if (!conn || ingested.length === 0) return;
        for (const t of ingested) {
            addAttachment({
                kind: "connector_table",
                id: `local:${t.table_name}`,
                projectId: t.project_id || defaultProjectId,
                tableName: t.table_name,
                alias: t.table_name,
            });
        }
        const primary = ingested[0];
        setCurrentDataset({
            id: `${primary.project_id || defaultProjectId}.${primary.table_name}`,
            name: primary.table_name,
            projectId: primary.project_id || defaultProjectId,
            tableName: primary.table_name,
            source: "lakehouse",
        });
        onClose();
        router.push("/dashboard");
    }, [addAttachment, conn, defaultProjectId, ingested, onClose, router, setCurrentDataset]);

    const deleteConnector = useCallback(async () => {
        if (!conn) return;
        if (!confirm("Delete this connection? Ingested tables stay in your warehouse.")) return;
        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${apiUrl}/connectors/${conn.id}`, {
                method: "DELETE",
                headers: { "x-auth-token": token },
            });
            if (!res.ok && res.status !== 204) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message || `HTTP ${res.status}`);
            }
            onChanged?.();
            onClose();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not delete");
        }
    }, [apiUrl, conn, onChanged, onClose]);

    const saveCreds = useCallback(async (newConfig: Record<string, string>) => {
        if (!conn) return;
        const token = localStorage.getItem("authToken") || "";
        const patchRes = await fetch(`${apiUrl}/connectors/${conn.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "x-auth-token": token },
            body: JSON.stringify({ config: newConfig }),
        });
        const patchBody = await patchRes.json().catch(() => ({}));
        if (!patchRes.ok) throw new Error(patchBody.message || `HTTP ${patchRes.status}`);
        await reTest();
        await loadRemote();
        await loadIngested();
        onChanged?.();
    }, [apiUrl, conn, reTest, loadRemote, loadIngested, onChanged]);

    if (!isOpen || !conn) return null;

    const statusLine = conn.lastTestedAt
        ? conn.lastTestOk
            ? <span className="text-vanta-neon">✓ tested</span>
            : <span className="text-(--error)">✗ {(conn.lastTestMessage || "failed").slice(0, 64)}</span>
        : <span className="text-(--text-muted)">not tested yet</span>;

    return (
        <div className="fixed inset-0 z-100 flex justify-end">
            <div className="absolute inset-0 bg-(--backdrop) backdrop-blur-sm" onClick={onClose} />

            <aside className="relative w-full sm:w-[560px] bg-(--bg-secondary) border-l border-(--border-primary) h-full shadow-2xl flex flex-col">
                <header className="flex items-start gap-4 p-5 border-b border-(--border-primary)">
                    <ConnectorIcon type={conn.type} size={32} />
                    <div className="flex-1 min-w-0">
                        <p className="text-[10px] uppercase tracking-widest text-vanta-neon font-semibold mb-0.5">
                            Manage connector
                        </p>
                        <h2
                            className="text-lg font-bold text-(--text-primary) truncate"
                            style={{ fontFamily: "var(--font-heading)" }}
                            title={conn.name}
                        >
                            {conn.name}
                        </h2>
                        <p className="text-[11px] mt-1">{statusLine}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 rounded-lg bg-(--bg-tertiary) hover:bg-(--bg-hover) text-(--text-muted) hover:text-(--text-primary) flex items-center justify-center flex-none"
                        aria-label="Close"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                </header>

                <div className="px-5 py-3 border-b border-(--border-secondary) flex items-center gap-2 flex-wrap">
                    <button
                        onClick={reTest}
                        disabled={testing}
                        className="px-3 h-8 text-xs rounded-md bg-(--bg-tertiary) hover:bg-(--bg-hover) text-(--text-primary) disabled:opacity-60"
                    >
                        {testing ? "Testing…" : "Re-test"}
                    </button>
                    <button
                        onClick={() => setEditingCreds(true)}
                        className="px-3 h-8 text-xs rounded-md bg-(--bg-tertiary) hover:bg-(--bg-hover) text-(--text-primary)"
                    >
                        Edit credentials
                    </button>
                    <div className="ml-auto flex items-center gap-1.5 text-[11px] text-(--text-muted)">
                        Project
                        <input
                            value={defaultProjectId}
                            onChange={(e) => setDefaultProjectId(e.target.value || "default")}
                            className="w-28 h-7 px-2 text-[11px] rounded bg-(--bg-tertiary) border border-(--border-primary) text-(--text-primary)"
                            aria-label="Project ID for ingest and listing"
                        />
                    </div>
                </div>

                {error && (
                    <div className="mx-5 mt-3 px-3 py-2 rounded-md text-[11px] bg-(--error-bg) text-(--error) border border-(--error)/30">
                        {error}
                    </div>
                )}

                <div className="flex-1 overflow-y-auto p-5 space-y-6">
                    {/* SOURCE TABLES */}
                    <section>
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-xs uppercase tracking-widest font-semibold text-(--text-secondary)">
                                Source tables{remoteTables.length > 0 && ` · ${remoteTables.length}`}
                            </h3>
                            <button
                                onClick={loadRemote}
                                className="text-[10px] text-(--text-muted) hover:text-vanta-neon"
                            >
                                refresh
                            </button>
                        </div>

                        {remoteLoading && (
                            <div className="space-y-1.5">
                                {[0, 1, 2].map((i) => (
                                    <div key={i} className="h-9 rounded-md bg-(--bg-tertiary) animate-pulse" />
                                ))}
                            </div>
                        )}

                        {!remoteLoading && remoteErr && (
                            <div className="text-[11px] text-(--error)">Couldn&apos;t list source tables: {remoteErr}</div>
                        )}

                        {!remoteLoading && !remoteErr && remoteTables.length === 0 && (
                            <div className="text-[11px] text-(--text-muted)">
                                No tables found. The credentials are valid but the database
                                shows no user-visible tables.
                            </div>
                        )}

                        {!remoteLoading && remoteTables.length > 0 && (
                            <ul className="space-y-1.5">
                                {remoteTables.map((t) => {
                                    const key = `${t.schema || ""}::${t.name}`;
                                    const expanded = !!expandedSource[key];
                                    const cols = columnsBySource[key];
                                    const colsErr = columnsErr[key];
                                    const colsLoading = !!columnsLoading[key];
                                    const isBusy = busyId === key;
                                    return (
                                        <li
                                            key={key}
                                            className="rounded-md bg-(--bg-tertiary) border border-(--border-secondary)"
                                        >
                                            <div className="flex items-center gap-2 px-3 py-2">
                                                <button
                                                    onClick={() => {
                                                        setExpandedSource((m) => ({ ...m, [key]: !m[key] }));
                                                        if (!expanded) fetchSourceColumns(t.schema, t.name);
                                                    }}
                                                    className="flex-1 text-left flex items-center gap-2 min-w-0"
                                                >
                                                    <svg
                                                        width="10" height="10" viewBox="0 0 12 12"
                                                        fill="none" stroke="currentColor" strokeWidth="2"
                                                        className={`text-(--text-muted) transition-transform ${expanded ? "rotate-90" : ""}`}
                                                    >
                                                        <path d="M4 2 L8 6 L4 10" />
                                                    </svg>
                                                    <span className="text-xs text-(--text-primary) truncate" title={`${t.schema ? `${t.schema}.` : ""}${t.name}`}>
                                                        {t.schema ? <span className="text-(--text-muted)">{t.schema}.</span> : null}
                                                        {t.name}
                                                    </span>
                                                </button>
                                                <button
                                                    onClick={() => ingestOne(t.schema, t.name)}
                                                    disabled={isBusy}
                                                    className="text-[10px] px-2 h-6 rounded bg-vanta-neon text-black font-semibold hover:bg-vanta-neon/90 disabled:opacity-60"
                                                >
                                                    {isBusy ? "…" : "Ingest"}
                                                </button>
                                            </div>
                                            {expanded && (
                                                <div className="border-t border-(--border-secondary) px-3 py-2">
                                                    {colsLoading && (
                                                        <div className="text-[11px] text-(--text-muted)">Loading columns…</div>
                                                    )}
                                                    {!colsLoading && colsErr && (
                                                        <div className="text-[11px] text-(--error)">
                                                            {colsErr}
                                                            <button
                                                                onClick={() => {
                                                                    setColumnsBySource((m) => { const n = { ...m }; delete n[key]; return n; });
                                                                    fetchSourceColumns(t.schema, t.name);
                                                                }}
                                                                className="ml-2 underline"
                                                            >retry</button>
                                                        </div>
                                                    )}
                                                    {!colsLoading && !colsErr && cols && cols.length === 0 && (
                                                        <div className="text-[11px] text-(--text-muted)">No columns reported.</div>
                                                    )}
                                                    {!colsLoading && cols && cols.length > 0 && (
                                                        <ul className="text-[11px] space-y-0.5">
                                                            {cols.map((c) => (
                                                                <li key={c.name} className="flex items-baseline gap-2">
                                                                    <span className="text-(--text-primary) font-mono">{c.name}</span>
                                                                    <span className="text-(--text-muted) font-mono">{c.type}</span>
                                                                    {!c.nullable && <span className="text-vanta-neon text-[9px] uppercase tracking-wider">required</span>}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </section>

                    {/* INGESTED TABLES */}
                    <section>
                        <div className="flex items-center justify-between mb-3 gap-2">
                            <h3 className="text-xs uppercase tracking-widest font-semibold text-(--text-secondary) flex-1">
                                In your warehouse{ingested.length > 0 && ` · ${ingested.length}`}
                            </h3>
                            {ingested.length > 1 && (
                                <button
                                    onClick={openAllInChat}
                                    className="text-[10px] px-2 h-6 rounded bg-vanta-neon/10 border border-vanta-neon/40 text-vanta-neon hover:bg-vanta-neon/20 font-semibold"
                                    title={`Attach all ${ingested.length} tables to a new chat`}
                                >
                                    Chat with all
                                </button>
                            )}
                            <button
                                onClick={loadIngested}
                                className="text-[10px] text-(--text-muted) hover:text-vanta-neon"
                            >
                                refresh
                            </button>
                        </div>

                        {ingestedLoading && (
                            <div className="space-y-1.5">
                                {[0, 1].map((i) => (
                                    <div key={i} className="h-9 rounded-md bg-(--bg-tertiary) animate-pulse" />
                                ))}
                            </div>
                        )}

                        {!ingestedLoading && ingestedErr && (
                            <div className="text-[11px] text-(--error)">{ingestedErr}</div>
                        )}

                        {!ingestedLoading && !ingestedErr && ingested.length === 0 && (
                            <div className="text-[11px] text-(--text-muted)">
                                Nothing ingested yet. Pick a table above and click Ingest.
                            </div>
                        )}

                        {!ingestedLoading && ingested.length > 0 && (
                            <ul className="space-y-1.5">
                                {ingested.map((t) => {
                                    const key = `${t.project_id}::${t.table_name}`;
                                    const expanded = !!expandedIngested[key];
                                    const cols = columnsByIngested[key];
                                    const isBusy = busyId === key;
                                    return (
                                        <li
                                            key={key}
                                            className="rounded-md bg-(--bg-tertiary) border border-(--border-secondary)"
                                        >
                                            <div className="flex items-center gap-2 px-3 py-2">
                                                <button
                                                    onClick={() => {
                                                        setExpandedIngested((m) => ({ ...m, [key]: !m[key] }));
                                                        if (!expanded) fetchIngestedColumns(t.project_id, t.table_name);
                                                    }}
                                                    className="flex-1 text-left flex items-center gap-2 min-w-0"
                                                >
                                                    <svg
                                                        width="10" height="10" viewBox="0 0 12 12"
                                                        fill="none" stroke="currentColor" strokeWidth="2"
                                                        className={`text-(--text-muted) transition-transform ${expanded ? "rotate-90" : ""}`}
                                                    >
                                                        <path d="M4 2 L8 6 L4 10" />
                                                    </svg>
                                                    <span className="text-xs text-(--text-primary) truncate font-mono">
                                                        {t.table_name}
                                                    </span>
                                                    {typeof t.row_count === "number" && (
                                                        <span className="text-[10px] text-(--text-muted)">· {t.row_count.toLocaleString()} rows</span>
                                                    )}
                                                </button>
                                                <button
                                                    onClick={() => openInChat(t.table_name)}
                                                    className="text-[10px] px-2 h-6 rounded bg-vanta-neon text-black font-semibold hover:bg-vanta-neon/90"
                                                    title="Open in chat"
                                                >
                                                    Chat
                                                </button>
                                                <button
                                                    onClick={() => dropIngested(t.project_id, t.table_name)}
                                                    disabled={isBusy}
                                                    className="text-[10px] px-2 h-6 rounded bg-(--bg-secondary) hover:bg-(--error-bg) text-(--text-muted) hover:text-(--error)"
                                                    title="Drop from warehouse"
                                                >
                                                    {isBusy ? "…" : "Drop"}
                                                </button>
                                            </div>
                                            {expanded && (
                                                <div className="border-t border-(--border-secondary) px-3 py-2">
                                                    {!cols ? (
                                                        <div className="text-[11px] text-(--text-muted)">Loading columns…</div>
                                                    ) : cols.length === 0 ? (
                                                        <div className="text-[11px] text-(--text-muted)">No columns reported.</div>
                                                    ) : (
                                                        <ul className="text-[11px] space-y-0.5">
                                                            {cols.map((c) => (
                                                                <li key={c.name} className="flex items-baseline gap-2">
                                                                    <span className="text-(--text-primary) font-mono">{c.name}</span>
                                                                    <span className="text-(--text-muted) font-mono">{c.type}</span>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </section>
                </div>

                <footer className="p-5 border-t border-(--border-primary)">
                    <button
                        onClick={deleteConnector}
                        className="w-full h-10 rounded-lg bg-(--error-bg) text-(--error) hover:bg-(--error)/20 text-sm font-medium border border-(--error)/30"
                    >
                        Delete connector
                    </button>
                </footer>

                {editingCreds && (
                    <EditCredentialsOverlay
                        type={conn.type}
                        onCancel={() => setEditingCreds(false)}
                        onSave={async (cfg) => {
                            await saveCreds(cfg);
                            setEditingCreds(false);
                        }}
                    />
                )}
            </aside>
        </div>
    );
}

function EditCredentialsOverlay({
    type,
    onSave,
    onCancel,
}: {
    type: ConnectorType;
    onSave: (cfg: Record<string, string>) => Promise<void>;
    onCancel: () => void;
}) {
    const fields: FieldSchema[] = CREDENTIAL_FIELDS[type] || [];
    const [config, setConfig] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    return (
        <div className="absolute inset-0 z-10 bg-(--bg-secondary) flex flex-col">
            <header className="flex items-center gap-3 p-5 border-b border-(--border-primary)">
                <p className="flex-1 text-sm font-semibold text-(--text-primary)">Update credentials</p>
                <button
                    onClick={onCancel}
                    className="w-8 h-8 rounded bg-(--bg-tertiary) hover:bg-(--bg-hover) text-(--text-muted) flex items-center justify-center"
                    aria-label="Cancel"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                </button>
            </header>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
                <p className="text-[11px] text-(--text-muted) leading-relaxed">
                    Existing credentials are not returned. Fill the fields you want to set;
                    any field left blank is replaced with an empty value on save.
                </p>
                {fields.map((f) => {
                    const v = config[f.key] ?? "";
                    return (
                        <label key={f.key} className="block">
                            <span className="text-xs font-semibold text-(--text-secondary) uppercase tracking-wider">
                                {f.label}{f.required && " *"}
                            </span>
                            {f.type === "textarea" ? (
                                <textarea
                                    value={v}
                                    onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}
                                    placeholder={f.placeholder}
                                    rows={5}
                                    className={`${inputCls} resize-none font-mono text-[11px] leading-relaxed`}
                                />
                            ) : (
                                <input
                                    type={f.type || "text"}
                                    value={v}
                                    onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}
                                    placeholder={f.placeholder}
                                    className={inputCls}
                                    autoComplete={f.type === "password" ? "new-password" : "off"}
                                />
                            )}
                            {f.helper && <span className="text-[11px] text-(--text-muted) mt-1 block">{f.helper}</span>}
                        </label>
                    );
                })}
                {err && (
                    <div className="px-3 py-2 rounded-md text-[11px] bg-(--error-bg) text-(--error) border border-(--error)/30">{err}</div>
                )}
            </div>
            <footer className="p-5 border-t border-(--border-primary) flex gap-3">
                <button
                    onClick={onCancel}
                    className="flex-1 h-11 rounded-xl bg-(--bg-tertiary) hover:bg-(--bg-hover) text-(--text-primary) font-medium"
                >
                    Cancel
                </button>
                <button
                    onClick={async () => {
                        setSaving(true);
                        setErr(null);
                        try {
                            await onSave(config);
                        } catch (e) {
                            setErr(e instanceof Error ? e.message : "Save failed");
                        } finally {
                            setSaving(false);
                        }
                    }}
                    disabled={saving}
                    className="flex-[2] h-11 rounded-xl bg-vanta-neon text-black font-bold hover:bg-vanta-neon/90 disabled:opacity-60"
                >
                    {saving ? "Saving…" : "Save + re-test"}
                </button>
            </footer>
        </div>
    );
}
