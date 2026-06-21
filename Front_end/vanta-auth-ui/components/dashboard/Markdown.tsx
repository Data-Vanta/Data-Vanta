"use client";
import dynamic from "next/dynamic";

/**
 * Shared markdown renderer used by ThinkingStream and dashboard markdown
 * widgets. react-markdown + remark-gfm are heavy (~80 KB minified);
 * lazy-loading keeps them out of the initial JS chunk for users who
 * never open thinking mode or a markdown widget.
 *
 * The actual ReactMarkdown render lives in MarkdownInner — which is
 * dynamically imported below, so the user's first paint has nothing
 * markdown-related in it. The two libraries get bundled into the same
 * chunk because they're imported in the same module.
 */

const baseClasses =
  "text-sm leading-relaxed " +
  "[&>*]:mb-2 " +
  "[&_h1]:text-lg [&_h1]:font-semibold [&_h1]:mt-3 " +
  "[&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 " +
  "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 " +
  "[&_strong]:font-semibold " +
  "[&_em]:italic " +
  "[&_del]:line-through [&_del]:opacity-70 " +
  "[&_code]:font-mono [&_code]:text-xs [&_code]:bg-black/30 [&_code]:px-1 [&_code]:rounded " +
  "[&_pre]:bg-black/30 [&_pre]:p-2 [&_pre]:rounded [&_pre_code]:bg-transparent [&_pre_code]:p-0 " +
  "[&_ul]:list-disc [&_ul]:ml-5 " +
  "[&_ol]:list-decimal [&_ol]:ml-5 " +
  "[&_li]:mb-1 " +
  "[&_a]:underline [&_a]:text-blue-400 " +
  "[&_blockquote]:border-l-2 [&_blockquote]:border-white/20 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:opacity-80 " +
  "[&_table]:w-full [&_table]:border [&_table]:border-white/10 [&_table]:text-xs " +
  "[&_th]:border [&_th]:border-white/10 [&_th]:px-2 [&_th]:py-1 [&_th]:bg-white/5 [&_th]:font-semibold [&_th]:text-left " +
  "[&_td]:border [&_td]:border-white/10 [&_td]:px-2 [&_td]:py-1";

type MarkdownProps = {
  children: string;
  className?: string;
};

// Dynamic import wraps both react-markdown and remark-gfm inside a single
// Webpack chunk. ssr:false because we're already inside "use client" and
// the markdown DOM is small enough that initial-paint hydration doesn't
// need to include it.
const MarkdownInner = dynamic(() => import("./MarkdownInner"), {
  ssr: false,
  // Tiny placeholder; lazy chunk lands in <100ms typically.
  loading: () => <div className="text-xs text-(--text-muted) italic">…</div>,
});

export default function Markdown({ children, className }: MarkdownProps) {
  const merged = className ? `${baseClasses} ${className}` : baseClasses;
  return (
    <div className={merged}>
      <MarkdownInner>{children}</MarkdownInner>
    </div>
  );
}
