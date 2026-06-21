"use client";
import { useCallback, useEffect, useRef, useState } from "react";

interface Notification {
    id: string;
    type: string;
    title: string;
    body: string | null;
    data: Record<string, unknown> | null;
    read_at: string | null;
    created_at: string;
}

/**
 * Bell icon + dropdown panel for in-app notifications. Polls initial
 * state on open, then subscribes to GET /notifications/stream (SSE)
 * so new rows appear live. Unread count is kept on the badge regardless
 * of whether the panel is open.
 */
export default function NotificationBell() {
    const [items, setItems] = useState<Notification[]>([]);
    const [unread, setUnread] = useState(0);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);

    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1";

    const load = useCallback(async () => {
        setLoading(true);
        setErr(null);
        try {
            const token = localStorage.getItem("authToken") || "";
            if (!token) { setItems([]); setUnread(0); return; }
            const res = await fetch(`${apiUrl}/notifications?limit=30`, {
                headers: { "x-auth-token": token },
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
            setItems(body.data?.items || []);
            setUnread(body.data?.unread || 0);
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Could not load");
        } finally {
            setLoading(false);
        }
    }, [apiUrl]);

    // Initial fetch once on mount (for the badge), plus reload whenever
    // the panel opens (to pick up anything received while closed).
    useEffect(() => { load(); }, [load]);
    useEffect(() => { if (open) load(); }, [open, load]);

    // SSE subscription — runs as long as the component is mounted.
    useEffect(() => {
        const token = (typeof window !== "undefined" && localStorage.getItem("authToken")) || "";
        if (!token) return;

        const controller = new AbortController();
        abortRef.current = controller;

        (async () => {
            try {
                const res = await fetch(`${apiUrl}/notifications/stream`, {
                    headers: { "x-auth-token": token },
                    signal: controller.signal,
                });
                if (!res.ok || !res.body) return;
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buf = "";
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buf += decoder.decode(value, { stream: true });
                    const parts = buf.split("\n\n");
                    buf = parts.pop() || "";
                    for (const part of parts) {
                        const line = part.split("\n").find((l) => l.startsWith("data:"));
                        if (!line) continue;
                        try {
                            const n: Notification = JSON.parse(line.replace(/^data:\s*/, ""));
                            setItems((prev) => [n, ...prev.filter((i) => i.id !== n.id)].slice(0, 100));
                            if (!n.read_at) setUnread((u) => u + 1);
                        } catch {
                            /* ignore */
                        }
                    }
                }
            } catch {
                // AbortError or network drop — fine, useEffect will re-run if deps change.
            }
        })();

        return () => controller.abort();
    }, [apiUrl]);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [open]);

    async function markAllRead() {
        try {
            const token = localStorage.getItem("authToken") || "";
            await fetch(`${apiUrl}/notifications/read-all`, {
                method: "POST",
                headers: { "x-auth-token": token },
            });
            setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
            setUnread(0);
        } catch { /* noop */ }
    }

    async function markRead(id: string) {
        try {
            const token = localStorage.getItem("authToken") || "";
            await fetch(`${apiUrl}/notifications/${id}/read`, {
                method: "POST",
                headers: { "x-auth-token": token },
            });
            setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
            setUnread((u) => Math.max(0, u - 1));
        } catch { /* noop */ }
    }

    return (
        <div className="relative" ref={panelRef}>
            <button
                onClick={() => setOpen((o) => !o)}
                className="relative w-9 h-9 rounded-lg border border-(--border-primary) bg-(--bg-secondary) hover:border-vanta-neon/50 text-(--text-secondary) hover:text-(--text-primary) transition-all flex items-center justify-center"
                aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {unread > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-vanta-neon text-black text-[10px] font-black flex items-center justify-center shadow shadow-vanta-neon/40">
                        {unread > 99 ? "99+" : unread}
                    </span>
                )}
            </button>

            {open && (
                <div className="absolute right-0 top-12 z-50 w-[360px] max-h-[480px] rounded-xl bg-(--bg-secondary) border border-(--border-primary) shadow-2xl flex flex-col overflow-hidden">
                    <header className="flex items-center justify-between px-4 py-3 border-b border-(--border-primary)">
                        <div>
                            <p className="text-[10px] uppercase tracking-widest text-vanta-neon font-semibold">
                                Notifications
                            </p>
                            <p className="text-sm font-semibold text-(--text-primary)">
                                {unread > 0 ? `${unread} unread` : "All caught up"}
                            </p>
                        </div>
                        {unread > 0 && (
                            <button
                                onClick={markAllRead}
                                className="text-xs text-(--text-muted) hover:text-vanta-neon transition-colors font-medium"
                            >
                                Mark all read
                            </button>
                        )}
                    </header>

                    <div className="flex-1 overflow-y-auto">
                        {loading && items.length === 0 ? (
                            <div className="p-4 space-y-2">
                                {Array.from({ length: 3 }).map((_, i) => (
                                    <div key={i} className="h-12 rounded-lg bg-(--bg-tertiary) animate-pulse" />
                                ))}
                            </div>
                        ) : err ? (
                            <div className="p-4 text-sm text-(--error)">{err}</div>
                        ) : items.length === 0 ? (
                            <div className="p-6 text-center text-sm text-(--text-muted)">
                                Nothing yet. New activity will appear here.
                            </div>
                        ) : (
                            <ul className="p-1">
                                {items.map((n) => (
                                    <li
                                        key={n.id}
                                        onClick={() => !n.read_at && markRead(n.id)}
                                        className={`p-3 rounded-lg cursor-pointer transition-colors ${n.read_at
                                            ? "hover:bg-(--bg-hover)"
                                            : "bg-vanta-neon/5 hover:bg-vanta-neon/10"
                                            }`}
                                    >
                                        <div className="flex items-start gap-2">
                                            {!n.read_at && (
                                                <span className="flex-none w-1.5 h-1.5 mt-2 rounded-full bg-vanta-neon" />
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-semibold text-(--text-primary) truncate">{n.title}</p>
                                                {n.body && (
                                                    <p className="text-xs text-(--text-muted) mt-0.5 line-clamp-2">{n.body}</p>
                                                )}
                                                <p className="text-[10px] text-(--text-muted) uppercase tracking-wider mt-1">
                                                    {timeAgo(n.created_at)}
                                                </p>
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
}
