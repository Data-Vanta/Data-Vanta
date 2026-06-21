"use client";
import { useEffect, useState } from "react";

/**
 * Slide-over drawer that lets the user tweak per-chat settings — today
 * that's the session-scoped "system prompt" (describe your business /
 * dataset). The Phase 2b backend accepts PATCH
 * /api/v1/chat/sessions/:id/settings with { systemPrompt, mode, modelId }.
 *
 * When no sessionId exists yet (brand-new conversation) the value is
 * staged in local state and the parent can pass it on first message.
 */

interface Props {
    isOpen: boolean;
    onClose: () => void;
    sessionId: string | null;
    /** Currently-persisted prompt (or staged) */
    value: string;
    /** Called after successful save */
    onSaved: (next: string) => void;
}

export default function ChatSettingsDrawer({
    isOpen,
    onClose,
    sessionId,
    value,
    onSaved,
}: Props) {
    const [draft, setDraft] = useState(value);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    // Reset draft when drawer (re)opens
    useEffect(() => {
        if (isOpen) {
            setDraft(value);
            setErr(null);
        }
    }, [isOpen, value]);

    async function save() {
        if (draft.length > 4000) {
            setErr("Max 4000 characters.");
            return;
        }
        setErr(null);
        setSaving(true);
        try {
            // If the session exists on the server, persist; otherwise just
            // bubble up — the first message will carry the prompt.
            if (sessionId) {
                const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1";
                const token = localStorage.getItem("authToken") || "";
                const res = await fetch(`${apiUrl}/chat/sessions/${sessionId}/settings`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json", "x-auth-token": token },
                    body: JSON.stringify({ systemPrompt: draft || null }),
                });
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error(body.message || `HTTP ${res.status}`);
                }
            }
            onSaved(draft);
            onClose();
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Could not save");
        } finally {
            setSaving(false);
        }
    }

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-100 flex justify-end">
            <div
                className="absolute inset-0 bg-(--backdrop) backdrop-blur-sm"
                onClick={onClose}
            />

            <aside className="relative w-full sm:w-[440px] bg-(--bg-secondary) border-l border-(--border-primary) h-full shadow-2xl flex flex-col">
                <header className="flex items-center justify-between p-5 border-b border-(--border-primary)">
                    <div>
                        <p className="text-[10px] uppercase tracking-widest text-vanta-neon font-semibold mb-0.5">
                            Chat context
                        </p>
                        <h2
                            className="text-lg font-bold text-(--text-primary)"
                            style={{ fontFamily: "var(--font-heading)" }}
                        >
                            Describe your business or dataset
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 rounded-lg bg-(--bg-tertiary) hover:bg-(--bg-hover) text-(--text-muted) hover:text-(--text-primary) transition-colors flex items-center justify-center"
                        aria-label="Close"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                </header>

                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    <p className="text-sm text-(--text-muted) leading-relaxed">
                        Vanta prepends this to every prompt in this chat. Use it to set
                        the scene — what the data is, who uses it, what &ldquo;good&rdquo;
                        looks like — so the AI speaks in your terms.
                    </p>

                    <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={14}
                        maxLength={4000}
                        placeholder="e.g. This table tracks our D2C subscription revenue. ARR is in USD cents, NRR excludes the free tier. Don't mention internal SKU codes in answers; use product names from the 'product' column."
                        className="w-full p-4 rounded-xl bg-(--bg-tertiary) border border-(--border-primary) text-(--text-primary) text-sm placeholder:text-(--text-muted) focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent)/25 transition-all resize-none"
                    />
                    <div className="flex justify-between text-[11px] text-(--text-muted)">
                        <span>Stored per chat. Empty = no override.</span>
                        <span>{draft.length} / 4000</span>
                    </div>

                    {err && (
                        <div className="rounded-lg border border-(--error)/30 bg-(--error-bg) text-(--error) text-sm px-3 py-2">
                            {err}
                        </div>
                    )}

                    <div className="pt-2 border-t border-(--border-secondary)">
                        <p className="text-[11px] font-semibold text-(--text-muted) uppercase tracking-wider mb-2">
                            Starter templates
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {STARTERS.map((s) => (
                                <button
                                    key={s.label}
                                    type="button"
                                    onClick={() => setDraft(s.body)}
                                    className="px-3 py-1.5 text-xs rounded-lg border border-(--border-primary) bg-(--bg-tertiary) hover:border-vanta-neon/50 hover:text-(--text-primary) text-(--text-secondary) transition-all"
                                >
                                    {s.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <footer className="p-5 border-t border-(--border-primary) flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 h-11 rounded-xl bg-(--bg-tertiary) hover:bg-(--bg-hover) text-(--text-primary) font-medium transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={save}
                        disabled={saving}
                        className="flex-[2] h-11 rounded-xl bg-vanta-neon text-black font-bold hover:bg-vanta-neon/90 transition-all shadow-md shadow-vanta-neon/25 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {saving ? "Saving…" : "Save context"}
                    </button>
                </footer>
            </aside>
        </div>
    );
}

const STARTERS = [
    {
        label: "Sales / revenue",
        body:
            "This table captures sales orders. Revenue is in USD. A 'churn' is defined as a subscription that wasn't renewed within 30 days of its term. Use fiscal quarters (Q1 starts Feb 1) when grouping by period.",
    },
    {
        label: "Marketing / funnel",
        body:
            "This table is our marketing funnel. Stages in order: visit → signup → activated → paid. Conversion % should be computed stage-to-stage, not cumulative. Exclude traffic from the 'internal' source.",
    },
    {
        label: "Product analytics",
        body:
            "This is event-level product data. A user is 'active' if they trigger any event in a given week. Ignore events from users whose email ends in @our-company.com (internal team).",
    },
];
