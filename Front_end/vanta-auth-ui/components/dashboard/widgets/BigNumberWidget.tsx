"use client";
import type { WidgetRendererProps } from "./index";

/**
 * KPI tile. Renders a large value with a small label underneath, in the
 * Power BI / Tableau "score card" tradition. Optional `delta` and
 * `deltaLabel` show a colored change indicator (green for positive,
 * red for negative). The widget config is intentionally simple — bigger
 * trend visuals belong to the `query` widget with `chart_type='big_number'`.
 */
export default function BigNumberWidget({ config }: WidgetRendererProps) {
    const cfg = config as {
        value?: string | number;
        label?: string;
        delta?: number;
        deltaLabel?: string;
        prefix?: string;
        suffix?: string;
    };

    const raw = cfg.value;
    const display =
        typeof raw === "number"
            ? formatNumber(raw)
            : raw === undefined || raw === null || raw === ""
            ? "—"
            : String(raw);

    const delta = typeof cfg.delta === "number" ? cfg.delta : null;
    const isPositive = (delta ?? 0) >= 0;

    return (
        <div className="h-full flex flex-col justify-center items-start gap-1.5 px-1">
            {cfg.label && (
                <div className="text-[10px] text-(--text-muted) uppercase tracking-wider font-semibold truncate w-full">
                    {cfg.label}
                </div>
            )}
            <div
                className="text-4xl md:text-5xl font-bold text-(--text-primary) leading-none truncate w-full"
                style={{ fontFamily: "var(--font-heading)" }}
                title={String(raw ?? "")}
            >
                {cfg.prefix && <span className="text-(--text-muted) mr-1">{cfg.prefix}</span>}
                <span className="text-vanta-neon">{display}</span>
                {cfg.suffix && <span className="text-(--text-muted) text-2xl ml-1">{cfg.suffix}</span>}
            </div>
            {delta !== null && (
                <div
                    className={`inline-flex items-center gap-1 text-xs font-semibold ${
                        isPositive ? "text-emerald-400" : "text-rose-400"
                    }`}
                >
                    <span aria-hidden>{isPositive ? "▲" : "▼"}</span>
                    <span>{Math.abs(delta).toFixed(1)}%</span>
                    {cfg.deltaLabel && (
                        <span className="text-(--text-muted) font-normal ml-1">{cfg.deltaLabel}</span>
                    )}
                </div>
            )}
        </div>
    );
}

function formatNumber(n: number): string {
    const abs = Math.abs(n);
    if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (abs >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
