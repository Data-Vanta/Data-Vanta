"use client";

/**
 * Theme System - Theme Definitions
 * 
 * This file contains all theme configurations for the Vanta dashboard.
 * Each theme defines semantic color tokens that are applied as CSS variables.
 */

export type ThemeName = 'light' | 'dark' | 'blue' | 'gray' | 'system';

export interface AccentColor {
    name: string;
    color: string;
    hover: string;
    muted: string;
}

// Preset accent colors for the color palette picker
export const accentColors: AccentColor[] = [
    { name: 'Neon Green', color: '#BCFF3C', hover: '#a6e828', muted: 'rgba(188, 255, 60, 0.15)' },
    { name: 'Electric Blue', color: '#3B82F6', hover: '#2563eb', muted: 'rgba(59, 130, 246, 0.15)' },
    { name: 'Purple', color: '#A855F7', hover: '#9333ea', muted: 'rgba(168, 85, 247, 0.15)' },
    { name: 'Pink', color: '#EC4899', hover: '#db2777', muted: 'rgba(236, 72, 153, 0.15)' },
    { name: 'Red', color: '#EF4444', hover: '#dc2626', muted: 'rgba(239, 68, 68, 0.15)' },
    { name: 'Orange', color: '#F97316', hover: '#ea580c', muted: 'rgba(249, 115, 22, 0.15)' },
    { name: 'Yellow', color: '#EAB308', hover: '#ca8a04', muted: 'rgba(234, 179, 8, 0.15)' },
    { name: 'Teal', color: '#14B8A6', hover: '#0d9488', muted: 'rgba(20, 184, 166, 0.15)' },
    { name: 'Cyan', color: '#06B6D4', hover: '#0891b2', muted: 'rgba(6, 182, 212, 0.15)' },
    { name: 'Rose', color: '#F43F5E', hover: '#e11d48', muted: 'rgba(244, 63, 94, 0.15)' },
    { name: 'Indigo', color: '#6366F1', hover: '#4f46e5', muted: 'rgba(99, 102, 241, 0.15)' },
    { name: 'Emerald', color: '#10B981', hover: '#059669', muted: 'rgba(16, 185, 129, 0.15)' },
];

export interface ThemeColors {
    // Backgrounds
    bgPrimary: string;      // Main background
    bgSecondary: string;    // Cards, sidebar, modals
    bgTertiary: string;     // Inputs, elevated surfaces
    bgHover: string;        // Hover states

    // Text
    textPrimary: string;    // Main text
    textSecondary: string;  // Muted text
    textMuted: string;      // Disabled/placeholder

    // Borders
    borderPrimary: string;
    borderSecondary: string;
    borderHover: string;

    // Accent (customizable)
    accent: string;
    accentHover: string;
    accentText: string;     // Text on accent bg
    accentMuted: string;    // Accent at lower opacity

    // Semantic
    success: string;
    successBg: string;
    warning: string;
    warningBg: string;
    error: string;
    errorBg: string;

    // Special
    backdrop: string;       // Modal backdrop
    scrollbar: string;      // Scrollbar color
}

export interface Theme {
    name: ThemeName;
    label: string;
    colors: ThemeColors;
}

// Default accent color
export const DEFAULT_ACCENT = accentColors[0]; // Neon Green

// Helper to get accent text color (should be dark for light accents, light for dark accents)
function getAccentTextColor(accentColor: string): string {
    // Simple luminance check - if accent is bright, use dark text
    const hex = accentColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? '#000000' : '#ffffff';
}

// Create base themes without accent (accent is applied dynamically)
const createTheme = (
    name: Exclude<ThemeName, 'system'>,
    label: string,
    baseColors: Omit<ThemeColors, 'accent' | 'accentHover' | 'accentText' | 'accentMuted'>
): Theme => ({
    name,
    label,
    colors: {
        ...baseColors,
        // Default accent - will be overridden dynamically
        accent: DEFAULT_ACCENT.color,
        accentHover: DEFAULT_ACCENT.hover,
        accentText: getAccentTextColor(DEFAULT_ACCENT.color),
        accentMuted: DEFAULT_ACCENT.muted,
    },
});

export const themes: Record<Exclude<ThemeName, 'system'>, Theme> = {
    light: createTheme('light', 'Light', {
        bgPrimary: '#ffffff',
        bgSecondary: '#f8f9fa',
        bgTertiary: '#f0f2f5',
        bgHover: '#e9ecef',

        textPrimary: '#111111',
        textSecondary: '#555555',
        textMuted: '#888888',

        borderPrimary: '#e0e0e0',
        borderSecondary: '#eeeeee',
        borderHover: '#cccccc',

        success: '#22c55e',
        successBg: 'rgba(34, 197, 94, 0.1)',
        warning: '#f59e0b',
        warningBg: 'rgba(245, 158, 11, 0.1)',
        error: '#ef4444',
        errorBg: 'rgba(239, 68, 68, 0.1)',

        backdrop: 'rgba(0, 0, 0, 0.5)',
        scrollbar: '#cccccc',
    }),

    dark: createTheme('dark', 'Dark', {
        bgPrimary: '#010101',
        bgSecondary: '#111111',
        bgTertiary: '#1a1a1a',
        bgHover: '#222222',

        textPrimary: '#ffffff',
        textSecondary: '#cccccc',
        textMuted: '#666666',

        borderPrimary: '#222222',
        borderSecondary: '#1f1f1f',
        borderHover: '#333333',

        success: '#22c55e',
        successBg: 'rgba(34, 197, 94, 0.15)',
        warning: '#f59e0b',
        warningBg: 'rgba(245, 158, 11, 0.15)',
        error: '#ef4444',
        errorBg: 'rgba(239, 68, 68, 0.15)',

        backdrop: 'rgba(0, 0, 0, 0.7)',
        scrollbar: '#333333',
    }),

    blue: createTheme('blue', 'Blue', {
        bgPrimary: '#0a1628',
        bgSecondary: '#0f1f35',
        bgTertiary: '#152842',
        bgHover: '#1c3454',

        textPrimary: '#e8f1ff',
        textSecondary: '#a8c5e8',
        textMuted: '#5a7a9e',

        borderPrimary: '#1e3a5f',
        borderSecondary: '#162d4a',
        borderHover: '#2a4a72',

        success: '#34d399',
        successBg: 'rgba(52, 211, 153, 0.15)',
        warning: '#fbbf24',
        warningBg: 'rgba(251, 191, 36, 0.15)',
        error: '#f87171',
        errorBg: 'rgba(248, 113, 113, 0.15)',

        backdrop: 'rgba(5, 10, 20, 0.8)',
        scrollbar: '#2a4a72',
    }),

    gray: createTheme('gray', 'Gray', {
        bgPrimary: '#18181b',
        bgSecondary: '#27272a',
        bgTertiary: '#3f3f46',
        bgHover: '#52525b',

        textPrimary: '#fafafa',
        textSecondary: '#a1a1aa',
        textMuted: '#71717a',

        borderPrimary: '#3f3f46',
        borderSecondary: '#27272a',
        borderHover: '#52525b',

        success: '#4ade80',
        successBg: 'rgba(74, 222, 128, 0.15)',
        warning: '#facc15',
        warningBg: 'rgba(250, 204, 21, 0.15)',
        error: '#f87171',
        errorBg: 'rgba(248, 113, 113, 0.15)',

        backdrop: 'rgba(0, 0, 0, 0.7)',
        scrollbar: '#52525b',
    }),
};

/**
 * Get CSS variable declarations for a theme with custom accent
 */
export function getThemeCSSVariables(theme: Theme, customAccent?: AccentColor): Record<string, string> {
    const { colors } = theme;
    const accent = customAccent || DEFAULT_ACCENT;
    const accentText = getAccentTextColor(accent.color);

    return {
        '--bg-primary': colors.bgPrimary,
        '--bg-secondary': colors.bgSecondary,
        '--bg-tertiary': colors.bgTertiary,
        '--bg-hover': colors.bgHover,

        '--text-primary': colors.textPrimary,
        '--text-secondary': colors.textSecondary,
        '--text-muted': colors.textMuted,

        '--border-primary': colors.borderPrimary,
        '--border-secondary': colors.borderSecondary,
        '--border-hover': colors.borderHover,

        '--accent': accent.color,
        '--accent-hover': accent.hover,
        '--accent-text': accentText,
        '--accent-muted': accent.muted,

        '--success': colors.success,
        '--success-bg': colors.successBg,
        '--warning': colors.warning,
        '--warning-bg': colors.warningBg,
        '--error': colors.error,
        '--error-bg': colors.errorBg,

        '--backdrop': colors.backdrop,
        '--scrollbar': colors.scrollbar,
    };
}

/**
 * Theme preview colors for the selector UI
 */
export function getThemePreviewColors(themeName: Exclude<ThemeName, 'system'>) {
    const theme = themes[themeName];
    return {
        bg: theme.colors.bgPrimary,
        surface: theme.colors.bgSecondary,
        text: theme.colors.textPrimary,
        accent: theme.colors.accent,
    };
}
