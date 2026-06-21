"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDashboard } from "./DashboardLayout";

/**
 * Sidebar quick-upload modal.
 *
 * Posts a single CSV/Excel through the lakehouse proxy
 * (/api/lakehouse/upload), which routes to Chart-API and registers the
 * file in the DuckDB warehouse. That's the only path that produces a
 * file you can chat with or use in a widget.
 *
 * After a successful upload, the file is reachable as a warehouse table
 * (`projectId.tableName`); we attach it to the current chat using
 * `kind: 'connector_table'` since that's what the agent + widget
 * pipelines speak.
 */

const VALID_EXT = [".csv", ".xls", ".xlsx"] as const;
const MAX_BYTES = 100 * 1024 * 1024;
const PROJECT_ID = "default";

interface UploadedTable {
    projectId: string;
    tableName: string;
    originalFilename: string;
    rowCount?: number;
}

function deriveTableName(filename: string): string {
    return filename
        .replace(/\.(csv|xls|xlsx)$/i, "")
        .replace(/[^a-zA-Z0-9_]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
        .toLowerCase() || "untitled";
}

export default function QuickUploadModal({
    isOpen,
    onClose,
}: {
    isOpen: boolean;
    onClose: () => void;
}) {
    const router = useRouter();
    const { addAttachment, setCurrentDataset, user } = useDashboard();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [picked, setPicked] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [uploaded, setUploaded] = useState<UploadedTable | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    const reset = useCallback(() => {
        setPicked(null);
        setUploaded(null);
        setError(null);
        setIsDragging(false);
        setUploading(false);
    }, []);

    const validate = (file: File): string | null => {
        const lower = file.name.toLowerCase();
        if (!VALID_EXT.some((e) => lower.endsWith(e))) {
            return `Unsupported type: ${file.name}. Only CSV, XLS, XLSX.`;
        }
        if (file.size > MAX_BYTES) return `${file.name} is bigger than 100 MB.`;
        return null;
    };

    const onPick = (f: File) => {
        const bad = validate(f);
        setError(bad);
        if (!bad) setPicked(f);
    };

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onPick(f);
    };

    const doUpload = async () => {
        if (!picked) return;
        if (!user?.id) {
            setError("Please refresh and sign in again.");
            return;
        }
        setUploading(true);
        setError(null);
        try {
            const token = localStorage.getItem("authToken") || "";
            const tableName = deriveTableName(picked.name);
            const fd = new FormData();
            fd.append("file", picked);
            fd.append("userId", user.id);
            fd.append("projectId", PROJECT_ID);
            fd.append("tableName", tableName);

            const res = await fetch("/api/lakehouse/upload", {
                method: "POST",
                headers: token ? { "x-auth-token": token } : undefined,
                body: fd,
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(
                    body.message || body.error || body.detail || `HTTP ${res.status}`,
                );
            }
            setUploaded({
                projectId: PROJECT_ID,
                tableName: body.tableName || tableName,
                originalFilename: picked.name,
                rowCount: typeof body.rowCount === "number" ? body.rowCount : undefined,
            });
        } catch (e) {
            setError(e instanceof Error ? e.message : "Upload failed");
        } finally {
            setUploading(false);
        }
    };

    const attachToCurrent = () => {
        if (!uploaded) return;
        addAttachment({
            kind: "connector_table",
            id: `local:${uploaded.tableName}`,
            projectId: uploaded.projectId,
            tableName: uploaded.tableName,
            alias: uploaded.originalFilename,
        });
        setCurrentDataset({
            id: `${uploaded.projectId}.${uploaded.tableName}`,
            name: uploaded.originalFilename,
            projectId: uploaded.projectId,
            tableName: uploaded.tableName,
            source: "lakehouse",
        });
        reset();
        onClose();
        router.push("/dashboard");
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-(--backdrop) backdrop-blur-sm"
                onClick={() => { reset(); onClose(); }}
            />
            <div className="relative w-full max-w-md rounded-2xl bg-(--bg-secondary) border border-(--border-primary) shadow-2xl">
                <header className="flex items-center justify-between p-5 border-b border-(--border-primary)">
                    <div>
                        <p className="text-[10px] uppercase tracking-widest text-vanta-neon font-semibold mb-0.5">
                            Quick upload
                        </p>
                        <h2
                            className="text-lg font-bold text-(--text-primary)"
                            style={{ fontFamily: "var(--font-heading)" }}
                        >
                            Add a file
                        </h2>
                    </div>
                    <button
                        onClick={() => { reset(); onClose(); }}
                        className="w-9 h-9 rounded-lg bg-(--bg-tertiary) hover:bg-(--bg-hover) text-(--text-muted) hover:text-(--text-primary) flex items-center justify-center"
                        aria-label="Close"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                </header>

                <div className="p-5">
                    {!uploaded ? (
                        <>
                            <div
                                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                                onDrop={onDrop}
                                onClick={() => fileInputRef.current?.click()}
                                className={`rounded-xl border-2 border-dashed cursor-pointer transition-all p-6 text-center ${
                                    isDragging
                                        ? "border-vanta-neon bg-(--accent-muted)"
                                        : "border-(--border-primary) hover:border-vanta-neon/40 hover:bg-(--bg-tertiary)"
                                }`}
                            >
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".csv,.xls,.xlsx"
                                    onChange={(e) => {
                                        const f = e.target.files?.[0];
                                        if (f) onPick(f);
                                        if (fileInputRef.current) fileInputRef.current.value = "";
                                    }}
                                    className="hidden"
                                />
                                <p className="text-sm text-(--text-primary) font-medium mb-1">
                                    {picked ? picked.name : "Drop a CSV or Excel here"}
                                </p>
                                <p className="text-[11px] text-(--text-muted)">
                                    {picked
                                        ? `${(picked.size / 1024 / 1024).toFixed(2)} MB · click to replace`
                                        : "Or click to choose · CSV / XLS / XLSX up to 100 MB"}
                                </p>
                            </div>

                            {error && (
                                <div className="mt-4 px-3 py-2 rounded-md text-[11px] bg-(--error-bg) text-(--error) border border-(--error)/30">
                                    {error}
                                </div>
                            )}

                            <div className="mt-5 flex gap-3">
                                <button
                                    onClick={() => { reset(); onClose(); }}
                                    className="flex-1 h-11 rounded-xl bg-(--bg-tertiary) hover:bg-(--bg-hover) text-(--text-primary) font-medium"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={doUpload}
                                    disabled={!picked || uploading}
                                    className="flex-[2] h-11 rounded-xl bg-vanta-neon text-black font-bold hover:bg-vanta-neon/90 disabled:opacity-60"
                                >
                                    {uploading ? "Uploading…" : "Upload"}
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="space-y-4">
                            <div className="px-3 py-2 rounded-md text-[12px] bg-(--accent-muted) text-vanta-neon border border-vanta-neon/30">
                                ✓ Saved as <span className="font-semibold">{uploaded.originalFilename}</span>
                                {uploaded.rowCount !== undefined && (
                                    <span className="text-(--text-muted) ml-2">· {uploaded.rowCount.toLocaleString()} rows</span>
                                )}
                            </div>
                            <p className="text-[11px] text-(--text-muted)">
                                In your warehouse as <span className="font-mono">{uploaded.tableName}</span>.
                                Use it in any chat or build a chart from it.
                            </p>
                            <div className="flex flex-col gap-2">
                                <button
                                    onClick={attachToCurrent}
                                    className="w-full h-11 rounded-xl bg-vanta-neon text-black font-bold hover:bg-vanta-neon/90"
                                >
                                    Attach to chat
                                </button>
                                <button
                                    onClick={() => {
                                        reset();
                                        onClose();
                                        router.push("/dashboard/files");
                                    }}
                                    className="w-full h-10 rounded-lg bg-(--bg-tertiary) hover:bg-(--bg-hover) text-(--text-primary) text-sm font-medium"
                                >
                                    View all files
                                </button>
                                <button
                                    onClick={() => { reset(); onClose(); }}
                                    className="w-full h-9 text-xs text-(--text-muted) hover:text-(--text-primary)"
                                >
                                    Done
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
