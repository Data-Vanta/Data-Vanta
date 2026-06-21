'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChartSpec } from '@/lib/chartTypes';
import { chartSpecToEChartsOption, isBigNumberChart } from '@/lib/chartAdapter';
import { CHART_COLORS } from '@/lib/chartTypes';

// Dynamic import for SSR compatibility
const ReactECharts = dynamic(() => import('echarts-for-react'), {
    ssr: false,
    loading: () => (
        <div className="h-64 flex items-center justify-center bg-[#111] rounded-xl">
            <div className="w-6 h-6 border-2 border-vanta-neon/30 border-t-vanta-neon rounded-full animate-spin" />
        </div>
    ),
});

interface ChartRendererProps {
    chart: ChartSpec;
    height?: number | string;
    className?: string;
    /**
     * Phase 13 — fired when the user clicks a chart point/bar/slice.
     * Lets parent dashboards build cross-filters (Power-BI-style: click
     * a category in one widget, filter every other widget).
     */
    onPointClick?: (event: { label: string | number; series?: string; value?: number }) => void;
}

/**
 * Unified chart renderer component using ECharts
 * Supports all chart types defined in chartTypes.ts
 */
export default function ChartRenderer({ chart, height = 280, className = '', onPointClick }: ChartRendererProps) {
    const chartType = chart.chart_type || chart.type || 'bar_chart';
    const labels = chart.data?.labels || [];
    const datasets = chart.data?.datasets || [];
    const primaryData = datasets[0]?.data || [];

    // E4: ResizeObserver-driven sizing. Charts re-flow correctly under window
    // resize and grid changes (F2's react-grid-layout will rely on this).
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [size, setSize] = useState({ w: 0, h: 0 });

    // G1: ECharts instance ref. We can't attach a React ref to the
    // next/dynamic-wrapped ReactECharts (refs aren't forwarded), so we capture
    // the instance via the documented `onChartReady` callback prop instead.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const echartsRef = useRef<any>(null);

    // G1: PNG download via echarts.getDataURL @ 2x for retina-quality export.
    const downloadPng = () => {
        const inst = echartsRef.current;
        if (!inst) return;
        const url = inst.getDataURL({ pixelRatio: 2, backgroundColor: '#0b0b0c' });
        const a = document.createElement('a');
        a.href = url;
        const safeName = (chart.title || 'chart').replace(/[^A-Za-z0-9_\-]+/g, '_');
        a.download = `${safeName}.png`;
        a.click();
    };

    // G1: CSV download stitched client-side from chart.data.labels + datasets.
    const downloadCsv = () => {
        const csvLabels = chart.data?.labels;
        const csvDatasets = chart.data?.datasets;
        if (!Array.isArray(csvLabels) || !Array.isArray(csvDatasets)) return;
        const headers = ['label', ...csvDatasets.map((d) => d.label || 'value')];
        const rows = csvLabels.map((lbl, i) => [
            lbl,
            ...csvDatasets.map((d) =>
                Array.isArray(d.data) ? (d.data[i] ?? '') : ''
            ),
        ]);
        const csv = [headers, ...rows]
            .map((r) =>
                r
                    .map((v) => `"${String(v).replace(/"/g, '""')}"`)
                    .join(',')
            )
            .join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeName = (chart.title || 'chart').replace(/[^A-Za-z0-9_\-]+/g, '_');
        a.download = `${safeName}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    useEffect(() => {
        if (!containerRef.current) return;
        const obs = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const cr = entry.contentRect;
                setSize({ w: cr.width, h: cr.height });
            }
        });
        obs.observe(containerRef.current);
        return () => obs.disconnect();
    }, []);

    // Generate ECharts option
    const option = useMemo(() => {
        try {
            const opt = chartSpecToEChartsOption(chart) as Record<string, unknown>;
            if (!opt) return opt;

            type SeriesLike = { data?: unknown } & Record<string, unknown>;
            const seriesArr: SeriesLike[] = Array.isArray(opt.series)
                ? (opt.series as SeriesLike[])
                : [];

            // Count total points across all series for sampling decisions
            const totalPoints = seriesArr.reduce(
                (acc: number, s: SeriesLike) =>
                    acc + (Array.isArray(s.data) ? s.data.length : 0),
                0
            );

            // Apply LTTB sampling, large mode, and dataZoom for big series.
            // Only when an xAxis exists — pie/radar charts pass through.
            const hasXAxis = !!opt.xAxis;
            if (totalPoints > 2000 && hasXAxis) {
                opt.series = seriesArr.map((s) => ({
                    ...s,
                    sampling: 'lttb',
                    large: true,
                    progressive: 5000,
                }));
                opt.dataZoom = [
                    { type: 'inside', xAxisIndex: 0 },
                    { type: 'slider', xAxisIndex: 0, height: 18 },
                ];
            }

            // Defense-in-depth: hard-truncate huge series client-side
            if (totalPoints > 50000) {
                const truncated = (Array.isArray(opt.series)
                    ? (opt.series as SeriesLike[])
                    : seriesArr
                ).map((s) => ({
                    ...s,
                    data: Array.isArray(s.data) ? s.data.slice(0, 50000) : s.data,
                }));
                opt.series = truncated;
            }

            return opt;
        } catch (error) {
            console.error('[ChartRenderer] Failed to generate chart option:', error);
            return null;
        }
    }, [chart]);

    // Handle Big Number chart types specially
    if (isBigNumberChart(chartType)) {
        return (
            <BigNumberChart
                value={primaryData[0]}
                change={primaryData[1]}
                label={labels[0]}
                showTrendline={chartType === 'big_number_with_trendline'}
                data={primaryData}
                className={className}
            />
        );
    }

    // Fallback if no data
    if (labels.length === 0 && primaryData.length === 0) {
        return (
            <div className={`bg-[#111] border border-[#222] rounded-xl p-6 ${className}`}>
                <div className="flex flex-col items-center justify-center text-[#666] h-40">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-2">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <path d="M7 17l4-4 4 4" />
                        <path d="M12 9l4-4" />
                    </svg>
                    <span className="text-sm">No data available</span>
                </div>
            </div>
        );
    }

    // Fallback if option generation failed
    if (!option) {
        return <FallbackChart labels={labels} data={primaryData} className={className} />;
    }

    // TODO: declare meta on chart type once E2 lands
    const chartMeta = (chart as unknown as { meta?: { capped?: boolean } }).meta;
    const isCapped = !!chartMeta?.capped;

    // Sizing strategy:
    //   - numeric `height` (e.g. chat page passes 300) -> fixed pixel height.
    //   - string "100%" or no height (dashboard widgets) -> fill parent via
    //     h-full so the chart card stretches to the rgl cell. Percentage
    //     heights via `style.height` only resolve when the parent has a
    //     defined height; chained flex containers don't always satisfy that
    //     in older browsers, so we use Tailwind's h-full class for safety.
    const isFixedHeight = typeof height === 'number';
    const cardStyle: React.CSSProperties | undefined = isFixedHeight
        ? { height: `${height}px` }
        : undefined;
    const cardHeightClass = isFixedHeight ? "" : "h-full w-full";
    return (
        <div
            className={`bg-[#111] border border-[#222] rounded-xl overflow-hidden group/chart relative flex flex-col ${cardHeightClass} ${className}`}
            style={cardStyle}
        >
            <div className="flex justify-between items-center px-4 py-3 border-b border-[#1a1a1a] shrink-0">
                <h4 className="text-white font-medium text-sm truncate">{chart.title || chartType}</h4>
                <span className="px-2 py-1 rounded-md bg-[#1a1a1a] text-[#888] text-xs shrink-0">{chartType}</span>
            </div>
            {isCapped && (
                <div className="text-xs text-amber-500 px-4 pt-2 shrink-0">
                    Showing the first 50 000 rows. Download for the full dataset.
                </div>
            )}
            {/* G1: Hover-only Download toolbar. Absolutely positioned so it
                does not affect E4's ResizeObserver measurement on containerRef. */}
            <div className="absolute right-2 top-12 z-10 flex gap-1 opacity-0 group-hover/chart:opacity-100 transition-opacity">
                <button
                    type="button"
                    onClick={downloadPng}
                    title="Download PNG"
                    className="rounded bg-black/40 px-2 py-0.5 text-xs text-white hover:bg-black/60"
                >
                    PNG
                </button>
                <button
                    type="button"
                    onClick={downloadCsv}
                    title="Download CSV"
                    className="rounded bg-black/40 px-2 py-0.5 text-xs text-white hover:bg-black/60"
                >
                    CSV
                </button>
            </div>
            <div ref={containerRef} className="w-full flex-1 min-h-0">
                {size.w > 0 && size.h > 0 && (
                    <ReactECharts
                        onChartReady={(inst) => {
                            echartsRef.current = inst;
                        }}
                        onEvents={onPointClick ? {
                            click: (params: Record<string, unknown>) => {
                                const name = params.name as string | number | undefined;
                                if (name === undefined || name === null || name === "") return;
                                onPointClick({
                                    label: name,
                                    series: typeof params.seriesName === "string" ? params.seriesName : undefined,
                                    value: typeof params.value === "number" ? params.value : undefined,
                                });
                            },
                        } : undefined}
                        option={option}
                        opts={{ renderer: 'canvas', width: size.w, height: size.h }}
                        notMerge
                        lazyUpdate
                    />
                )}
            </div>
        </div>
    );
}

/**
 * Big Number display component
 */
function BigNumberChart({
    value,
    change,
    label,
    showTrendline,
    data,
    className,
}: {
    value?: number;
    change?: number;
    label?: string;
    showTrendline?: boolean;
    data: number[];
    className?: string;
}) {
    const displayValue = typeof value === 'number' ? value.toLocaleString() : label || 'N/A';
    const changeValue = typeof change === 'number' ? change : 0;
    const isPositive = changeValue >= 0;

    return (
        <div className={`bg-[#111] border border-[#222] rounded-xl p-6 ${className}`}>
            <div className="text-center">
                <div className="text-4xl font-bold text-vanta-neon mb-2">{displayValue}</div>
                {typeof change === 'number' && (
                    <div className={`text-sm ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                        {isPositive ? '↑' : '↓'} {Math.abs(changeValue).toFixed(1)}%
                    </div>
                )}
                {showTrendline && data.length > 1 && (
                    <div className="mt-4 h-12">
                        <MiniTrendline data={data} />
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * Mini trendline SVG for big number with trendline
 */
function MiniTrendline({ data }: { data: number[] }) {
    if (data.length < 2) return null;

    const maxVal = Math.max(...data, 1);
    const minVal = Math.min(...data, 0);
    const range = maxVal - minVal || 1;
    const width = 100;
    const height = 40;

    const points = data.map((val, idx) => {
        const x = (idx / (data.length - 1)) * width;
        const y = height - ((val - minVal) / range) * height;
        return `${x},${y}`;
    }).join(' ');

    return (
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full">
            <polyline
                points={points}
                fill="none"
                stroke="#BCFF3C"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

/**
 * Fallback chart when ECharts fails
 */
function FallbackChart({
    labels,
    data,
    className,
}: {
    labels: string[];
    data: number[];
    className?: string;
}) {
    const maxValue = Math.max(...data, 1);

    return (
        <div className={`bg-[#111] border border-[#222] rounded-xl p-4 ${className}`}>
            <div className="flex justify-between items-center mb-4">
                <h4 className="text-white font-medium text-sm">Chart</h4>
                <span className="px-2 py-1 rounded-md bg-yellow-500/20 text-yellow-400 text-xs">Fallback</span>
            </div>
            <div className="space-y-2">
                {labels.slice(0, 10).map((label, idx) => {
                    const val = data[idx] ?? 0;
                    return (
                        <div key={`${idx}-${label}`} className="flex items-center gap-3">
                            <div className="w-20 text-xs text-[#888] truncate">{label}</div>
                            <div className="flex-1 h-5 bg-[#1a1a1a] rounded overflow-hidden">
                                <div
                                    className="h-full rounded transition-all duration-300"
                                    style={{
                                        width: `${Math.min(100, (val / maxValue) * 100)}%`,
                                        backgroundColor: CHART_COLORS[idx % CHART_COLORS.length],
                                    }}
                                />
                            </div>
                            <div className="w-16 text-xs text-white text-right">{val.toLocaleString()}</div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
