"use client";

import { useState, useEffect, useCallback } from "react";
import { useDashboard } from "./DashboardLayout";
import { useTheme, accentColors } from "@/lib/ThemeContext";
import { ThemeName, themes, AccentColor } from "@/lib/themes";
import MemoryEditor from "./MemoryEditor";

interface User {
    id: string;
    name?: string;
    email: string;
    role?: string;
}

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    user: User | null;
}

const themeOptions: { name: ThemeName; label: string; icon: string; description: string }[] = [
    { name: 'light', label: 'Light', icon: '☀️', description: 'Clean & bright' },
    { name: 'dark', label: 'Dark', icon: '🌙', description: 'Easy on the eyes' },
    { name: 'blue', label: 'Blue', icon: '🌊', description: 'Deep & professional' },
    { name: 'gray', label: 'Gray', icon: '🌫️', description: 'Neutral & modern' },
    { name: 'system', label: 'System', icon: '💻', description: 'Match your OS' },
];

export default function SettingsModal({ isOpen, onClose, user }: SettingsModalProps) {
    const { refreshUser } = useDashboard();
    const { theme, setTheme, accentColor, setAccentColor } = useTheme();
    const [name, setName] = useState("");
    const [company, setCompany] = useState("");
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [activeTab, setActiveTab] = useState<"profile" | "password" | "appearance" | "memory">("profile");

    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1";

    const loadProfile = useCallback(async () => {
        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${apiUrl}/profile/me`, {
                headers: { "x-auth-token": token }
            });
            if (res.ok) {
                const json = await res.json();
                const profile = json.data;
                if (profile) {
                    setName(profile.jobTitle || user?.name || "");
                    setCompany(profile.company || "");
                }
            }
        } catch (error) {
            console.error("Error loading profile:", error);
            if (user?.name) setName(user.name);
        }
    }, [apiUrl, user?.name]);

    // Load existing profile data when modal opens
    useEffect(() => {
        if (isOpen && user?.id) {
            loadProfile();
        }
    }, [isOpen, user?.id, loadProfile]);

    const handleProfileUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user?.id) return;

        setLoading(true);
        setMessage(null);

        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${apiUrl}/profile/${user.id}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-auth-token": token,
                },
                body: JSON.stringify({
                    jobTitle: name || undefined,
                    company: company || undefined
                }),
            });

            const json = await res.json();

            if (!res.ok) {
                throw new Error(json.message || json.error || "Update failed");
            }

            setMessage({ type: "success", text: "Profile updated successfully" });
            await refreshUser();
        } catch (err) {
            setMessage({ type: "error", text: err instanceof Error ? err.message : "Update failed" });
        } finally {
            setLoading(false);
        }
    };

    const handlePasswordChange = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user?.id) return;

        if (newPassword.length < 8) {
            setMessage({ type: "error", text: "New password must be at least 8 characters" });
            return;
        }

        setLoading(true);
        setMessage(null);

        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${apiUrl}/profile/${user.id}/password`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    "x-auth-token": token,
                },
                body: JSON.stringify({
                    currentPassword,
                    newPassword
                }),
            });

            const json = await res.json();

            if (!res.ok) {
                throw new Error(json.message || "Password change failed");
            }

            setMessage({ type: "success", text: "Password changed successfully" });
            setCurrentPassword("");
            setNewPassword("");
        } catch (err) {
            setMessage({ type: "error", text: err instanceof Error ? err.message : "Password change failed" });
        } finally {
            setLoading(false);
        }
    };

    const handleThemeChange = (themeName: ThemeName) => {
        setTheme(themeName);
    };

    const handleAccentChange = (accent: AccentColor) => {
        setAccentColor(accent);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-100 flex items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-(--backdrop) backdrop-blur-sm" onClick={onClose} />

            {/* Modal */}
            <div className="relative bg-(--bg-secondary) border border-(--border-primary) rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-(--border-primary)">
                    <h2 className="text-xl font-semibold text-(--text-primary)" style={{ fontFamily: "var(--font-heading)" }}>
                        Settings
                    </h2>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-lg bg-(--bg-tertiary) hover:bg-(--bg-hover) flex items-center justify-center text-(--text-muted) hover:text-(--text-primary) transition-colors"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-(--border-primary)">
                    <button
                        onClick={() => setActiveTab("profile")}
                        className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${activeTab === "profile"
                            ? "text-(--accent) border-b-2 border-(--accent)"
                            : "text-(--text-muted) hover:text-(--text-primary)"
                            }`}
                    >
                        Profile
                    </button>
                    <button
                        onClick={() => setActiveTab("password")}
                        className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${activeTab === "password"
                            ? "text-(--accent) border-b-2 border-(--accent)"
                            : "text-(--text-muted) hover:text-(--text-primary)"
                            }`}
                    >
                        Password
                    </button>
                    <button
                        onClick={() => setActiveTab("appearance")}
                        className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${activeTab === "appearance"
                            ? "text-(--accent) border-b-2 border-(--accent)"
                            : "text-(--text-muted) hover:text-(--text-primary)"
                            }`}
                    >
                        Appearance
                    </button>
                    <button
                        onClick={() => setActiveTab("memory")}
                        className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${activeTab === "memory"
                            ? "text-(--accent) border-b-2 border-(--accent)"
                            : "text-(--text-muted) hover:text-(--text-primary)"
                            }`}
                    >
                        Memory
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto max-h-[60vh]">
                    {message && (
                        <div className={`mb-4 p-3 rounded-lg text-sm ${message.type === "success"
                            ? "bg-(--success-bg) border border-(--success)/20 text-(--success)"
                            : "bg-(--error-bg) border border-(--error)/20 text-(--error)"
                            }`}>
                            {message.text}
                        </div>
                    )}

                    {activeTab === "profile" ? (
                        <form onSubmit={handleProfileUpdate} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-(--text-muted) mb-2">Email</label>
                                <input
                                    type="email"
                                    value={user?.email || ""}
                                    disabled
                                    className="w-full h-11 px-4 rounded-xl bg-(--bg-tertiary) border border-(--border-primary) text-(--text-muted) cursor-not-allowed"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-(--text-muted) mb-2">Job Title</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="Enter your job title"
                                    className="w-full h-11 px-4 rounded-xl bg-(--bg-tertiary) border border-(--border-primary) text-(--text-primary) focus:outline-none focus:border-(--accent) transition-colors placeholder:text-(--text-muted)"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-(--text-muted) mb-2">Company</label>
                                <input
                                    type="text"
                                    value={company}
                                    onChange={(e) => setCompany(e.target.value)}
                                    placeholder="Enter your company name"
                                    className="w-full h-11 px-4 rounded-xl bg-(--bg-tertiary) border border-(--border-primary) text-(--text-primary) focus:outline-none focus:border-(--accent) transition-colors placeholder:text-(--text-muted)"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full h-11 bg-(--accent) hover:bg-(--accent-hover) text-(--accent-text) font-bold rounded-xl transition-colors disabled:opacity-50"
                            >
                                {loading ? "Saving..." : "Save Changes"}
                            </button>
                        </form>
                    ) : activeTab === "password" ? (
                        <form onSubmit={handlePasswordChange} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-(--text-muted) mb-2">Current Password</label>
                                <input
                                    type="password"
                                    value={currentPassword}
                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                    placeholder="Enter current password"
                                    className="w-full h-11 px-4 rounded-xl bg-(--bg-tertiary) border border-(--border-primary) text-(--text-primary) focus:outline-none focus:border-(--accent) transition-colors placeholder:text-(--text-muted)"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-(--text-muted) mb-2">New Password</label>
                                <input
                                    type="password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    placeholder="Enter new password (min 8 chars)"
                                    className="w-full h-11 px-4 rounded-xl bg-(--bg-tertiary) border border-(--border-primary) text-(--text-primary) focus:outline-none focus:border-(--accent) transition-colors placeholder:text-(--text-muted)"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={loading || !currentPassword || !newPassword}
                                className="w-full h-11 bg-(--accent) hover:bg-(--accent-hover) text-(--accent-text) font-bold rounded-xl transition-colors disabled:opacity-50"
                            >
                                {loading ? "Changing..." : "Change Password"}
                            </button>
                        </form>
                    ) : activeTab === "memory" ? (
                        <MemoryEditor />
                    ) : (
                        <div className="space-y-6">
                            {/* Theme Selection */}
                            <div>
                                <h3 className="text-sm font-semibold text-(--text-primary) mb-3 flex items-center gap-2">
                                    <span>🎨</span> Theme Mode
                                </h3>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {themeOptions.map((option) => {
                                        const isActive = theme === option.name;
                                        const previewColors = option.name === 'system'
                                            ? themes.dark.colors
                                            : themes[option.name as keyof typeof themes].colors;

                                        return (
                                            <button
                                                key={option.name}
                                                onClick={() => handleThemeChange(option.name)}
                                                className={`relative p-3 rounded-xl border-2 transition-all group ${isActive
                                                        ? "border-(--accent) shadow-[0_0_12px_var(--accent-muted)]"
                                                        : "border-(--border-primary) hover:border-(--border-hover)"
                                                    }`}
                                            >
                                                {/* Theme Preview Mini */}
                                                <div
                                                    className="w-full h-8 rounded-lg mb-2 overflow-hidden border border-(--border-secondary)"
                                                    style={{ backgroundColor: previewColors.bgPrimary }}
                                                >
                                                    <div
                                                        className="h-2"
                                                        style={{ backgroundColor: previewColors.bgSecondary }}
                                                    />
                                                    <div className="flex gap-1 p-1">
                                                        <div
                                                            className="w-2 h-2 rounded-sm"
                                                            style={{ backgroundColor: accentColor.color }}
                                                        />
                                                        <div
                                                            className="flex-1 h-1 mt-0.5 rounded"
                                                            style={{ backgroundColor: previewColors.textPrimary, opacity: 0.5 }}
                                                        />
                                                    </div>
                                                </div>

                                                {/* Label */}
                                                <div className="text-center">
                                                    <div className="text-xs font-medium text-(--text-primary)">
                                                        {option.icon} {option.label}
                                                    </div>
                                                </div>

                                                {/* Active indicator */}
                                                {isActive && (
                                                    <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-(--accent) flex items-center justify-center">
                                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--accent-text)" strokeWidth="3">
                                                            <polyline points="20 6 9 17 4 12" />
                                                        </svg>
                                                    </div>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Accent Color Palette */}
                            <div>
                                <h3 className="text-sm font-semibold text-(--text-primary) mb-3 flex items-center gap-2">
                                    <span>✨</span> Accent Color
                                </h3>
                                <p className="text-xs text-(--text-muted) mb-3">
                                    Choose a color for buttons, links, and highlights
                                </p>
                                <div className="grid grid-cols-6 gap-2">
                                    {accentColors.map((accent) => {
                                        const isActive = accentColor.color === accent.color;

                                        return (
                                            <button
                                                key={accent.name}
                                                onClick={() => handleAccentChange(accent)}
                                                title={accent.name}
                                                className={`relative aspect-square rounded-xl transition-all transform hover:scale-110 ${isActive
                                                        ? "ring-2 ring-offset-2 ring-offset-(--bg-secondary) ring-(--text-primary) scale-110"
                                                        : "hover:ring-1 hover:ring-(--border-hover)"
                                                    }`}
                                                style={{
                                                    backgroundColor: accent.color,
                                                    boxShadow: isActive ? `0 4px 12px ${accent.muted}` : undefined
                                                }}
                                            >
                                                {isActive && (
                                                    <div className="absolute inset-0 flex items-center justify-center">
                                                        <svg
                                                            width="16"
                                                            height="16"
                                                            viewBox="0 0 24 24"
                                                            fill="none"
                                                            stroke={accent.color === '#EAB308' || accent.color === '#BCFF3C' ? '#000' : '#fff'}
                                                            strokeWidth="3"
                                                        >
                                                            <polyline points="20 6 9 17 4 12" />
                                                        </svg>
                                                    </div>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Current accent preview */}
                                <div className="mt-4 p-3 rounded-xl bg-(--bg-tertiary) border border-(--border-primary)">
                                    <div className="flex items-center gap-3">
                                        <div
                                            className="w-10 h-10 rounded-lg shadow-md"
                                            style={{ backgroundColor: accentColor.color }}
                                        />
                                        <div className="flex-1">
                                            <div className="text-sm font-medium text-(--text-primary)">{accentColor.name}</div>
                                            <div className="text-xs text-(--text-muted)">{accentColor.color}</div>
                                        </div>
                                        <button
                                            className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                                            style={{
                                                backgroundColor: accentColor.color,
                                                color: accentColor.color === '#EAB308' || accentColor.color === '#BCFF3C' ? '#000' : '#fff'
                                            }}
                                        >
                                            Preview
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {theme === 'system' && (
                                <p className="text-xs text-(--text-muted) text-center p-3 bg-(--bg-tertiary) rounded-lg">
                                    💻 Theme will automatically match your system preferences
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
