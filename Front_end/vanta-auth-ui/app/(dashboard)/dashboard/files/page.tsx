"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useDashboard } from "@/components/dashboard/DashboardLayout";
import type { ChatAttachment } from "@/components/dashboard/DashboardLayout";
import { IconFile, IconPlus } from "@/components/dashboard/Icons";
import TableMetadataDialog from "@/components/dashboard/TableMetadataDialog";

// Shape returned by user-auth GET /file/ (file.model.js)
interface FileRow {
    id: string;
    originalFilename: string;
    sizeInBytes?: number;
    createdAt?: string;
}

// Shape returned by Chart-API GET /data/tables/{project_id}.
// dict(sqlite Row) gives snake_case keys, but tolerate camelCase too in case
// the engine surface ever changes.
interface TableRow {
    table_name?: string;
    tableName?: string;
    name?: string;
    row_count?: number;
    rowCount?: number;
    source?: string;
    updated_at?: string;
}

const PROJECT_ID = "default";

export default function FilesPage() {
    const { setCurrentDataset, addAttachment } = useDashboard();
    const router = useRouter();
    const [files, setFiles] = useState<FileRow[]>([]);
    const [tables, setTables] = useState<TableRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [metaTarget, setMetaTarget] = useState<{ projectId: string; tableName: string } | null>(null);

    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1";
    const chartApiUrl = process.env.NEXT_PUBLIC_CHART_API_URL || "http://127.0.0.1:8000";

    useEffect(() => {
        let alive = true;
        (async () => {
            const token = (typeof window !== "undefined" && localStorage.getItem("authToken")) || "";
            try {
                // Each fetch absorbs its own network/HTTP failure into the empty-list
                // shape so one backend being down doesn't blank the other section.
                // The fallback is tagged with __failed:true so the success branch can
                // still surface a soft-error banner — without the tag, allSettled
                // always sees fulfilled results and the banner would be dead code.
                const results = await Promise.allSettled([
                    fetch(`${apiUrl}/file/`, { headers: { "x-auth-token": token } })
                        .then((r) => (r.ok ? r.json() : { data: [], __failed: true as const }))
                        .catch((err) => {
                            console.warn("files fetch failed", err);
                            return { data: [], __failed: true as const };
                        }),
                    fetch(`${chartApiUrl}/data/tables/${PROJECT_ID}`, { headers: { "x-auth-token": token } })
                        .then((r) => (r.ok ? r.json() : { tables: [], __failed: true as const }))
                        .catch((err) => {
                            console.warn("tables fetch failed", err);
                            return { tables: [], __failed: true as const };
                        }),
                ]);
                if (!alive) return;
                const fileJson = results[0].status === "fulfilled" ? results[0].value : { data: [], __failed: true };
                const tableJson = results[1].status === "fulfilled" ? results[1].value : { tables: [], __failed: true };
                setFiles(Array.isArray(fileJson?.data) ? fileJson.data : []);
                setTables(Array.isArray(tableJson?.tables) ? tableJson.tables : []);
                const fileFailed = !!fileJson?.__failed;
                const tablesFailed = !!tableJson?.__failed;
                if (fileFailed && tablesFailed) {
                    setError("Failed to load files and connector tables");
                } else if (fileFailed || tablesFailed) {
                    setError("Some sources couldn't be reached");
                } else {
                    setError(null);
                }
            } catch (err) {
                console.error("Files page load failed", err);
                if (alive) setError("Failed to load files");
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => {
            alive = false;
        };
    }, [apiUrl, chartApiUrl]);

    const tableNameOf = (t: TableRow) => t.table_name || t.tableName || t.name || "";

    const openFileInChat = (f: FileRow) => {
        const att: ChatAttachment = {
            kind: "file",
            id: `local:${f.id}`,
            fileId: f.id,
            alias: f.originalFilename,
            originalFilename: f.originalFilename,
        };
        addAttachment(att);
        setCurrentDataset({
            id: f.id,
            name: f.originalFilename,
            source: "user-auth",
        });
        router.push("/dashboard");
    };

    const openTableInChat = (t: TableRow) => {
        const name = tableNameOf(t);
        if (!name) return;
        const att: ChatAttachment = {
            kind: "connector_table",
            id: `local:${name}`,
            projectId: PROJECT_ID,
            tableName: name,
            alias: name,
        };
        addAttachment(att);
        setCurrentDataset({
            id: `${PROJECT_ID}.${name}`,
            name,
            projectId: PROJECT_ID,
            tableName: name,
            source: "lakehouse",
        });
        router.push("/dashboard");
    };

    const bothEmpty = !loading && !error && files.length === 0 && tables.length === 0;

    return (
        <div className="flex-1 relative h-full overflow-y-auto">
            {/* Ambient glow */}
            <div
                aria-hidden
                className="absolute inset-0 pointer-events-none"
                style={{
                    background:
                        "radial-gradient(ellipse 60% 30% at 50% 0%, rgba(188,255,60,0.05), transparent 60%)",
                }}
            />

            <div className="relative max-w-6xl mx-auto px-8 py-10">
                {/* Header */}
                <div className="flex items-end justify-between mb-10 gap-4 flex-wrap">
                    <div>
                        <p className="text-xs font-semibold text-vanta-neon tracking-widest uppercase mb-2">
                            Datasets
                        </p>
                        <h1
                            className="text-3xl md:text-4xl font-bold text-(--text-primary) mb-2"
                            style={{ fontFamily: "var(--font-heading)" }}
                        >
                            Files &amp; Datasets
                        </h1>
                        <p className="text-(--text-muted)">
                            Everything you&rsquo;ve uploaded or connected. Pick one to start a conversation.
                        </p>
                    </div>
                    <button
                        onClick={() => router.push("/dashboard")}
                        className="inline-flex items-center gap-2 px-4 py-2.5 bg-vanta-neon text-black font-semibold rounded-xl hover:bg-vanta-neon/90 transition-all shadow-md shadow-vanta-neon/25"
                    >
                        <IconPlus className="w-4 h-4" />
                        New import
                    </button>
                </div>

                {/* Loading */}
                {loading && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div
                                key={i}
                                className="h-40 rounded-2xl border border-(--border-primary) bg-(--bg-secondary)/50 animate-pulse"
                            />
                        ))}
                    </div>
                )}

                {/* Error */}
                {error && (
                    <div className="rounded-xl border border-(--error)/30 bg-(--error-bg) text-(--error) px-4 py-3">
                        {error}
                    </div>
                )}

                {/* Both empty: hero state */}
                {bothEmpty && (
                    <div className="relative rounded-3xl border border-(--border-primary) bg-(--bg-secondary)/60 p-12 text-center overflow-hidden">
                        <div
                            aria-hidden
                            className="absolute -top-24 -left-24 w-64 h-64 rounded-full blur-3xl pointer-events-none"
                            style={{ background: "radial-gradient(circle, rgba(188,255,60,0.15), transparent 70%)" }}
                        />
                        <div className="relative">
                            <div className="w-16 h-16 mx-auto rounded-2xl bg-vanta-neon/10 border border-vanta-neon/30 flex items-center justify-center mb-5">
                                <IconFile className="w-8 h-8 text-vanta-neon" />
                            </div>
                            <h3
                                className="text-2xl font-bold text-(--text-primary) mb-2"
                                style={{ fontFamily: "var(--font-heading)" }}
                            >
                                No files yet
                            </h3>
                            <p className="text-(--text-muted) mb-7 max-w-sm mx-auto">
                                Upload a CSV, Excel, or connect a database from the dashboard to start asking questions.
                            </p>
                            <button
                                onClick={() => router.push("/dashboard")}
                                className="inline-flex items-center gap-2 px-6 py-3 bg-vanta-neon text-black font-bold rounded-xl hover:bg-vanta-neon/90 transition-all shadow-md shadow-vanta-neon/25"
                            >
                                <IconPlus className="w-5 h-5" />
                                Go to dashboard
                            </button>
                        </div>
                    </div>
                )}

                {/* Sections */}
                {!loading && !error && !bothEmpty && (
                    <div className="space-y-10">
                        {/* Uploaded files */}
                        <section>
                            <div className="flex items-baseline justify-between mb-4">
                                <h2
                                    className="text-lg font-bold text-(--text-primary)"
                                    style={{ fontFamily: "var(--font-heading)" }}
                                >
                                    Uploaded files
                                </h2>
                                <span className="text-xs text-(--text-muted) uppercase tracking-wider">
                                    {files.length} item{files.length === 1 ? "" : "s"}
                                </span>
                            </div>
                            {files.length === 0 ? (
                                <p className="text-sm text-(--text-muted) rounded-xl border border-dashed border-(--border-primary) px-4 py-6 text-center">
                                    No uploaded files yet. Drop a CSV or Excel file from the dashboard.
                                </p>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {files.map((file) => (
                                        <div
                                            key={file.id}
                                            className="group relative rounded-2xl border border-(--border-primary) bg-(--bg-secondary)/60 hover:bg-(--bg-secondary) hover:border-vanta-neon/40 p-5 transition-all overflow-hidden"
                                        >
                                            <div
                                                aria-hidden
                                                className="absolute -top-16 -right-16 w-32 h-32 rounded-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                                                style={{ background: "radial-gradient(circle, rgba(188,255,60,0.2), transparent 70%)" }}
                                            />
                                            <div className="relative">
                                                <button
                                                    type="button"
                                                    onClick={() => openFileInChat(file)}
                                                    className="text-left w-full flex items-start gap-4"
                                                >
                                                    <div className="w-12 h-12 bg-vanta-neon/10 border border-vanta-neon/30 rounded-xl flex items-center justify-center flex-none">
                                                        <IconFile className="w-6 h-6 text-vanta-neon" />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <h3 className="font-semibold text-(--text-primary) truncate group-hover:text-vanta-neon transition-colors">
                                                            {file.originalFilename}
                                                        </h3>
                                                        {typeof file.sizeInBytes === "number" && (
                                                            <p className="text-sm text-(--text-muted) truncate mt-0.5">
                                                                {(file.sizeInBytes / 1024).toFixed(1)} KB
                                                            </p>
                                                        )}
                                                        {file.createdAt && (
                                                            <p className="text-xs text-(--text-muted) mt-1">
                                                                {new Date(file.createdAt).toLocaleDateString()}
                                                            </p>
                                                        )}
                                                    </div>
                                                </button>
                                                <div className="mt-4 pt-4 border-t border-(--border-secondary) flex items-center justify-between">
                                                    <span className="text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-semibold bg-(--success-bg) text-(--success)">
                                                        Local
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => openFileInChat(file)}
                                                        className="text-[11px] font-semibold text-vanta-neon hover:text-vanta-neon/80 transition-colors"
                                                    >
                                                        Open in chat
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>

                        {/* Connector tables */}
                        <section>
                            <div className="flex items-baseline justify-between mb-4">
                                <h2
                                    className="text-lg font-bold text-(--text-primary)"
                                    style={{ fontFamily: "var(--font-heading)" }}
                                >
                                    Connector tables
                                </h2>
                                <span className="text-xs text-(--text-muted) uppercase tracking-wider">
                                    {tables.length} item{tables.length === 1 ? "" : "s"}
                                </span>
                            </div>
                            {tables.length === 0 ? (
                                <p className="text-sm text-(--text-muted) rounded-xl border border-dashed border-(--border-primary) px-4 py-6 text-center">
                                    No connector tables yet. Connect a database from the dashboard.
                                </p>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {tables.map((t) => {
                                        const name = tableNameOf(t);
                                        const rows = t.row_count ?? t.rowCount;
                                        return (
                                            <div
                                                key={name}
                                                className="group relative rounded-2xl border border-(--border-primary) bg-(--bg-secondary)/60 hover:bg-(--bg-secondary) hover:border-vanta-neon/40 p-5 transition-all overflow-hidden"
                                            >
                                                <div
                                                    aria-hidden
                                                    className="absolute -top-16 -right-16 w-32 h-32 rounded-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                                                    style={{ background: "radial-gradient(circle, rgba(188,255,60,0.2), transparent 70%)" }}
                                                />
                                                <div className="relative">
                                                    <button
                                                        type="button"
                                                        onClick={() => openTableInChat(t)}
                                                        className="text-left w-full flex items-start gap-4"
                                                    >
                                                        <div className="w-12 h-12 bg-vanta-neon/10 border border-vanta-neon/30 rounded-xl flex items-center justify-center flex-none">
                                                            <IconFile className="w-6 h-6 text-vanta-neon" />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <h3 className="font-semibold text-(--text-primary) truncate group-hover:text-vanta-neon transition-colors">
                                                                {name}
                                                            </h3>
                                                            <p className="text-sm text-(--text-muted) truncate mt-0.5">
                                                                Project: <span className="font-mono text-xs">{PROJECT_ID}</span>
                                                            </p>
                                                            {typeof rows === "number" && (
                                                                <p className="text-xs text-(--text-muted) mt-1">
                                                                    {rows.toLocaleString()} rows
                                                                </p>
                                                            )}
                                                        </div>
                                                    </button>
                                                    <div className="mt-4 pt-4 border-t border-(--border-secondary) flex items-center justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-semibold bg-(--success-bg) text-(--success)">
                                                                {t.source || "Lakehouse"}
                                                            </span>
                                                            <button
                                                                type="button"
                                                                onClick={() => setMetaTarget({ projectId: PROJECT_ID, tableName: name })}
                                                                className="text-[11px] font-semibold text-(--text-muted) hover:text-vanta-neon transition-colors flex items-center gap-1"
                                                                title="Edit alias & description"
                                                            >
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                    <path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                                                                </svg>
                                                                Edit
                                                            </button>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => openTableInChat(t)}
                                                            className="text-[11px] font-semibold text-vanta-neon hover:text-vanta-neon/80 transition-colors"
                                                        >
                                                            Open in chat
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </section>
                    </div>
                )}
            </div>

            {metaTarget && (
                <TableMetadataDialog
                    isOpen={!!metaTarget}
                    onClose={() => setMetaTarget(null)}
                    projectId={metaTarget.projectId}
                    tableName={metaTarget.tableName}
                />
            )}
        </div>
    );
}
