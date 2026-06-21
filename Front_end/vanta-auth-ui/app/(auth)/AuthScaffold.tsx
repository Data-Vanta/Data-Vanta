import Link from "next/link";
import type { ReactNode } from "react";
import ThemeToggle from "@/components/landing/ThemeToggle";

/**
 * Shared chrome for every auth page (login, signup, forgot, reset, verify).
 * Matches the landing aesthetic: dark gradient, ambient neon glow, centered
 * card, theme-aware — works identically in light and dark themes.
 */
export default function AuthScaffold({
  heroTitle,
  heroText,
  children,
}: {
  heroTitle: string;
  heroText: string;
  children: ReactNode;
}) {
  return (
    <div
      className="min-h-screen relative overflow-hidden bg-(--bg-primary) text-(--text-primary)"
      style={{ fontFamily: "var(--font-body)" }}
    >
      {/* Ambient gradient */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 70% 45% at 50% -5%, rgba(188,255,60,0.15), transparent 60%), radial-gradient(ellipse 50% 30% at 80% 80%, rgba(188,255,60,0.08), transparent 60%)",
        }}
      />
      {/* Subtle grid */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.035] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(ellipse at center, black 40%, transparent 75%)",
        }}
      />

      {/* NAV */}
      <header className="relative z-20">
        <div className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
            <span className="w-7 h-7 rounded-md bg-vanta-neon text-black flex items-center justify-center font-black text-sm">
              V
            </span>
            <span className="text-lg">Vanta</span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              href="/"
              className="text-sm text-(--text-secondary) hover:text-(--text-primary) transition-colors px-3 py-1.5 rounded-lg hover:bg-(--bg-hover) hidden sm:inline-flex"
            >
              ← Back to home
            </Link>
          </div>
        </div>
      </header>

      {/* MAIN */}
      <main className="relative z-10 px-6 pb-16">
        <div className="mx-auto max-w-6xl pt-8 md:pt-16 grid lg:grid-cols-5 gap-10 lg:gap-16 items-center">
          {/* Hero copy — left on desktop, top on mobile */}
          <section className="lg:col-span-2 max-w-md">
            <div className="inline-flex items-center gap-2 rounded-full border border-vanta-neon/30 bg-vanta-neon/5 px-3 py-1 text-xs font-medium text-vanta-neon mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-vanta-neon animate-pulse" />
              Vanta · Chat with your data
            </div>
            <h1
              className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight leading-[1.1] mb-4"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {heroTitle}
            </h1>
            <p className="text-(--text-muted) text-base md:text-lg leading-relaxed">
              {heroText}
            </p>

            {/* Social proof strip */}
            <div className="mt-8 pt-6 border-t border-(--border-secondary)">
              <p className="text-[11px] uppercase tracking-[0.2em] text-(--text-muted) mb-3">
                Works with
              </p>
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-(--text-muted)">
                {["CSV", "Excel", "Postgres", "MySQL", "BigQuery", "Snowflake", "MongoDB"].map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
            </div>
          </section>

          {/* Form card — right */}
          <section className="lg:col-span-3 flex justify-center lg:justify-end">
            <div className="relative w-full max-w-md">
              {/* Card glow */}
              <div
                aria-hidden
                className="absolute -inset-1 rounded-3xl blur-2xl opacity-40 pointer-events-none"
                style={{
                  background:
                    "radial-gradient(circle at 30% 0%, rgba(188,255,60,0.25), transparent 60%)",
                }}
              />
              <div className="relative rounded-3xl border border-(--border-primary) bg-(--bg-secondary)/80 backdrop-blur-xl p-7 md:p-9 shadow-2xl">
                {children}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
