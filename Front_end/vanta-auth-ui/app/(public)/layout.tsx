import type { ReactNode } from "react";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-screen bg-(--bg-primary) text-(--text-primary)"
      style={{ fontFamily: "var(--font-body)" }}
    >
      {children}
    </div>
  );
}
