"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { ThemeName, themes, getThemeCSSVariables, Theme, AccentColor, accentColors, DEFAULT_ACCENT } from './themes';

const THEME_STORAGE_KEY = 'vanta-theme';
const ACCENT_STORAGE_KEY = 'vanta-accent';

interface ThemeContextType {
    theme: ThemeName;
    setTheme: (theme: ThemeName) => void;
    resolvedTheme: Exclude<ThemeName, 'system'>;
    accentColor: AccentColor;
    setAccentColor: (accent: AccentColor) => void;
    /**
     * False on the server and during the first client render; true after
     * the component has mounted in the browser. Use this to gate any
     * rendering that depends on the persisted theme to avoid hydration
     * mismatches.
     */
    mounted: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * Get the resolved theme based on system preference
 */
function getSystemTheme(): 'light' | 'dark' {
    if (typeof window === 'undefined') return 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Apply theme CSS variables to document root
 */
function applyTheme(themeName: Exclude<ThemeName, 'system'>, accent: AccentColor) {
    if (typeof document === 'undefined') return;

    const theme = themes[themeName];
    const variables = getThemeCSSVariables(theme, accent);

    const root = document.documentElement;
    Object.entries(variables).forEach(([key, value]) => {
        root.style.setProperty(key, value);
    });

    // Set data attribute for potential CSS selectors
    root.setAttribute('data-theme', themeName);
}

interface ThemeProviderProps {
    children: React.ReactNode;
    defaultTheme?: ThemeName;
}

function readStoredTheme(defaultTheme: ThemeName): ThemeName {
    if (typeof window === 'undefined') return defaultTheme;
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'blue' || stored === 'gray' || stored === 'system') {
        return stored;
    }
    return defaultTheme;
}

function readStoredAccent(): AccentColor {
    if (typeof window === 'undefined') return DEFAULT_ACCENT;
    const raw = localStorage.getItem(ACCENT_STORAGE_KEY);
    if (!raw) return DEFAULT_ACCENT;
    try {
        const parsed = JSON.parse(raw) as AccentColor;
        if (parsed?.color && parsed?.hover && parsed?.muted) return parsed;
    } catch {
        // fall through
    }
    return DEFAULT_ACCENT;
}

export function ThemeProvider({ children, defaultTheme = 'dark' }: ThemeProviderProps) {
    // Lazy initializers avoid setState-in-effect on mount
    const [theme, setThemeState] = useState<ThemeName>(() => readStoredTheme(defaultTheme));
    const [accentColor, setAccentColorState] = useState<AccentColor>(() => readStoredAccent());
    // Tracks OS theme so that `resolvedTheme` updates (and consumers re-render)
    // when the user flips their OS appearance while `theme === 'system'`.
    const [osTheme, setOsTheme] = useState<'light' | 'dark'>(() => getSystemTheme());
    // Hydration guard — stays false during SSR + first client render. The
    // `mounted=true` flip is intentional (the whole point is to signal we've
    // passed hydration); the lint rule's warning is a false positive here.
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMounted(true);
    }, []);

    // Derived, not stored — eliminates a redundant setState effect
    const resolvedTheme: Exclude<ThemeName, 'system'> = theme === 'system' ? osTheme : theme;

    // Apply CSS variables to document root whenever the resolved theme or accent changes
    useEffect(() => {
        applyTheme(resolvedTheme, accentColor);
    }, [resolvedTheme, accentColor]);

    // Listen for OS theme changes; keeps `osTheme` state in sync so that
    // components reading `resolvedTheme` under `theme === 'system'` re-render.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = (e: MediaQueryListEvent) => {
            setOsTheme(e.matches ? 'dark' : 'light');
        };
        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, []);

    const setTheme = useCallback((newTheme: ThemeName) => {
        setThemeState(newTheme);
        localStorage.setItem(THEME_STORAGE_KEY, newTheme);
    }, []);

    const setAccentColor = useCallback((newAccent: AccentColor) => {
        setAccentColorState(newAccent);
        localStorage.setItem(ACCENT_STORAGE_KEY, JSON.stringify(newAccent));
        // Apply immediately
        const resolved = theme === 'system' ? getSystemTheme() : theme;
        applyTheme(resolved, newAccent);
    }, [theme]);

    const value: ThemeContextType = {
        theme,
        setTheme,
        resolvedTheme,
        accentColor,
        setAccentColor,
        mounted,
    };

    return (
        <ThemeContext.Provider value={value}>
            {children}
        </ThemeContext.Provider>
    );
}

/**
 * Hook to access theme context
 */
export function useTheme() {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}

/**
 * Get current theme object
 */
export function useThemeObject(): Theme {
    const { resolvedTheme } = useTheme();
    return themes[resolvedTheme];
}

/**
 * Export accent colors for use in components
 */
export { accentColors };
