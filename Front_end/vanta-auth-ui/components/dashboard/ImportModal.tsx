"use client";

import { useCallback, useRef, useState } from "react";
import { IconPlus } from "./Icons";
import { useDashboard } from "./DashboardLayout";

interface ImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: (dataset: {
        id: string;
        name: string;
        jobId: string;
        projectId: string;
        tableName: string;
        source: "lakehouse";
    }) => void;
}

interface PendingFile {
    id: string;                // client-side id so we can update state
    file: File;
    tableName: string;         // editable, auto-derived from file name
    status: "queued" | "uploading" | "done" | "error";
    error?: string;
    rowCount?: number;
}

const VALID_EXT = [".csv", ".xls", ".xlsx"];
const MAX_BYTES = 100 * 1024 * 1024;

function deriveTableName(filename: string): string {
    return filename
        .replace(/\.(csv|xls|xlsx)$/i, "")
        .replace(/[^a-zA-Z0-9_]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
        .toLowerCase() || "untitled";
}

function validate(file: File): string | null {
    const extOk = VALID_EXT.some((e) => file.name.toLowerCase().endsWith(e));
    if (!extOk) return `Unsupported type: ${file.name}. Only CSV, XLS, XLSX.`;
    if (file.size > MAX_BYTES) return `${file.name} is bigger than 100 MB.`;
    return null;
}

export default function ImportModal({ isOpen, onClose, onSuccess }: ImportModalProps) {
    const { user } = useDashboard();
    const [isDragging, setIsDragging] = useState(false);
    const [queue, setQueue] = useState<PendingFile[]>([]);
    const [projectId, setProjectId] = useState("default");
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const addFiles = useCallback((files: FileList | File[]) => {
        setError(null);
        const incoming = Array.from(files);
        const accepted: PendingFile[] = [];
        const rejected: string[] = [];
        for (const f of incoming) {
            const bad = validate(f);
            if (bad) { rejected.push(bad); continue; }
            accepted.push({
                id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                file: f,
                tableName: deriveTableName(f.name),
                status: "queued",
            });
        }
        if (rejected.length) setError(rejected.join(" · "));
        if (accepted.length) setQueue((prev) => [...prev, ...accepted]);
    }, []);

    const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
    const onDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); }, []);
    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
    }, [addFiles]);

    const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.length) addFiles(e.target.files);
        // Reset the input so selecting the same file again still fires onChange.
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const updateRow = useCallback((id: string, patch: Partial<PendingFile>) => {
        setQueue((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    }, []);

    const removeRow = useCallback((id: string) => {
        setQueue((prev) => prev.filter((r) => r.id !== id));
    }, []);

    const handleUpload = async () => {
        if (!user?.id) { setError("Please refresh and sign in again."); return; }
        if (!queue.length) return;

        // Client-side dedup of table names within this batch.
        const seen = new Set<string>();
        for (const row of queue) {
            const t = row.tableName.trim();
            if (!t) { setError(`Give every file a table name first.`); return; }
            if (seen.has(t)) { setError(`Duplicate table name in batch: ${t}`); return; }
            seen.add(t);
        }

        setError(null);
        setUploading(true);

        const authToken = localStorage.getItem("authToken") || "";
        const pid = projectId.trim() || "default";
        let lastSuccess: PendingFile | null = null;

        // Sequential — keeps the server honest + makes progress visible.
        for (const row of queue) {
            if (row.status === "done") continue;
            updateRow(row.id, { status: "uploading", error: undefined });
            try {
                const fd = new FormData();
                fd.append("file", row.file);
                fd.append("userId", user.id);
                fd.append("projectId", pid);
                fd.append("tableName", row.tableName.trim());

                const res = await fetch("/api/lakehouse/upload", {
                    method: "POST",
                    body: fd,
                    headers: authToken ? { "x-auth-token": authToken } : undefined,
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(json.message || json.error || json.detail || `HTTP ${res.status}`);
                }
                updateRow(row.id, {
                    status: "done",
                    rowCount: json.rowCount ?? undefined,
                });
                lastSuccess = { ...row, status: "done", rowCount: json.rowCount };
                onSuccess({
                    id: json.jobId || `${pid}::${row.tableName.trim()}`,
                    name: row.tableName.trim(),
                    jobId: json.jobId || `${pid}::${row.tableName.trim()}`,
                    projectId: pid,
                    tableName: json.tableName || row.tableName.trim(),
                    source: "lakehouse",
                });
            } catch (e) {
                updateRow(row.id, {
                    status: "error",
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        }

        setUploading(false);
        // Close automatically if everything succeeded. Otherwise keep the
        // modal open so the user sees which rows failed.
        const failed = queue.some((r) => r.status === "error");
        if (!failed && lastSuccess) {
            setTimeout(() => {
                setQueue([]);
                onClose();
            }, 400);
        }
    };

    const handleClose = () => {
        if (!uploading) {
            setQueue([]);
            setError(null);
            onClose();
        }
    };

    if (!isOpen) return null;

    const allDone = queue.length > 0 && queue.every((r) => r.status === "done");
    const pendingCount = queue.filter((r) => r.status === "queued" || r.status === "error").length;

    return (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-(--backdrop) backdrop-blur-sm" onClick={handleClose} />

            <div className="relative bg-(--bg-secondary) border border-(--border-primary) rounded-2xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between p-6 pb-4 border-b border-(--border-secondary)">
                    <div>
                        <p className="text-[10px] uppercase tracking-widest text-vanta-neon font-semibold mb-0.5">
                            Ingest
                        </p>
                        <h2 className="text-xl font-semibold text-(--text-primary)" style={{ fontFamily: "var(--font-heading)" }}>
                            Import data
                        </h2>
                    </div>
                    <button
                        onClick={handleClose}
                        disabled={uploading}
                        className="w-9 h-9 rounded-lg bg-(--bg-tertiary) hover:bg-(--bg-hover) text-(--text-muted) hover:text-(--text-primary) flex items-center justify-center disabled:opacity-50"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {/* Drop zone — always visible so users can add more */}
                    <div
                        onDragOver={onDragOver}
                        onDragLeave={onDragLeave}
                        onDrop={onDrop}
                        onClick={() => !uploading && fileInputRef.current?.click()}
                        className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${uploading ? "cursor-not-allowed opacity-50" : "cursor-pointer"
                            } ${isDragging
                                ? "border-(--accent) bg-(--accent-muted)"
                                : "border-(--border-primary) hover:border-(--accent)/60 bg-(--bg-tertiary)"
                            }`}
                    >
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".csv,.xls,.xlsx"
                            multiple
                            onChange={onFileSelect}
                            className="hidden"
                            disabled={uploading}
                        />
                        <div className="w-12 h-12 mx-auto rounded-xl bg-vanta-neon/10 border border-vanta-neon/30 flex items-center justify-center mb-3">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#BCFF3C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="17 8 12 3 7 8" />
                                <line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                        </div>
                        <p className="text-(--text-primary) font-medium">
                            Drop files here or click to browse
                        </p>
                        <p className="text-(--text-muted) text-xs mt-1">
                            Multiple files supported · CSV, XLS, XLSX · 100 MB each
                        </p>
                    </div>

                    {/* Project input */}
                    <label className="block">
                        <span className="text-xs font-semibold text-(--text-secondary) uppercase tracking-wider">
                            Project ID
                        </span>
                        <input
                            value={projectId}
                            onChange={(e) => setProjectId(e.target.value.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase())}
                            disabled={uploading}
                            className="mt-1.5 w-full h-11 px-3 rounded-lg bg-(--bg-tertiary) border border-(--border-primary) text-(--text-primary) text-sm placeholder:text-(--text-muted) focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent)/25 transition-all"
                        />
                        <span className="text-[11px] text-(--text-muted) mt-1 block">
                            All files in this batch land under this project.
                        </span>
                    </label>

                    {/* File queue */}
                    {queue.length > 0 && (
                        <div className="pt-2 border-t border-(--border-secondary) space-y-2">
                            <p className="text-[11px] font-semibold text-(--text-muted) uppercase tracking-wider">
                                {queue.length} file{queue.length === 1 ? "" : "s"} in queue
                            </p>
                            {queue.map((row) => (
                                <div
                                    key={row.id}
                                    className={`rounded-lg border p-3 ${row.status === "error"
                                        ? "border-(--error)/40 bg-(--error-bg)"
                                        : row.status === "done"
                                            ? "border-vanta-neon/40 bg-vanta-neon/5"
                                            : "border-(--border-primary) bg-(--bg-tertiary)"
                                        }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <StatusDot status={row.status} />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-(--text-primary) truncate">
                                                {row.file.name}
                                            </p>
                                            <p className="text-[11px] text-(--text-muted)">
                                                {(row.file.size / 1024).toFixed(1)} KB
                                                {row.rowCount != null && ` · ${row.rowCount} rows`}
                                                {row.error && ` · ${row.error.slice(0, 80)}`}
                                            </p>
                                        </div>
                                        {!uploading && row.status !== "done" && (
                                            <button
                                                onClick={() => removeRow(row.id)}
                                                className="text-(--text-muted) hover:text-(--error) transition-colors"
                                                title="Remove"
                                            >
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <path d="M18 6L6 18M6 6l12 12" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>
                                    <div className="mt-2 flex items-center gap-2">
                                        <label className="text-[10px] uppercase tracking-widest text-(--text-muted) font-semibold w-16">
                                            Table
                                        </label>
                                        <input
                                            value={row.tableName}
                                            onChange={(e) => updateRow(row.id, {
                                                tableName: e.target.value.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase(),
                                            })}
                                            disabled={uploading || row.status === "done"}
                                            className="flex-1 h-8 px-2 rounded-md bg-(--bg-primary) border border-(--border-primary) text-(--text-primary) text-sm focus:outline-none focus:border-(--accent)"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {error && (
                        <div className="rounded-lg border border-(--error)/30 bg-(--error-bg) text-(--error) text-sm px-3 py-2">
                            {error}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 pt-4 border-t border-(--border-secondary) flex gap-3">
                    <button
                        onClick={handleClose}
                        disabled={uploading}
                        className="flex-1 h-11 rounded-xl bg-(--bg-tertiary) hover:bg-(--bg-hover) text-(--text-primary) font-medium transition-colors disabled:opacity-50"
                    >
                        {allDone ? "Close" : "Cancel"}
                    </button>
                    <button
                        onClick={handleUpload}
                        disabled={uploading || pendingCount === 0}
                        className={`flex-2 h-11 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${pendingCount > 0 && !uploading
                            ? "bg-vanta-neon text-black shadow-md shadow-vanta-neon/25 hover:bg-vanta-neon/90"
                            : "bg-(--bg-hover) text-(--text-muted) cursor-not-allowed"
                            }`}
                    >
                        {uploading ? (
                            <>
                                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                                Uploading…
                            </>
                        ) : (
                            <>
                                <IconPlus className="w-4 h-4" />
                                Import {pendingCount > 0 ? pendingCount : ""} file{pendingCount === 1 ? "" : "s"}
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

function StatusDot({ status }: { status: PendingFile["status"] }) {
    if (status === "uploading") {
        return <span className="w-2.5 h-2.5 rounded-full bg-vanta-neon animate-pulse" />;
    }
    if (status === "done") {
        return <span className="w-2.5 h-2.5 rounded-full bg-vanta-neon" />;
    }
    if (status === "error") {
        return <span className="w-2.5 h-2.5 rounded-full bg-(--error)" />;
    }
    return <span className="w-2.5 h-2.5 rounded-full border border-(--border-hover)" />;
}
