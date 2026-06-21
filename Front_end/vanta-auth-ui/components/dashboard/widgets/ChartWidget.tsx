"use client";
import ChartRenderer from "@/components/charts/ChartRenderer";
import type { WidgetRendererProps } from "./index";

export default function ChartWidget({ config }: WidgetRendererProps) {
    const cfg = config as { chartSpec?: Record<string, unknown>; title?: string };
    return (
        <div className="h-full flex flex-col">
            {cfg.title && (
                <div className="text-sm font-semibold text-(--text-primary) mb-2">
                    {cfg.title}
                </div>
            )}
            <div className="flex-1 min-h-0">
                {cfg.chartSpec ? (
                    // ChartRenderer expects a chart spec shape identical to what the
                    // chat produces. Pinning serializes that shape into config.chartSpec.
                    <ChartRenderer chart={cfg.chartSpec as never} height="100%" />
                ) : (
                    <div className="text-xs text-(--text-muted) italic">
                        No chart data saved.
                    </div>
                )}
            </div>
        </div>
    );
}
