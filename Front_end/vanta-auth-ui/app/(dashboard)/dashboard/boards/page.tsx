"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Dashboard {
    id: string;
    name: string;
    description: string | null;
    visibility: "private" | "team" | "public-link";
    shareToken: string | null;
    createdAt: string;
    updatedAt: string;
}

export default function BoardsListPage() {
    const router = useRouter();
    const [boards, setBoards] = useState<Dashboard[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState("");

    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1";

    const load = useCallback(async () => {
        setLoading(true);
        setErr(null);
        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${apiUrl}/dashboards`, { headers: { "x-auth-token": token } });
            const body = await res.json();
            if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
            setBoards(body.data || []);
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Could not load dashboards");
        } finally {
            setLoading(false);
        }
    }, [apiUrl]);

    useEffect(() => { load(); }, [load]);

    async function createBoard(e: React.FormEvent) {
        e.preventDefault();
        if (!newName.trim()) return;
        setErr(null);
        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${apiUrl}/dashboards`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-auth-token": token },
                body: JSON.stringify({ name: newName.trim() }),
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
            setNewName("");
            setCreating(false);
            router.push(`/dashboard/boards/${body.data.id}`);
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Could not create dashboard");
        }
    }

    async function removeBoard(id: string) {
        if (!confirm("Delete this dashboard? All widgets will be lost.")) return;
        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${apiUrl}/dashboards/${id}`, {
                method: "DELETE",
                headers: { "x-auth-token": token },
            });
            if (!res.ok && res.status !== 204) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message || `HTTP ${res.status}`);
            }
            setBoards((prev) => prev.filter((d) => d.id !== id));
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Could not delete");
        }
    }

    return (
        <div className="flex-1 relative h-full overflow-y-auto">
            <div
                aria-hidden
                className="absolute inset-0 pointer-events-none"
                style={{ background: "radial-gradient(ellipse 60% 30% at 50% 0%, rgba(188,255,60,0.05), transparent 60%)" }}
            />
            <div className="relative max-w-6xl mx-auto px-8 py-10">
                <header className="flex items-end justify-between mb-10 gap-4 flex-wrap">
                    <div>
                        <p className="text-xs font-semibold text-vanta-neon tracking-widest uppercase mb-2">
                            Dashboards
                        </p>
                        <h1
                            className="text-3xl md:text-4xl font-bold text-(--text-primary) mb-2"
                            style={{ fontFamily: "var(--font-heading)" }}
                        >
                            Boards
                        </h1>
                        <p className="text-(--text-muted)">
                            Pin the best charts from your chats and share them.
                        </p>
                    </div>
                    {!creating && (
                        <button
                            onClick={() => setCreating(true)}
                            className="inline-flex items-center gap-2 px-4 py-2.5 bg-vanta-neon text-black font-semibold rounded-xl hover:bg-vanta-neon/90 transition-all shadow-md shadow-vanta-neon/25"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 5v14M5 12h14" />
                            </svg>
                            New dashboard
                        </button>
                    )}
                </header>

                {creating && (
                    <form
                        onSubmit={createBoard}
                        className="mb-8 rounded-2xl border border-vanta-neon/30 bg-(--bg-secondary)/80 p-5 flex flex-col sm:flex-row gap-3"
                    >
                        <input
                            autoFocus
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder="Dashboard name"
                            maxLength={200}
                            className="flex-1 h-11 px-4 rounded-xl bg-(--bg-tertiary) border border-(--border-primary) text-(--text-primary) placeholder:text-(--text-muted) focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent)/25 transition-all"
                        />
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => { setCreating(false); setNewName(""); }}
                                className="h-11 px-4 rounded-xl bg-(--bg-tertiary) hover:bg-(--bg-hover) text-(--text-primary) font-medium transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="h-11 px-5 rounded-xl bg-vanta-neon text-black font-bold hover:bg-vanta-neon/90 transition-colors"
                            >
                                Create
                            </button>
                        </div>
                    </form>
                )}

                {err && (
                    <div className="mb-6 rounded-xl border border-(--error)/30 bg-(--error-bg) text-(--error) px-4 py-3">
                        {err}
                    </div>
                )}

                {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="h-40 rounded-2xl border border-(--border-primary) bg-(--bg-secondary)/50 animate-pulse" />
                        ))}
                    </div>
                ) : boards.length === 0 ? (
                    <EmptyState onCreate={() => setCreating(true)} />
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {boards.map((d) => (
                            <div
                                key={d.id}
                                className="group relative rounded-2xl border border-(--border-primary) bg-(--bg-secondary)/60 hover:bg-(--bg-secondary) hover:border-vanta-neon/40 transition-all p-5 overflow-hidden"
                            >
                                <div
                                    aria-hidden
                                    className="absolute -top-16 -right-16 w-32 h-32 rounded-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                                    style={{ background: "radial-gradient(circle, rgba(188,255,60,0.2), transparent 70%)" }}
                                />
                                <div className="relative">
                                    <Link href={`/dashboard/boards/${d.id}`} className="block">
                                        <h3 className="font-semibold text-(--text-primary) truncate group-hover:text-vanta-neon transition-colors mb-1">
                                            {d.name}
                                        </h3>
                                        {d.description && (
                                            <p className="text-xs text-(--text-muted) line-clamp-2 mb-3">{d.description}</p>
                                        )}
                                        <div className="mt-4 pt-4 border-t border-(--border-secondary) flex items-center justify-between">
                                            <span className="text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-semibold bg-(--bg-tertiary) text-(--text-muted)">
                                                {d.visibility === "public-link" ? "Shared" : d.visibility}
                                            </span>
                                            <span className="text-[11px] text-(--text-muted)">
                                                {new Date(d.updatedAt).toLocaleDateString()}
                                            </span>
                                        </div>
                                    </Link>
                                    <button
                                        onClick={() => removeBoard(d.id)}
                                        className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-(--error-bg) transition-all"
                                        title="Delete"
                                    >
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2">
                                            <polyline points="3 6 5 6 21 6" />
                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
    return (
        <div className="relative rounded-3xl border border-(--border-primary) bg-(--bg-secondary)/60 p-12 text-center overflow-hidden">
            <div
                aria-hidden
                className="absolute -top-24 -left-24 w-64 h-64 rounded-full blur-3xl pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(188,255,60,0.15), transparent 70%)" }}
            />
            <div className="relative">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-vanta-neon/10 border border-vanta-neon/30 flex items-center justify-center mb-5">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#BCFF3C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="7" height="9" rx="1" />
                        <rect x="14" y="3" width="7" height="5" rx="1" />
                        <rect x="14" y="12" width="7" height="9" rx="1" />
                        <rect x="3" y="16" width="7" height="5" rx="1" />
                    </svg>
                </div>
                <h3 className="text-2xl font-bold text-(--text-primary) mb-2" style={{ fontFamily: "var(--font-heading)" }}>
                    No dashboards yet
                </h3>
                <p className="text-(--text-muted) mb-7 max-w-sm mx-auto">
                    Start a chat, pin a chart you like, and it lands here as a live widget.
                </p>
                <button
                    onClick={onCreate}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-vanta-neon text-black font-bold rounded-xl hover:bg-vanta-neon/90 transition-all shadow-md shadow-vanta-neon/25"
                >
                    Create your first dashboard
                </button>
            </div>
        </div>
    );
}
