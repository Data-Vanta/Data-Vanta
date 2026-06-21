"use client";

import { useEffect, useRef, useState } from "react";
import { IconPlus, IconChevronDown } from "./Icons";
import ImportModal from "./ImportModal";
import NotificationBell from "./NotificationBell";
import { useTheme } from "@/lib/ThemeContext";
import { ThemeName } from "@/lib/themes";
import { useDashboard } from "./DashboardLayout";

interface HeaderProps {
    currentDataset?: { id: string; name: string } | null;
    onDatasetChange?: (dataset: { id: string; name: string }) => void;
}

// Local discriminated union for the dropdown options. The id prefix is
// stripped here — `onPick` adds the `local:` prefix when it builds the
// ChatAttachment, matching the convention enforced elsewhere (A7
// persistence loop checks `a.id.startsWith('local:')`).
type DatasetOption =
    | { kind: 'file'; id: string; name: string }
    | { kind: 'connector_table'; id: string; name: string };

// Theme icons component
const ThemeIcon = ({ theme }: { theme: string }) => {
    switch (theme) {
        case 'light':
            return (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="5" />
                    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
            );
        case 'dark':
            return (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
            );
        case 'blue':
            return (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
                </svg>
            );
        case 'gray':
            return (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l4 2" />
                </svg>
            );
        default:
            return (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                    <path d="M8 21h8M12 17v4" />
                </svg>
            );
    }
};

const themeOptions: { name: ThemeName; label: string }[] = [
    { name: 'light', label: 'Light' },
    { name: 'dark', label: 'Dark' },
    { name: 'blue', label: 'Blue' },
    { name: 'gray', label: 'Gray' },
    { name: 'system', label: 'System' },
];

export default function Header({ currentDataset, onDatasetChange }: HeaderProps) {
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
    const [isDatasetMenuOpen, setIsDatasetMenuOpen] = useState(false);
    const [datasetItems, setDatasetItems] = useState<DatasetOption[]>([]);
    const [datasetLoading, setDatasetLoading] = useState(false);
    const datasetSeqRef = useRef(0);
    const { theme, setTheme, resolvedTheme, mounted } = useTheme();
    const { addAttachment, setCurrentDataset } = useDashboard();

    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1";
    const chartApiUrl = process.env.NEXT_PUBLIC_CHART_API_URL || "http://127.0.0.1:8000";

    const handleImportSuccess = (file: { id: string; name: string }) => {
        onDatasetChange?.(file);
    };

    const handleThemeChange = (newTheme: ThemeName) => {
        setTheme(newTheme);
        setIsThemeMenuOpen(false);
    };

    const currentThemeLabel = themeOptions.find(t => t.name === theme)?.label || 'Theme';

    // Lazy-load files + connector tables when the dropdown opens. Each fetch
    // absorbs its own failure so one backend being down does not blank the
    // other section, mirroring the FilesPage pattern.
    useEffect(() => {
        if (!isDatasetMenuOpen) return;
        const seq = ++datasetSeqRef.current;
        let alive = true;
        // Loading flag flips when the dropdown opens — this is the canonical
        // "fire a fetch on mount/open" pattern, matching DashboardLayout's
        // own fetchUser() disable on this same lint rule.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDatasetLoading(true);
        const token = (typeof window !== "undefined" && localStorage.getItem("authToken")) || "";
        Promise.allSettled([
            fetch(`${apiUrl}/file/`, { headers: { "x-auth-token": token } })
                .then(r => (r.ok ? r.json() : { data: [] }))
                .catch(() => ({ data: [] })),
            fetch(`${chartApiUrl}/data/tables/default`, { headers: { "x-auth-token": token } })
                .then(r => (r.ok ? r.json() : { tables: [] }))
                .catch(() => ({ tables: [] })),
        ]).then(results => {
            if (!alive || datasetSeqRef.current !== seq) return;
            const fileJson = results[0].status === "fulfilled" ? results[0].value : { data: [] };
            const tableJson = results[1].status === "fulfilled" ? results[1].value : { tables: [] };
            const fileRows: Array<{ id: string; originalFilename: string }> = Array.isArray(fileJson?.data) ? fileJson.data : [];
            const tableRows: Array<{ table_name?: string; tableName?: string; name?: string }> =
                Array.isArray(tableJson?.tables) ? tableJson.tables : [];
            const opts: DatasetOption[] = [
                ...fileRows.map(f => ({
                    kind: "file" as const,
                    id: f.id,
                    name: f.originalFilename,
                })),
                ...tableRows
                    .map(t => t.table_name || t.tableName || t.name || "")
                    .filter(Boolean)
                    .map(name => ({
                        kind: "connector_table" as const,
                        id: `default.${name}`,
                        name,
                    })),
            ];
            setDatasetItems(opts);
        }).finally(() => {
            if (alive && datasetSeqRef.current === seq) setDatasetLoading(false);
        });
        return () => {
            alive = false;
        };
    }, [isDatasetMenuOpen, apiUrl, chartApiUrl]);

    const handleDatasetPick = (opt: DatasetOption) => {
        if (opt.kind === "file") {
            addAttachment({
                kind: "file",
                id: `local:${opt.id}`,
                fileId: opt.id,
                alias: opt.name,
                originalFilename: opt.name,
            });
            setCurrentDataset({
                id: opt.id,
                name: opt.name,
                source: "user-auth",
            });
        } else {
            const tableName = opt.name;
            addAttachment({
                kind: "connector_table",
                id: `local:${tableName}`,
                projectId: "default",
                tableName,
                alias: tableName,
            });
            setCurrentDataset({
                id: opt.id,
                name: tableName,
                projectId: "default",
                tableName,
                source: "lakehouse",
            });
        }
        setIsDatasetMenuOpen(false);
    };

    return (
        <>
            <header className="h-16 border-b border-(--border-secondary) bg-(--bg-primary)/80 backdrop-blur-md sticky top-0 z-40 flex items-center justify-between px-6">
                {/* Left: Title & Context */}
                <div className="flex items-center gap-4">
                    <h1 className="text-(--text-primary) font-bold text-lg tracking-wide" style={{ fontFamily: "var(--font-heading)" }}>
                        Chat Analytics
                    </h1>
                    <div className="h-4 w-px bg-(--border-primary)" />

                    {/* Dataset Selector */}
                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => setIsDatasetMenuOpen(o => !o)}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-(--bg-secondary) border border-(--border-primary) hover:border-(--border-hover) transition-colors group"
                            title={currentDataset?.name || "Select dataset"}
                        >
                            <span className={`w-2 h-2 rounded-full transition-colors ${currentDataset ? "bg-(--accent)" : "bg-(--text-muted) group-hover:bg-(--accent)"}`} />
                            <span className="text-xs font-medium text-(--text-muted) group-hover:text-(--text-primary) max-w-[200px] truncate">
                                {currentDataset?.name || "No dataset selected"}
                            </span>
                            <IconChevronDown className="w-3 h-3 text-(--text-muted)" />
                        </button>

                        {isDatasetMenuOpen && (
                            <>
                                {/* Backdrop — click-outside dismissal. */}
                                <div
                                    className="fixed inset-0 z-40"
                                    onClick={() => setIsDatasetMenuOpen(false)}
                                />

                                {/* Menu */}
                                <div className="absolute left-0 top-10 z-50 w-72 max-h-80 overflow-y-auto bg-(--bg-secondary) border border-(--border-primary) rounded-xl shadow-xl">
                                    {datasetLoading && (
                                        <div className="p-3 text-xs text-(--text-muted)">Loading…</div>
                                    )}
                                    {!datasetLoading && datasetItems.length === 0 && (
                                        <div className="p-3 text-xs text-(--text-muted)">No datasets yet.</div>
                                    )}
                                    {!datasetLoading && datasetItems.map(opt => (
                                        <button
                                            key={`${opt.kind}:${opt.id}`}
                                            type="button"
                                            onClick={() => handleDatasetPick(opt)}
                                            className="block w-full text-left px-3 py-2 text-sm text-(--text-secondary) hover:bg-(--bg-tertiary) hover:text-(--text-primary) transition-colors"
                                        >
                                            <span className="text-[10px] uppercase tracking-wide mr-2 opacity-60">
                                                {opt.kind === "file" ? "File" : "Table"}
                                            </span>
                                            <span className="truncate">{opt.name}</span>
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-3">
                    <NotificationBell />
                    {/* Theme Toggle */}
                    <div className="relative">
                        <button
                            onClick={() => setIsThemeMenuOpen(!isThemeMenuOpen)}
                            className="h-9 px-3 rounded-lg bg-(--bg-secondary) border border-(--border-primary) hover:border-(--accent) text-(--text-muted) hover:text-(--text-primary) transition-all flex items-center gap-2"
                            title="Change theme"
                            suppressHydrationWarning
                        >
                            {/* Until mount we render a neutral placeholder so the SSR HTML
                                and the first client render agree regardless of localStorage. */}
                            {mounted ? <ThemeIcon theme={resolvedTheme} /> : <span className="w-4 h-4" />}
                            <span className="text-xs font-medium hidden sm:inline" suppressHydrationWarning>
                                {mounted ? currentThemeLabel : "Theme"}
                            </span>
                            <IconChevronDown className="w-3 h-3" />
                        </button>

                        {/* Theme Dropdown */}
                        {isThemeMenuOpen && (
                            <>
                                {/* Backdrop */}
                                <div
                                    className="fixed inset-0 z-40"
                                    onClick={() => setIsThemeMenuOpen(false)}
                                />

                                {/* Menu */}
                                <div className="absolute right-0 top-12 z-50 w-40 bg-(--bg-secondary) border border-(--border-primary) rounded-xl shadow-xl overflow-hidden">
                                    {themeOptions.map((option) => (
                                        <button
                                            key={option.name}
                                            onClick={() => handleThemeChange(option.name)}
                                            className={`w-full px-4 py-2.5 flex items-center gap-3 text-left text-sm transition-colors ${theme === option.name
                                                    ? 'bg-(--accent-muted) text-(--accent)'
                                                    : 'text-(--text-secondary) hover:bg-(--bg-tertiary) hover:text-(--text-primary)'
                                                }`}
                                        >
                                            <ThemeIcon theme={option.name} />
                                            <span>{option.label}</span>
                                            {theme === option.name && (
                                                <svg className="ml-auto w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <polyline points="20 6 9 17 4 12" />
                                                </svg>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>

                    <button className="h-9 px-4 rounded-lg bg-(--bg-secondary) border border-(--border-primary) hover:border-(--border-hover) text-xs font-semibold text-(--text-primary) transition-colors">
                        Export
                    </button>
                    <button
                        onClick={() => setIsImportOpen(true)}
                        className="h-9 px-4 rounded-lg bg-(--accent) hover:bg-(--accent-hover) text-(--accent-text) text-xs font-bold transition-colors flex items-center gap-2 shadow-[0_0_10px_var(--accent-muted)]"
                    >
                        <IconPlus className="w-3.5 h-3.5" />
                        <span>Import Excel</span>
                    </button>
                </div>
            </header>

            <ImportModal
                isOpen={isImportOpen}
                onClose={() => setIsImportOpen(false)}
                onSuccess={handleImportSuccess}
            />
        </>
    );
}
