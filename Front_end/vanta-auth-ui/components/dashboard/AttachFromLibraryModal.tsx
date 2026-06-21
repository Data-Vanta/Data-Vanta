"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDashboard } from "./DashboardLayout";

/**
 * Tabbed picker that lets a chat composer attach an EXISTING file or
 * connector table to the current session — without re-uploading or
 * re-ingesting. Works against the global per-user file library and
 * the DuckDB warehouse catalog.
 *
 * Files: GET /api/v1/file/
 * Connector tables: GET /data/tables/{projectId}, filtered to source != 'upload'
 */

interface CatalogTable {
    table_name: string;
    project_id: string;
    source: string;
    source_ref?: string | null;
    row_count?: number | null;
}

type Tab = "files" | "tables";

export default function AttachFromLibraryModal({
    isOpen,
    onClose,
    sessionId,
    onAttached,
}: {
    isOpen: boolean;
    onClose: () => void;
    sessionId?: string | null;
    onAttached?: () => void;
}) {
    const { addAttachment } = useDashboard();

    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1";
    const chartApiUrl = process.env.NEXT_PUBLIC_CHART_API_URL || "http://127.0.0.1:8000";
    const projectId = "default";

    const [tab, setTab] = useState<Tab>("files");
    const [allTables, setAllTables] = useState<CatalogTable[]>([]);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [busyId, setBusyId] = useState<string | null>(null);

    // Both file uploads and connector ingests live in the same warehouse —
    // we just partition them by `source` so the two tabs each see the
    // right subset.
    const fileTables = useMemo(
        () => allTables.filter((t) => (t.source || "").toLowerCase() === "upload"),
        [allTables],
    );
    const connectorTables = useMemo(
        () => allTables.filter((t) => (t.source || "").toLowerCase() !== "upload"),
        [allTables],
    );

    const load = useCallback(async () => {
        if (!isOpen) return;
        setLoading(true);
        setErr(null);
        try {
            const token = localStorage.getItem("authToken") || "";
            const tRes = await fetch(`${chartApiUrl}/data/tables/${projectId}`, {
                headers: { "x-auth-token": token },
            });
            if (!tRes.ok) throw new Error(`HTTP ${tRes.status}`);
            const tJson = await tRes.json();
            setAllTables(Array.isArray(tJson.tables) ? tJson.tables : []);
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Could not load library");
        } finally {
            setLoading(false);
        }
    }, [chartApiUrl, isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        setSearch("");
        load();
    }, [isOpen, load]);

    const filteredFiles = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return fileTables;
        return fileTables.filter(
            (t) =>
                t.table_name.toLowerCase().includes(q) ||
                (t.source_ref || "").toLowerCase().includes(q),
        );
    }, [fileTables, search]);

    const filteredTables = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return connectorTables;
        return connectorTables.filter(
            (t) =>
                t.table_name.toLowerCase().includes(q) ||
                (t.source_ref || "").toLowerCase().includes(q),
        );
    }, [connectorTables, search]);

    const persistAttachment = useCallback(async (payload: Record<string, unknown>) => {
        if (!sessionId) return;
        const token = localStorage.getItem("authToken") || "";
        await fetch(`${apiUrl}/chat/sessions/${sessionId}/attachments`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-auth-token": token },
            body: JSON.stringify(payload),
        }).catch(() => {});
    }, [apiUrl, sessionId]);

    const attachTable = useCallback(async (t: CatalogTable) => {
        const key = `${t.project_id}::${t.table_name}`;
        setBusyId(key);
        try {
            addAttachment({
                kind: "connector_table",
                id: `local:${t.table_name}`,
                projectId: t.project_id,
                tableName: t.table_name,
                alias: t.table_name,
            });
            await persistAttachment({
                kind: "connector_table",
                projectId: t.project_id,
                tableName: t.table_name,
                alias: t.table_name,
            });
            onAttached?.();
            onClose();
        } finally {
            setBusyId(null);
        }
    }, [addAttachment, onAttached, onClose, persistAttachment]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-(--backdrop) backdrop-blur-sm" onClick={onClose} />

            <div className="relative w-full max-w-xl rounded-2xl bg-(--bg-secondary) border border-(--border-primary) shadow-2xl flex flex-col max-h-[80vh]">
                <header className="flex items-center justify-between p-5 border-b border-(--border-primary)">
                    <div>
                        <p className="text-[10px] uppercase tracking-widest text-vanta-neon font-semibold mb-0.5">
                            Attach from library
                        </p>
                        <h2
                            className="text-lg font-bold text-(--text-primary)"
                            style={{ fontFamily: "var(--font-heading)" }}
                        >
                            Pick a data source
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

                <div className="px-5 pt-4 flex items-center gap-1.5 border-b border-(--border-secondary)">
                    {([
                        { id: "files" as Tab, label: `Files (${fileTables.length})` },
                        { id: "tables" as Tab, label: `Connector tables (${connectorTables.length})` },
                    ]).map((t) => (
                        <button
                            key={t.id}
                            onClick={() => setTab(t.id)}
                            className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                                tab === t.id
                                    ? "text-vanta-neon border-vanta-neon"
                                    : "text-(--text-muted) border-transparent hover:text-(--text-primary)"
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                <div className="px-5 py-3 border-b border-(--border-secondary)">
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search…"
                        className="w-full h-9 px-3 rounded-md bg-(--bg-tertiary) border border-(--border-primary) text-sm text-(--text-primary) placeholder:text-(--text-muted) focus:outline-none focus:border-vanta-neon/60"
                    />
                </div>

                <div className="flex-1 overflow-y-auto p-5">
                    {loading && (
                        <div className="space-y-1.5">
                            {[0, 1, 2, 3].map((i) => (
                                <div key={i} className="h-10 rounded-md bg-(--bg-tertiary) animate-pulse" />
                            ))}
                        </div>
                    )}

                    {!loading && err && (
                        <div className="text-[12px] text-(--error)">{err}</div>
                    )}

                    {!loading && !err && tab === "files" && (
                        filteredFiles.length === 0 ? (
                            <div className="text-[12px] text-(--text-muted)">
                                {search ? "No files match." : "No files yet. Use the + on the sidebar to upload one."}
                            </div>
                        ) : (
                            <ul className="space-y-1.5">
                                {filteredFiles.map((t) => {
                                    const key = `${t.project_id}::${t.table_name}`;
                                    const isBusy = busyId === key;
                                    return (
                                        <li
                                            key={key}
                                            className="flex items-center gap-3 px-3 py-2 rounded-md bg-(--bg-tertiary) border border-(--border-secondary)"
                                        >
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm text-(--text-primary) truncate">
                                                    {t.source_ref || t.table_name}
                                                </p>
                                                <p className="text-[10px] text-(--text-muted) mt-0.5 font-mono truncate">
                                                    {t.table_name}
                                                    {typeof t.row_count === "number" ? ` · ${t.row_count.toLocaleString()} rows` : ""}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => attachTable(t)}
                                                disabled={isBusy}
                                                className="text-[11px] px-3 h-8 rounded bg-vanta-neon text-black font-semibold hover:bg-vanta-neon/90 disabled:opacity-60"
                                            >
                                                {isBusy ? "…" : "Attach"}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )
                    )}

                    {!loading && !err && tab === "tables" && (
                        filteredTables.length === 0 ? (
                            <div className="text-[12px] text-(--text-muted)">
                                {search
                                    ? "No tables match."
                                    : "No connector tables yet. Add a connector and ingest a table to use it here."}
                            </div>
                        ) : (
                            <ul className="space-y-1.5">
                                {filteredTables.map((t) => {
                                    const key = `${t.project_id}::${t.table_name}`;
                                    const isBusy = busyId === key;
                                    return (
                                        <li
                                            key={key}
                                            className="flex items-center gap-3 px-3 py-2 rounded-md bg-(--bg-tertiary) border border-(--border-secondary)"
                                        >
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm text-(--text-primary) font-mono truncate">{t.table_name}</p>
                                                <p className="text-[10px] text-(--text-muted) mt-0.5">
                                                    {t.source}{t.source_ref ? ` · ${t.source_ref}` : ""}
                                                    {typeof t.row_count === "number" ? ` · ${t.row_count.toLocaleString()} rows` : ""}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => attachTable(t)}
                                                disabled={isBusy}
                                                className="text-[11px] px-3 h-8 rounded bg-vanta-neon text-black font-semibold hover:bg-vanta-neon/90 disabled:opacity-60"
                                            >
                                                {isBusy ? "…" : "Attach"}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )
                    )}
                </div>
            </div>
        </div>
    );
}
