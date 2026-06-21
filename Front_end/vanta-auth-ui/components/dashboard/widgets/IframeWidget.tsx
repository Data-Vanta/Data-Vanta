"use client";
import type { WidgetRendererProps } from "./index";

export default function IframeWidget({ config }: WidgetRendererProps) {
    const url = String((config as { url?: string })?.url || "");
    if (!url) {
        return (
            <div className="p-3 text-sm text-(--text-muted) italic">
                Configure a url to embed.
            </div>
        );
    }
    return (
        <iframe
            src={url}
            sandbox="allow-scripts allow-same-origin"
            className="w-full h-full border-0"
            title="Embedded content"
        />
    );
}
