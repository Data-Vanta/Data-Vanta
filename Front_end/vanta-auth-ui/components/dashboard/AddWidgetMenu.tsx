"use client";
import { useEffect, useRef, useState } from "react";
import { WIDGETS, type WidgetSpec } from "./widgets";

/**
 * Registry-driven add-widget menu. Markdown / big-number / iframe (and any
 * future widget types) are added via window.prompt(); chart-from-chat opens
 * the existing chart picker because it needs a chartSpec from another
 * session, not freeform user input.
 */
export type AddWidgetMenuProps = {
    /**
     * Adds a widget of the given type with the provided config and the
     * registry's default grid size. Wired to the boards page's POST.
     */
    onAddSimple: (type: string, config: Record<string, unknown>) => void;
    /** Opens the existing chart-from-chat picker modal. */
    onAddChart: () => void;
    /** Opens the Power-BI-style single-modal builder. */
    onAddQuery: () => void;
    /** Opens the Tableau-style shelf builder. */
    onAddShelf: () => void;
};

/**
 * Per-type prompt shape. Returning null aborts (user cancelled or invalid
 * input). Adding a new widget = add an entry to this map.
 */
const prompts: Record<string, () => Record<string, unknown> | null> = {
    markdown: () => {
        const text = window.prompt(
            "Markdown content (supports headings, lists, tables, **bold**):"
        );
        if (!text || !text.trim()) return null;
        return { content: text };
    },
    "big-number": () => {
        const value = window.prompt("Number to display:");
        if (!value || !value.trim()) return null;
        const label = window.prompt("Label (optional):") || "";
        return { value, label };
    },
    iframe: () => {
        const url = window.prompt("Embed URL (https://…):");
        if (!url || !url.trim()) return null;
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                window.alert("Only http(s) URLs are allowed.");
                return null;
            }
        } catch {
            window.alert("That doesn't look like a valid URL.");
            return null;
        }
        const title = window.prompt("Title (optional):") || "";
        return { url, title };
    },
};

export default function AddWidgetMenu({
    onAddSimple,
    onAddChart,
    onAddQuery,
    onAddShelf,
}: AddWidgetMenuProps) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);

    // Click-outside dismissal. Listens on capture phase so we beat any
    // child handlers that re-open the menu.
    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            if (!containerRef.current) return;
            if (!containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, [open]);

    // Close on Esc — keyboard accessibility.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [open]);

    const simpleSpecs: WidgetSpec[] = Object.values(WIDGETS).filter(
        (s) => s.type !== "chart" && prompts[s.type]
    );

    const triggerSimple = (spec: WidgetSpec) => {
        // Close BEFORE calling window.prompt() — Chrome's prompt steals focus
        // and the visible (still-open) menu is distracting behind the dialog.
        setOpen(false);
        const fn = prompts[spec.type];
        if (!fn) return;
        // Defer one frame so the menu disappears before the modal prompt.
        requestAnimationFrame(() => {
            const config = fn();
            if (config) onAddSimple(spec.type, config);
        });
    };

    const triggerChart = () => {
        setOpen(false);
        onAddChart();
    };

    const triggerQuery = () => {
        setOpen(false);
        onAddQuery();
    };

    const triggerShelf = () => {
        setOpen(false);
        onAddShelf();
    };

    return (
        <div className="relative inline-block" ref={containerRef}>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="px-4 h-10 rounded-xl bg-vanta-neon/10 border border-vanta-neon/30 text-sm font-semibold text-(--text-primary) hover:bg-vanta-neon/20 transition-all flex items-center gap-1"
                aria-expanded={open}
                aria-haspopup="menu"
            >
                + Add widget
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d={open ? "M18 15l-6-6-6 6" : "M6 9l6 6 6-6"} />
                </svg>
            </button>
            {open && (
                <div
                    role="menu"
                    className="absolute right-0 top-full mt-1 w-56 rounded-xl border border-(--border-primary) bg-(--bg-secondary) shadow-xl z-50 overflow-hidden"
                >
                    <button
                        type="button"
                        role="menuitem"
                        onClick={triggerQuery}
                        className="block w-full text-left px-3 py-2.5 text-sm font-semibold text-vanta-neon hover:bg-(--bg-tertiary) border-b border-(--border-primary)/40"
                    >
                        Chart from data ⌁
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        onClick={triggerShelf}
                        className="block w-full text-left px-3 py-2.5 text-sm font-semibold text-vanta-neon hover:bg-(--bg-tertiary) border-b border-(--border-primary)/40"
                    >
                        Build (shelves)
                    </button>
                    {simpleSpecs.map((spec) => (
                        <button
                            key={spec.type}
                            type="button"
                            role="menuitem"
                            onClick={() => triggerSimple(spec)}
                            className="block w-full text-left px-3 py-2.5 text-sm text-(--text-primary) hover:bg-(--bg-tertiary) border-b border-(--border-primary)/40 last:border-b-0"
                        >
                            {spec.label}
                        </button>
                    ))}
                    <button
                        type="button"
                        role="menuitem"
                        onClick={triggerChart}
                        className="block w-full text-left px-3 py-2.5 text-sm text-(--text-primary) hover:bg-(--bg-tertiary) border-t border-(--border-primary)/40"
                    >
                        Chart from a chat
                    </button>
                </div>
            )}
        </div>
    );
}
