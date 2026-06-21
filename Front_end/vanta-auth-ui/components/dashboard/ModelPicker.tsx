"use client";
import { useEffect, useState, useRef } from "react";

export interface ModelInfo {
    id: string;
    label: string;
    provider: string;
    context_window: number;
    capabilities: string[];
    description?: string;
}

interface ModelsResponse {
    default: string;
    paid: ModelInfo[];
    free: ModelInfo[];
}

const STORAGE_KEY = "vanta-selected-model";

/**
 * Chat model selector. Fetches /models from Chart-API, stores the user's
 * choice in localStorage, and renders a two-section (Free / Paid) dropdown.
 *
 * The selected id is exposed via the `onChange` callback and also written to
 * localStorage so other components (the chat sender) can read it without
 * prop-drilling.
 */
export default function ModelPicker({
    onChange,
}: {
    onChange?: (id: string) => void;
}) {
    const [models, setModels] = useState<ModelsResponse | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    // Initial fetch — runs once on mount
    useEffect(() => {
        let cancelled = false;
        const chartUrl =
            process.env.NEXT_PUBLIC_CHART_API_URL || "http://127.0.0.1:8000";
        (async () => {
            try {
                const res = await fetch(`${chartUrl}/models`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json: ModelsResponse = await res.json();
                if (cancelled) return;
                setModels(json);
                const stored = localStorage.getItem(STORAGE_KEY);
                const initial =
                    (stored &&
                        [...json.paid, ...json.free].some((m) => m.id === stored) &&
                        stored) ||
                    json.default;
                setSelected(initial);
                onChange?.(initial);
            } catch (e) {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : "Could not load models");
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [onChange]);

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

    const choose = (id: string) => {
        setSelected(id);
        localStorage.setItem(STORAGE_KEY, id);
        onChange?.(id);
        setOpen(false);
    };

    const currentLabel =
        (models && [...models.paid, ...models.free].find((m) => m.id === selected)?.label) ||
        "Model";
    const isFree = selected?.endsWith(":free") || selected === "openrouter/free";

    return (
        <div className="relative" ref={panelRef}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                disabled={loading || !!error}
                className="h-9 px-3 pr-2 rounded-lg bg-(--bg-secondary) border border-(--border-primary) hover:border-(--accent) text-xs font-medium text-(--text-secondary) hover:text-(--text-primary) transition-all flex items-center gap-2 disabled:opacity-50"
                title={error || "Select model"}
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M9 3l4 9-4 9M5 12h14" />
                </svg>
                <span className="truncate max-w-[140px]">
                    {loading ? "Loading…" : error ? "No models" : currentLabel}
                </span>
                {isFree && !loading && (
                    <span className="text-[9px] font-bold uppercase tracking-widest text-vanta-neon bg-vanta-neon/10 border border-vanta-neon/30 rounded px-1.5 py-px">
                        Free
                    </span>
                )}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>

            {open && models && (
                <div className="absolute bottom-11 left-0 z-40 w-80 max-h-[420px] overflow-y-auto rounded-xl bg-(--bg-secondary) border border-(--border-primary) shadow-xl">
                    {models.paid.length > 0 && (
                        <div className="p-2">
                            <div className="px-2 pb-1 text-[10px] uppercase tracking-widest text-(--text-muted) font-semibold">
                                Paid (bring your OpenRouter key)
                            </div>
                            {models.paid.map((m) => (
                                <ModelRow
                                    key={m.id}
                                    model={m}
                                    selected={m.id === selected}
                                    onClick={() => choose(m.id)}
                                />
                            ))}
                        </div>
                    )}
                    {models.free.length > 0 && (
                        <div className="p-2 border-t border-(--border-secondary)">
                            <div className="px-2 pb-1 flex items-center gap-2">
                                <span className="text-[10px] uppercase tracking-widest text-vanta-neon font-semibold">
                                    Free
                                </span>
                                <span className="text-[9px] text-(--text-muted)">(rate-limited by OpenRouter)</span>
                            </div>
                            {models.free.map((m) => (
                                <ModelRow
                                    key={m.id}
                                    model={m}
                                    selected={m.id === selected}
                                    onClick={() => choose(m.id)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function ModelRow({
    model,
    selected,
    onClick,
}: {
    model: ModelInfo;
    selected: boolean;
    onClick: () => void;
}) {
    const ctxK = model.context_window >= 1_000_000
        ? `${(model.context_window / 1_000_000).toFixed(1)}M`
        : `${Math.round(model.context_window / 1000)}K`;
    return (
        <button
            type="button"
            onClick={onClick}
            className={`w-full text-left px-3 py-2.5 rounded-lg transition-all ${selected
                    ? "bg-(--accent-muted) border border-(--accent)/30"
                    : "hover:bg-(--bg-hover) border border-transparent"
                }`}
        >
            <div className="flex items-center gap-2">
                <span className={`text-sm font-semibold truncate ${selected ? "text-(--accent)" : "text-(--text-primary)"}`}>
                    {model.label}
                </span>
                {selected && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-(--accent)">
                        <polyline points="20 6 9 17 4 12" />
                    </svg>
                )}
                <span className="ml-auto text-[10px] font-mono text-(--text-muted)">{ctxK}</span>
            </div>
            {model.description && (
                <div className="mt-1 text-[11px] text-(--text-muted) leading-relaxed line-clamp-2">
                    {model.description}
                </div>
            )}
        </button>
    );
}
