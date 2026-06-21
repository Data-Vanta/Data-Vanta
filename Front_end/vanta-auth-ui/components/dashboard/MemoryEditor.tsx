"use client";
import { useCallback, useEffect, useState } from "react";

interface Memory {
    id: string;
    content: string;
    created_at?: string;
}

/**
 * CRUD panel for long-term user memories. Memories, when present, are
 * prepended to every chat's system prompt by the thinking-mode agent so
 * the assistant remembers business context across sessions.
 *
 * Backed by GET/POST/DELETE /api/v1/profile/memories.
 */
export default function MemoryEditor() {
    const [items, setItems] = useState<Memory[]>([]);
    const [draft, setDraft] = useState("");
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1";

    const load = useCallback(async () => {
        setLoading(true);
        setErr(null);
        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${apiUrl}/profile/memories`, {
                headers: { "x-auth-token": token },
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
            setItems(body.data || []);
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Could not load memories");
        } finally {
            setLoading(false);
        }
    }, [apiUrl]);

    useEffect(() => {
        load();
    }, [load]);

    async function add() {
        if (!draft.trim()) return;
        setBusy(true);
        setErr(null);
        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${apiUrl}/profile/memories`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-auth-token": token },
                body: JSON.stringify({ content: draft.trim() }),
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
            setItems((prev) => [body.data, ...prev]);
            setDraft("");
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Could not save memory");
        } finally {
            setBusy(false);
        }
    }

    async function remove(id: string) {
        if (!confirm("Remove this memory?")) return;
        setBusy(true);
        setErr(null);
        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${apiUrl}/profile/memories/${id}`, {
                method: "DELETE",
                headers: { "x-auth-token": token },
            });
            if (!res.ok && res.status !== 204) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message || `HTTP ${res.status}`);
            }
            setItems((prev) => prev.filter((m) => m.id !== id));
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Could not delete");
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="space-y-4">
            <div>
                <p className="text-sm text-(--text-muted) leading-relaxed">
                    Vanta prepends these to every chat&rsquo;s system prompt so it remembers
                    business context across conversations. Keep them factual and
                    specific — &ldquo;ARR is in USD cents&rdquo;, &ldquo;exclude internal users with @company.com&rdquo;.
                </p>
            </div>

            {/* Add new */}
            <div className="space-y-2">
                <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    maxLength={2000}
                    rows={3}
                    placeholder="Add a new memory…"
                    className="w-full p-3 rounded-lg bg-(--bg-tertiary) border border-(--border-primary) text-(--text-primary) text-sm placeholder:text-(--text-muted) focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent)/25 transition-all resize-none"
                />
                <div className="flex items-center gap-2">
                    <span className="text-[11px] text-(--text-muted) ml-1">
                        {draft.length} / 2000
                    </span>
                    <button
                        onClick={add}
                        disabled={busy || !draft.trim()}
                        className="ml-auto px-4 h-9 rounded-lg bg-vanta-neon text-black text-sm font-semibold hover:bg-vanta-neon/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {busy ? "Saving…" : "Add memory"}
                    </button>
                </div>
            </div>

            {err && (
                <div className="rounded-lg border border-(--error)/30 bg-(--error-bg) text-(--error) text-sm px-3 py-2">
                    {err}
                </div>
            )}

            {/* List */}
            <div className="pt-2 border-t border-(--border-secondary) space-y-2">
                <p className="text-[11px] font-semibold text-(--text-muted) uppercase tracking-wider">
                    Saved memories
                </p>
                {loading ? (
                    <div className="space-y-2">
                        {Array.from({ length: 2 }).map((_, i) => (
                            <div key={i} className="h-16 rounded-lg bg-(--bg-tertiary) animate-pulse" />
                        ))}
                    </div>
                ) : items.length === 0 ? (
                    <div className="rounded-lg border border-(--border-secondary) border-dashed p-6 text-center text-sm text-(--text-muted)">
                        No memories yet. Add one above to give Vanta long-term context.
                    </div>
                ) : (
                    <ul className="space-y-2">
                        {items.map((m) => (
                            <li
                                key={m.id}
                                className="group rounded-lg border border-(--border-primary) bg-(--bg-tertiary) p-3 flex items-start gap-3"
                            >
                                <span className="flex-none w-1.5 h-1.5 rounded-full bg-vanta-neon mt-2" />
                                <p className="flex-1 text-sm text-(--text-primary) whitespace-pre-wrap">
                                    {m.content}
                                </p>
                                <button
                                    onClick={() => remove(m.id)}
                                    className="flex-none opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-(--error-bg) transition-all"
                                    title="Delete"
                                    aria-label="Delete memory"
                                >
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2">
                                        <polyline points="3 6 5 6 21 6" />
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                    </svg>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
