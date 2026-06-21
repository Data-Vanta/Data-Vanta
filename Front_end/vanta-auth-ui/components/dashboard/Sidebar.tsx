"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
    IconChat,
    IconFile,
    IconSettings,
    IconHelp,
    IconPlus,
} from "./Icons";
import SettingsModal from "./SettingsModal";
import TeamsModal from "./TeamsModal";
import QuickUploadModal from "./QuickUploadModal";

interface User {
    id: string;
    name?: string;
    email: string;
    role?: string;
}

interface ChatSession {
    id: string;
    title: string;
    updatedAt: string;
}

interface SidebarProps {
    user: User | null;
}

export default function Sidebar({ user }: SidebarProps) {
    const pathname = usePathname();
    const router = useRouter();
    const searchParams = useSearchParams();
    const activeSessionId = searchParams.get("session");
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isTeamsOpen, setIsTeamsOpen] = useState(false);
    const [isQuickUploadOpen, setIsQuickUploadOpen] = useState(false);
    const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");

    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1";

    // Fetch chat sessions on mount
    useEffect(() => {
        const fetchChatSessions = async () => {
            try {
                const token = localStorage.getItem("authToken") || "";
                if (!token) return;

                const res = await fetch(`${apiUrl}/chat/sessions`, {
                    headers: { "x-auth-token": token }
                });

                if (res.ok) {
                    const json = await res.json();
                    setChatSessions(json.data || []);
                }
            } catch (error) {
                console.error("Error fetching chat sessions:", error);
            }
        };

        fetchChatSessions();
    }, [apiUrl]);

    const IconConnector = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
        <svg className={className} style={style} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 14 3 21" />
            <path d="M14 10 21 3" />
            <path d="M9 4h1a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H9" />
            <path d="M5 9h1a3 3 0 0 1 3 3v0" />
            <path d="M15 15v0a3 3 0 0 1 3-3h1" />
        </svg>
    );

    const IconBoards = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
        <svg className={className} style={style} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="9" rx="1" />
            <rect x="14" y="3" width="7" height="5" rx="1" />
            <rect x="14" y="12" width="7" height="9" rx="1" />
            <rect x="3" y="16" width="7" height="5" rx="1" />
        </svg>
    );

    type NavItem = {
        label: string;
        icon: typeof IconChat;
        href: string;
        quickAction?: {
            title: string;
            onAction: () => void;
        };
    };

    const navItems: NavItem[] = [
        { label: "Chats", icon: IconChat, href: "/dashboard" },
        { label: "Boards", icon: IconBoards, href: "/dashboard/boards" },
        {
            label: "Files",
            icon: IconFile,
            href: "/dashboard/files",
            quickAction: {
                title: "Quick upload",
                onAction: () => setIsQuickUploadOpen(true),
            },
        },
        {
            label: "Connectors",
            icon: IconConnector,
            href: "/dashboard/connectors",
            quickAction: {
                title: "Add a database connection",
                onAction: () => router.push("/dashboard/connectors"),
            },
        },
    ];

    const handleNewChat = async () => {
        // Retry once on a transient "Failed to fetch" — that's usually
        // nodemon restarting user-auth; it comes back in ~500ms.
        const post = async () => {
            const token = localStorage.getItem("authToken") || "";
            return fetch(`${apiUrl}/chat/sessions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-auth-token": token,
                },
                body: JSON.stringify({ title: "New Chat" }),
            });
        };
        let res: Response | null = null;
        try {
            res = await post();
        } catch {
            await new Promise((r) => setTimeout(r, 600));
            try { res = await post(); } catch (e) {
                alert("Couldn't create a new chat — is user-auth running? " + (e instanceof Error ? e.message : ""));
                return;
            }
        }
        if (!res.ok) {
            const json = await res.json().catch(() => ({}));
            alert(`Couldn't create a new chat: ${json.message || res.statusText}`);
            return;
        }
        const json = await res.json();
        const newId = json?.data?.id;
        if (newId) {
            localStorage.setItem("currentSessionId", newId);
            // Refresh first so our own useEffect in Sidebar re-fetches
            // the session list, then navigate so the dashboard picks
            // up the new ?session= param.
            setChatSessions((prev) => [json.data, ...prev]);
            router.push(`/dashboard?session=${newId}`);
        } else {
            router.push("/dashboard");
        }
    };

    const handleDeleteAllChats = async () => {
        if (!confirm(`Delete ALL ${chatSessions.length} chats? This cannot be undone.`)) return;
        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${apiUrl}/chat/sessions`, {
                method: "DELETE",
                headers: { "x-auth-token": token },
            });
            if (!res.ok) {
                console.error(`Bulk delete failed: ${res.status}`);
                alert("Failed to delete all chats — see console.");
                return;
            }
            setChatSessions([]);
            localStorage.removeItem("currentSessionId");
            router.push("/dashboard");
        } catch (err) {
            console.error("Delete all error:", err);
            alert("Failed to delete all chats — see console.");
        }
    };

    const handleLogout = () => {
        // Clear all auth-related storage
        localStorage.removeItem("authToken");
        localStorage.removeItem("user");
        localStorage.removeItem("currentDataset");
        localStorage.removeItem("chatAttachments");
        localStorage.removeItem("chatSessions");

        // Clear all cookies
        document.cookie = "token=; path=/; max-age=0; SameSite=Strict";
        document.cookie = "authToken=; path=/; max-age=0; SameSite=Strict";

        // Clear sessionStorage as well
        sessionStorage.clear();

        // Force redirect to login
        window.location.href = "/login";
    };

    return (
        <>
            <aside
                className="fixed top-0 left-0 h-screen w-[260px] bg-(--bg-secondary) border-r border-(--border-primary) flex flex-col z-50 shadow-lg"
                style={{ fontFamily: "var(--font-body, 'Inter', sans-serif)" }}
            >
                {/* 1. Header Area: Logo + User */}
                <div className="p-5 flex flex-col gap-5">
                    {/* Brand */}
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-(--accent) grid place-items-center shadow-sm">
                            <span
                                className="font-bold text-lg"
                                style={{ color: "var(--accent-text)", fontFamily: "var(--font-heading, 'Space Grotesk', sans-serif)" }}
                            >
                                V
                            </span>
                        </div>
                        <span
                            className="font-bold text-xl tracking-wide"
                            style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading, 'Space Grotesk', sans-serif)" }}
                        >
                            Vanta<span style={{ color: "var(--accent)" }}>.</span>
                        </span>
                    </div>

                    {/* User Profile - Real data from backend */}
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-(--bg-tertiary) border border-(--border-secondary) hover:border-(--accent) transition-colors cursor-pointer group">
                        <div className="w-9 h-9 rounded-full bg-linear-to-br from-(--accent) to-(--accent-hover) flex items-center justify-center text-(--accent-text) font-bold text-sm shadow-sm">
                            {user?.name?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || "U"}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                                {user?.name || "User"}
                            </p>
                            <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
                                {user?.email || "Loading..."}
                            </p>
                        </div>
                    </div>
                </div>

                {/* 2. Primary Action */}
                <div className="px-5 mb-3">
                    <button
                        onClick={handleNewChat}
                        className="w-full h-11 bg-(--accent) hover:bg-(--accent-hover) text-(--accent-text) font-bold rounded-xl flex items-center justify-center gap-2 transition-all shadow-md hover:shadow-lg"
                    >
                        <IconPlus className="w-4 h-4" />
                        <span>New Chat</span>
                    </button>
                </div>

                {/* 3. Navigation */}
                <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto">
                    <div
                        className="px-3 mb-2 text-[10px] font-bold uppercase tracking-wider"
                        style={{ color: "var(--text-muted)" }}
                    >
                        Workspace
                    </div>

                    {navItems.map((item) => {
                        const isActive = pathname === item.href;
                        return (
                            <div
                                key={item.href}
                                className={`
                  group relative flex items-stretch rounded-xl transition-all
                  ${isActive
                                        ? "bg-(--accent-muted) border border-(--accent)/40"
                                        : "hover:bg-(--bg-hover) border border-transparent"
                                    }
                `}
                            >
                                <Link
                                    href={item.href}
                                    className="flex-1 flex items-center gap-3 px-3 py-2.5 text-sm font-semibold"
                                    style={{
                                        color: isActive ? "var(--text-primary)" : "var(--text-secondary)"
                                    }}
                                >
                                    <item.icon
                                        className="w-5 h-5"
                                        style={{
                                            color: isActive ? "var(--accent)" : "var(--text-muted)"
                                        }}
                                    />
                                    <span className="flex-1">{item.label}</span>
                                </Link>
                                {item.quickAction && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            item.quickAction!.onAction();
                                        }}
                                        title={item.quickAction.title}
                                        aria-label={item.quickAction.title}
                                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 mr-2 my-1.5 px-2 rounded-md text-(--text-muted) hover:text-vanta-neon hover:bg-(--bg-tertiary) transition-all flex items-center"
                                    >
                                        <IconPlus className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        );
                    })}

                    {/* Recent Chats Section */}
                    {chatSessions.length > 0 && (
                        <>
                            <div className="px-3 mt-4 mb-2 flex items-center justify-between">
                                <span
                                    className="text-[10px] font-bold uppercase tracking-wider"
                                    style={{ color: "var(--text-muted)" }}
                                >
                                    Recent Chats
                                </span>
                                <button
                                    type="button"
                                    onClick={handleDeleteAllChats}
                                    className="text-[10px] font-semibold uppercase tracking-wider hover:opacity-80 transition-opacity"
                                    style={{ color: "var(--error)" }}
                                    aria-label="Delete all chats"
                                    title="Delete all chats"
                                >
                                    Delete all
                                </button>
                            </div>
                            <div className="max-h-[40vh] overflow-y-auto -mx-1 px-1 space-y-0.5">
                            {chatSessions.map((session) => {
                                const isActive = session.id === activeSessionId;
                                const isRenaming = renamingId === session.id;
                                return (
                                <div
                                    key={session.id}
                                    className={`group flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-all ${isActive
                                            ? "bg-(--accent-muted) text-(--accent)"
                                            : "hover:bg-(--bg-hover) text-(--text-secondary)"
                                        }`}
                                >
                                    <div
                                        className="flex-1 flex items-center gap-2 min-w-0"
                                        onClick={() => {
                                            if (isRenaming) return;
                                            localStorage.setItem("currentSessionId", session.id);
                                            router.push(`/dashboard?session=${session.id}`);
                                        }}
                                    >
                                        <IconChat className="w-4 h-4 flex-none" style={{ color: isActive ? "var(--accent)" : "var(--text-muted)" }} />
                                        {isRenaming ? (
                                            <input
                                                autoFocus
                                                value={renameValue}
                                                onChange={(e) => setRenameValue(e.target.value)}
                                                onBlur={async () => {
                                                    const newTitle = renameValue.trim();
                                                    setRenamingId(null);
                                                    if (!newTitle || newTitle === session.title) return;
                                                    try {
                                                        const token = localStorage.getItem("authToken") || "";
                                                        const res = await fetch(`${apiUrl}/chat/sessions/${session.id}`, {
                                                            method: "PUT",
                                                            headers: { "Content-Type": "application/json", "x-auth-token": token },
                                                            body: JSON.stringify({ title: newTitle }),
                                                        });
                                                        if (res.ok) {
                                                            setChatSessions(prev => prev.map(s => s.id === session.id ? { ...s, title: newTitle } : s));
                                                        }
                                                    } catch (err) {
                                                        console.error("Rename error:", err);
                                                    }
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                                    if (e.key === "Escape") { setRenamingId(null); }
                                                }}
                                                onClick={(e) => e.stopPropagation()}
                                                className="flex-1 bg-(--bg-tertiary) border border-(--accent)/50 rounded px-1.5 py-0.5 text-xs text-(--text-primary) outline-none"
                                            />
                                        ) : (
                                            <span className="flex-1 truncate">{session.title}</span>
                                        )}
                                    </div>
                                    {!isRenaming && (
                                        <>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setRenamingId(session.id);
                                                    setRenameValue(session.title);
                                                }}
                                                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-(--bg-hover) transition-all"
                                                title="Rename"
                                            >
                                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                                                </svg>
                                            </button>
                                            <button
                                                onClick={async (e) => {
                                                    e.stopPropagation();
                                                    if (!confirm("Delete this chat?")) return;
                                                    try {
                                                        const token = localStorage.getItem("authToken") || "";
                                                        const res = await fetch(`${apiUrl}/chat/sessions/${session.id}`, {
                                                            method: "DELETE",
                                                            headers: { "x-auth-token": token }
                                                        });
                                                        if (res.ok) {
                                                            setChatSessions(prev => prev.filter(s => s.id !== session.id));
                                                            if (isActive) router.push("/dashboard");
                                                        }
                                                    } catch (err) {
                                                        console.error("Delete error:", err);
                                                    }
                                                }}
                                                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-(--error-bg) transition-all"
                                                title="Delete chat"
                                            >
                                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2">
                                                    <polyline points="3 6 5 6 21 6" />
                                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                                </svg>
                                            </button>
                                        </>
                                    )}
                                </div>
                                );
                            })}
                            </div>
                        </>
                    )}
                </nav>

                {/* 4. Bottom Actions */}
                <div className="p-3 border-t border-(--border-primary) space-y-1">
                    <button
                        onClick={() => setIsTeamsOpen(true)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium hover:bg-(--bg-hover) transition-colors"
                        style={{ color: "var(--text-secondary)" }}
                    >
                        <svg
                            width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                            className="w-5 h-5"
                            style={{ color: "var(--text-muted)" }}
                        >
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                        <span>Teams</span>
                    </button>
                    <button
                        onClick={() => setIsSettingsOpen(true)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium hover:bg-(--bg-hover) transition-colors"
                        style={{ color: "var(--text-secondary)" }}
                    >
                        <IconSettings className="w-5 h-5" style={{ color: "var(--text-muted)" }} />
                        <span>Settings</span>
                    </button>
                    <button
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium hover:bg-(--bg-hover) transition-colors"
                        style={{ color: "var(--text-secondary)" }}
                    >
                        <IconHelp className="w-5 h-5" style={{ color: "var(--text-muted)" }} />
                        <span>Help & Support</span>
                    </button>
                    <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium hover:bg-(--error-bg) transition-colors"
                        style={{ color: "var(--error)" }}
                    >
                        <svg
                            width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                            className="w-5 h-5"
                        >
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                            <polyline points="16 17 21 12 16 7" />
                            <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                        <span>Logout</span>
                    </button>
                </div>
            </aside>

            <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                user={user}
            />
            <TeamsModal
                isOpen={isTeamsOpen}
                onClose={() => setIsTeamsOpen(false)}
            />
            <QuickUploadModal
                isOpen={isQuickUploadOpen}
                onClose={() => setIsQuickUploadOpen(false)}
            />
        </>
    );
}
