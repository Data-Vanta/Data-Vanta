"use client";
import { useTheme } from "@/lib/ThemeContext";

/**
 * Compact theme toggle for the landing page nav.
 * Cycles: dark → light → system → dark ...
 * Renders a neutral placeholder until mount so SSR and hydration match.
 */
export default function ThemeToggle() {
    const { theme, setTheme, resolvedTheme, mounted } = useTheme();

    const next = () => {
        if (theme === "dark") setTheme("light");
        else if (theme === "light") setTheme("system");
        else setTheme("dark");
    };

    const label =
        theme === "system" ? "System" : theme === "light" ? "Light" : "Dark";

    return (
        <button
            onClick={next}
            title={`Theme: ${label} (click to cycle)`}
            aria-label="Toggle theme"
            className="relative h-9 w-9 rounded-lg border border-(--border-primary) hover:border-vanta-neon/50 bg-(--bg-secondary) hover:bg-(--bg-hover) transition-all flex items-center justify-center text-(--text-secondary) hover:text-(--text-primary)"
            suppressHydrationWarning
        >
            {mounted ? (
                resolvedTheme === "dark" ? (
                    <SunIcon />
                ) : (
                    <MoonIcon />
                )
            ) : (
                <span className="w-4 h-4" />
            )}
        </button>
    );
}

function SunIcon() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
    );
}

function MoonIcon() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
    );
}
