"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Inner component that owns the actual react-markdown + remark-gfm
 * imports. Loaded lazily by Markdown.tsx via next/dynamic so neither
 * library lands in the initial JS bundle.
 */
export default function MarkdownInner({ children }: { children: string }) {
    return <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>;
}
