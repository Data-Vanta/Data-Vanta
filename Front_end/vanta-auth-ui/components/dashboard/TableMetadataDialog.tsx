"use client";
import { useCallback, useEffect, useState } from "react";

interface Metadata {
    alias: string | null;
    description: string | null;
}

/**
 * Compact modal to set an alias + description for a lakehouse table.
 * Used from the Files page cards and the chat dataset picker.
 *
 * Backed by GET/PUT /api/v1/tables/:projectId/:tableName/metadata.
 */
export default function TableMetadataDialog({
    isOpen,
    onClose,
    projectId,
    tableName,
    onSaved,
}: {
    isOpen: boolean;
    onClose: () => void;
    projectId: string;
    tableName: string;
    onSaved?: (m: Metadata) => void;
}) {
    const [alias, setAlias] = useState("");
    const [description, setDescription] = useState("");
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1";

    const load = useCallback(async () => {
        setLoading(true);
        setErr(null);
        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(
                `${apiUrl}/tables/${encodeURIComponent(projectId)}/${encodeURIComponent(tableName)}/metadata`,
                { headers: { "x-auth-token": token } }
            );
            const body = await res.json();
            if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
            setAlias(body.data?.alias || "");
            setDescription(body.data?.description || "");
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Could not load metadata");
        } finally {
            setLoading(false);
        }
    }, [apiUrl, projectId, tableName]);

    useEffect(() => {
        if (isOpen) load();
    }, [isOpen, load]);

    async function save() {
        setSaving(true);
        setErr(null);
        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(
                `${apiUrl}/tables/${encodeURIComponent(projectId)}/${encodeURIComponent(tableName)}/metadata`,
                {
                    method: "PUT",
                    headers: { "Content-Type": "application/json", "x-auth-token": token },
                    body: JSON.stringify({
                        alias: alias.trim() || null,
                        description: description.trim() || null,
                    }),
                }
            );
            const body = await res.json();
            if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
            onSaved?.({ alias: alias.trim() || null, description: description.trim() || null });
            onClose();
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Could not save metadata");
        } finally {
            setSaving(false);
        }
    }

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-(--backdrop) backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-md bg-(--bg-secondary) border border-(--border-primary) rounded-2xl shadow-2xl p-6">
                <header className="mb-4">
                    <p className="text-[10px] uppercase tracking-widest text-vanta-neon font-semibold mb-1">
                        Table metadata
                    </p>
                    <h3
                        className="text-lg font-bold text-(--text-primary)"
                        style={{ fontFamily: "var(--font-heading)" }}
                    >
                        {tableName}
                    </h3>
                    <p className="text-xs text-(--text-muted) mt-0.5">Project: {projectId}</p>
                </header>

                <div className="space-y-4">
                    <label className="block">
                        <span className="text-xs font-semibold text-(--text-secondary) uppercase tracking-wider">
                            Alias
                        </span>
                        <input
                            value={alias}
                            onChange={(e) => setAlias(e.target.value)}
                            placeholder="e.g. Q3 Sales"
                            maxLength={200}
                            className="mt-1.5 w-full h-11 px-3 rounded-lg bg-(--bg-tertiary) border border-(--border-primary) text-(--text-primary) text-sm placeholder:text-(--text-muted) focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent)/25 transition-all"
                        />
                    </label>
                    <label className="block">
                        <span className="text-xs font-semibold text-(--text-secondary) uppercase tracking-wider">
                            Description
                        </span>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={5}
                            maxLength={4000}
                            placeholder="Business context, caveats, preferred units…"
                            className="mt-1.5 w-full p-3 rounded-lg bg-(--bg-tertiary) border border-(--border-primary) text-(--text-primary) text-sm placeholder:text-(--text-muted) focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent)/25 transition-all resize-none"
                        />
                    </label>

                    {loading && (
                        <p className="text-xs text-(--text-muted)">Loading current metadata…</p>
                    )}
                    {err && (
                        <div className="rounded-lg border border-(--error)/30 bg-(--error-bg) text-(--error) text-sm px-3 py-2">
                            {err}
                        </div>
                    )}
                </div>

                <footer className="mt-6 flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 h-11 rounded-xl bg-(--bg-tertiary) hover:bg-(--bg-hover) text-(--text-primary) font-medium transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={save}
                        disabled={saving || loading}
                        className="flex-[2] h-11 rounded-xl bg-vanta-neon text-black font-bold hover:bg-vanta-neon/90 transition-all shadow-md shadow-vanta-neon/25 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {saving ? "Saving…" : "Save metadata"}
                    </button>
                </footer>
            </div>
        </div>
    );
}
