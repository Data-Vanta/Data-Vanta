"use client";
import Markdown from "@/components/dashboard/Markdown";
import type { WidgetRendererProps } from "./index";

export default function MarkdownWidget({ config }: WidgetRendererProps) {
    const content = String((config as { content?: string })?.content || "");
    return (
        <div className="p-3 overflow-auto h-full text-(--text-primary)">
            <Markdown>{content}</Markdown>
        </div>
    );
}
