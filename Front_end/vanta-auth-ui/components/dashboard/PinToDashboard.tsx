"use client";
import { useCallback, useEffect, useState } from "react";

interface Dashboard {
    id: string;
    name: string;
}

/**
 * Pick a dashboard (or create one) to pin the supplied chart spec into.
 * Fires POST /dashboards/:id/widgets with type="chart" + config.chartSpec.
 */
export default function PinToDashboard({
    chartSpec,
    title,
    isOpen,
    onClose,
    onPinned,
}: {
    chartSpec: unknown;
    title?: string;
    isOpen: boolean;
    onClose: () => void;
    onPinned?: (dashboardId: string) => void;
}) {
    const [boards, setBoards] = useState<Dashboard[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [newName, setNewName] = useState("");
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

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
            if (body.data?.length) setSelected(body.data[0].id);
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Could not load dashboards");
        } finally {
            setLoading(false);
        }
    }, [apiUrl]);

    useEffect(() => { if (isOpen) { load(); setNewName(""); setErr(null); } }, [isOpen, load]);

    async function doPin() {
        setBusy(true);
        setErr(null);
        try {
            const token = localStorage.getItem("authToken") || "";
            let boardId = selected;

            if (!boardId) {
                if (!newName.trim()) {
                    throw new Error("Give the new dashboard a name.");
                }
                const cres = await fetch(`${apiUrl}/dashboards`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-auth-token": token },
                    body: JSON.stringify({ name: newName.trim() }),
                });
                const cbody = await cres.json();
                if (!cres.ok) throw new Error(cbody.message || `HTTP ${cres.status}`);
                boardId = cbody.data.id;
            }

            const pres = await fetch(`${apiUrl}/dashboards/${boardId}/widgets`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-auth-token": token },
                body: JSON.stringify({
                    type: "chart",
                    config: { chartSpec, title: title || null },
                    gridW: 6,
                    gridH: 4,
                }),
            });
            const pbody = await pres.json();
            if (!pres.ok) throw new Error(pbody.message || `HTTP ${pres.status}`);

            onPinned?.(boardId as string);
            onClose();
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Could not pin");
        } finally {
            setBusy(false);
        }
    }

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-(--backdrop) backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-md bg-(--bg-secondary) border border-(--border-primary) rounded-2xl shadow-2xl p-6">
                <header className="mb-4">
                    <p className="text-[10px] uppercase tracking-widest text-vanta-neon font-semibold mb-1">
                        Pin to dashboard
                    </p>
                    <h3 className="text-lg font-bold text-(--text-primary)" style={{ fontFamily: "var(--font-heading)" }}>
                        Save this chart
                    </h3>
                </header>

                <div className="space-y-3">
                    {loading ? (
                        <div className="h-16 rounded-lg bg-(--bg-tertiary) animate-pulse" />
                    ) : boards.length > 0 ? (
                        <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                            {boards.map((b) => (
                                <button
                                    key={b.id}
                                    type="button"
                                    onClick={() => setSelected(b.id)}
                                    className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${selected === b.id
                                        ? "bg-vanta-neon/10 border-vanta-neon/50 text-vanta-neon"
                                        : "bg-(--bg-tertiary) border-(--border-primary) text-(--text-primary) hover:border-(--accent)"
                                        }`}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-medium truncate">{b.name}</span>
                                        {selected === b.id && (
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="20 6 9 17 4 12" />
                                            </svg>
                                        )}
                                    </div>
                                </button>
                            ))}
                        </div>
                    ) : null}

                    <div className="pt-3 border-t border-(--border-secondary) space-y-2">
                        <p className="text-xs text-(--text-muted)">Or create a new dashboard:</p>
                        <input
                            value={newName}
                            onChange={(e) => { setNewName(e.target.value); setSelected(null); }}
                            placeholder="New dashboard name"
                            maxLength={200}
                            className="w-full h-11 px-3 rounded-lg bg-(--bg-tertiary) border border-(--border-primary) text-(--text-primary) placeholder:text-(--text-muted) text-sm focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent)/25 transition-all"
                        />
                    </div>

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
                        onClick={doPin}
                        disabled={busy || (boards.length === 0 && !newName.trim() && !selected)}
                        className="flex-[2] h-11 rounded-xl bg-vanta-neon text-black font-bold hover:bg-vanta-neon/90 transition-all shadow-md shadow-vanta-neon/25 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {busy ? "Pinning…" : "Pin"}
                    </button>
                </footer>
            </div>
        </div>
    );
}
