"use client";

import { useState, useEffect, useCallback } from "react";

interface Team {
    team_id: number;
    name: string;
    description?: string;
    memberCount?: number;
}

interface Member {
    id: string;
    name?: string;
    email: string;
    role?: string;
}

interface TeamsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type ViewMode = "list" | "create" | "details";

export default function TeamsModal({ isOpen, onClose }: TeamsModalProps) {
    const [teams, setTeams] = useState<Team[]>([]);
    const [loading, setLoading] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>("list");
    const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
    const [members, setMembers] = useState<Member[]>([]);

    // Create team form
    const [newTeamName, setNewTeamName] = useState("");
    const [newTeamDesc, setNewTeamDesc] = useState("");

    // Invite member form
    const [inviteEmail, setInviteEmail] = useState("");
    const [inviteRole, setInviteRole] = useState("Member");

    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1";

    const fetchTeams = useCallback(async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${apiUrl}/team`, {
                headers: { "x-auth-token": token }
            });

            if (res.ok) {
                const json = await res.json();
                setTeams(json.data || []);
            }
        } catch (error) {
            console.error("Error fetching teams:", error);
        } finally {
            setLoading(false);
        }
    }, [apiUrl]);

    const fetchTeamMembers = async (teamId: string) => {
        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${apiUrl}/team/${teamId}/members`, {
                headers: { "x-auth-token": token }
            });

            if (res.ok) {
                const json = await res.json();
                // Backend returns [{user: {...}, role: {...}}], flatten to [{id, name, email, role}]
                const rawMembers = json.data || [];
                const flattenedMembers = rawMembers.map((m: { user?: { id?: string; name?: string; email?: string }; role?: { name?: string } }) => ({
                    id: m.user?.id || '',
                    name: m.user?.name || '',
                    email: m.user?.email || '',
                    role: m.role?.name || 'Member'
                }));
                setMembers(flattenedMembers);
            }
        } catch (error) {
            console.error("Error fetching members:", error);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchTeams();
            setViewMode("list");
            setSelectedTeam(null);
        }
    }, [isOpen, fetchTeams]);

    const handleCreateTeam = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTeamName.trim()) return;

        setLoading(true);
        setMessage(null);

        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${apiUrl}/team`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-auth-token": token,
                },
                body: JSON.stringify({
                    name: newTeamName.trim(),
                    description: newTeamDesc.trim() || undefined,
                    roleName: "Owner"  // Ensure creator gets Owner role with all permissions
                }),
            });

            const json = await res.json();

            if (!res.ok) {
                throw new Error(json.message || "Failed to create team");
            }

            setMessage({ type: "success", text: "Team created successfully" });
            setNewTeamName("");
            setNewTeamDesc("");
            setViewMode("list");
            await fetchTeams();
        } catch (err) {
            setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to create team" });
        } finally {
            setLoading(false);
        }
    };

    const handleInviteMember = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedTeam || !inviteEmail.trim()) return;

        setLoading(true);
        setMessage(null);

        try {
            const token = localStorage.getItem("authToken") || "";
            const teamId = selectedTeam.team_id;

            const res = await fetch(`${apiUrl}/team/${teamId}/members`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-auth-token": token,
                },
                body: JSON.stringify({
                    email: inviteEmail.trim(),
                    roleName: inviteRole
                }),
            });

            const json = await res.json();

            if (!res.ok) {
                throw new Error(json.message || "Failed to invite member");
            }

            setMessage({ type: "success", text: "Member invited successfully" });
            setInviteEmail("");
            await fetchTeamMembers(String(teamId));
        } catch (err) {
            setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to invite member" });
        } finally {
            setLoading(false);
        }
    };

    const handleRemoveMember = async (memberId: string) => {
        if (!selectedTeam || !memberId) return;

        if (!confirm("Are you sure you want to remove this member?")) return;

        setLoading(true);
        setMessage(null);

        try {
            const token = localStorage.getItem("authToken") || "";
            const teamId = selectedTeam.team_id;

            const res = await fetch(`${apiUrl}/team/${teamId}/members/${memberId}`, {
                method: "DELETE",
                headers: { "x-auth-token": token },
            });

            if (!res.ok) {
                const json = await res.json();
                throw new Error(json.message || "Failed to remove member");
            }

            setMessage({ type: "success", text: "Member removed successfully" });
            await fetchTeamMembers(String(teamId));
        } catch (err) {
            setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to remove member" });
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteTeam = async (teamId: number) => {
        if (!confirm("Are you sure you want to delete this team? This action cannot be undone.")) return;

        setLoading(true);
        setMessage(null);

        try {
            const token = localStorage.getItem("authToken") || "";
            const res = await fetch(`${apiUrl}/team/${teamId}`, {
                method: "DELETE",
                headers: { "x-auth-token": token },
            });

            if (!res.ok) {
                const json = await res.json();
                throw new Error(json.message || "Failed to delete team");
            }

            setMessage({ type: "success", text: "Team deleted successfully" });
            setTeams(prev => prev.filter(t => t.team_id !== teamId));
            setSelectedTeam(null);
            setViewMode("list");
        } catch (err) {
            setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to delete team" });
        } finally {
            setLoading(false);
        }
    };

    const openTeamDetails = async (team: Team) => {
        setSelectedTeam(team);
        setViewMode("details");
        const teamId = team.team_id;
        if (teamId) await fetchTeamMembers(String(teamId));
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-100 flex items-center justify-center">
            <div className="absolute inset-0 bg-(--backdrop) backdrop-blur-sm" onClick={onClose} />

            <div className="relative bg-(--bg-secondary) border border-(--border-primary) rounded-2xl w-full max-w-lg shadow-2xl max-h-[80vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-(--border-primary)">
                    <h2 className="text-xl font-semibold text-(--text-primary)" style={{ fontFamily: "var(--font-heading)" }}>
                        {viewMode === "create" ? "Create Team" : viewMode === "details" ? selectedTeam?.name : "Teams"}
                    </h2>
                    <div className="flex items-center gap-2">
                        {viewMode === "list" && (
                            <button
                                onClick={() => setViewMode("create")}
                                className="px-3 py-1.5 rounded-lg bg-(--accent) text-(--accent-text) text-xs font-bold hover:bg-(--accent-hover) transition-colors"
                            >
                                + New Team
                            </button>
                        )}
                        {viewMode !== "list" && (
                            <button
                                onClick={() => { setViewMode("list"); setMessage(null); }}
                                className="px-3 py-1.5 rounded-lg bg-(--bg-tertiary) text-(--text-primary) text-xs font-medium hover:bg-(--bg-hover) transition-colors"
                            >
                                ← Back
                            </button>
                        )}
                        <button
                            onClick={() => { setViewMode("list"); onClose(); }}
                            className="w-8 h-8 rounded-lg bg-(--bg-tertiary) hover:bg-(--bg-hover) flex items-center justify-center text-(--text-muted) hover:text-(--text-primary) transition-colors"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M18 6L6 18M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1">
                    {message && (
                        <div className={`mb-4 p-3 rounded-lg text-sm ${message.type === "success"
                            ? "bg-(--success-bg) border border-(--success)/20 text-(--success)"
                            : "bg-(--error-bg) border border-(--error)/20 text-(--error)"
                            }`}>
                            {message.text}
                        </div>
                    )}

                    {viewMode === "create" && (
                        <form onSubmit={handleCreateTeam} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-(--text-muted) mb-2">Team Name *</label>
                                <input
                                    type="text"
                                    value={newTeamName}
                                    onChange={(e) => setNewTeamName(e.target.value)}
                                    placeholder="Enter team name"
                                    className="w-full h-11 px-4 rounded-xl bg-(--bg-tertiary) border border-(--border-primary) text-(--text-primary) focus:outline-none focus:border-(--accent) transition-colors placeholder:text-(--text-muted)"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-(--text-muted) mb-2">Description</label>
                                <textarea
                                    value={newTeamDesc}
                                    onChange={(e) => setNewTeamDesc(e.target.value)}
                                    placeholder="Optional description"
                                    rows={3}
                                    className="w-full px-4 py-3 rounded-xl bg-(--bg-tertiary) border border-(--border-primary) text-(--text-primary) focus:outline-none focus:border-(--accent) transition-colors resize-none placeholder:text-(--text-muted)"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={loading || !newTeamName.trim()}
                                className="w-full h-11 bg-(--accent) hover:bg-(--accent-hover) text-(--accent-text) font-bold rounded-xl transition-colors disabled:opacity-50"
                            >
                                {loading ? "Creating..." : "Create Team"}
                            </button>
                        </form>
                    )}

                    {viewMode === "details" && selectedTeam && (
                        <div className="space-y-6">
                            {/* Invite Member Form */}
                            <div className="p-4 rounded-xl bg-(--bg-tertiary) border border-(--border-primary)">
                                <h3 className="text-sm font-semibold text-(--text-primary) mb-3">Invite Member</h3>
                                <form onSubmit={handleInviteMember} className="space-y-3">
                                    <input
                                        type="email"
                                        value={inviteEmail}
                                        onChange={(e) => setInviteEmail(e.target.value)}
                                        placeholder="Email address"
                                        className="w-full h-10 px-3 rounded-lg bg-(--bg-secondary) border border-(--border-primary) text-(--text-primary) text-sm focus:outline-none focus:border-(--accent) placeholder:text-(--text-muted)"
                                        required
                                    />
                                    <div className="flex gap-2">
                                        <select
                                            value={inviteRole}
                                            onChange={(e) => setInviteRole(e.target.value)}
                                            className="flex-1 h-10 px-3 rounded-lg bg-(--bg-secondary) border border-(--border-primary) text-(--text-primary) text-sm focus:outline-none focus:border-(--accent)"
                                        >
                                            <option value="Member">Member</option>
                                            <option value="Admin">Admin</option>
                                        </select>
                                        <button
                                            type="submit"
                                            disabled={loading || !inviteEmail.trim()}
                                            className="px-4 h-10 bg-(--accent) hover:bg-(--accent-hover) text-(--accent-text) font-bold rounded-lg text-sm disabled:opacity-50"
                                        >
                                            Invite
                                        </button>
                                    </div>
                                </form>
                            </div>

                            {/* Members List */}
                            <div>
                                <h3 className="text-sm font-semibold text-(--text-muted) mb-3">Members ({members.length})</h3>
                                {members.length === 0 ? (
                                    <p className="text-(--text-muted) text-sm">No members yet. Invite someone above!</p>
                                ) : (
                                    <div className="space-y-2">
                                        {members.map((member, idx) => {
                                            // Null-safe avatar initial
                                            const displayName = member.name || member.email || 'Unknown';
                                            const initial = (member.name?.charAt(0) || member.email?.charAt(0) || '?').toUpperCase();
                                            const memberId = member.id || `member-${idx}`;
                                            const memberRole = member.role || 'Member';

                                            return (
                                                <div key={memberId} className="flex items-center justify-between p-3 rounded-lg bg-(--bg-tertiary) border border-(--border-primary)">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-full bg-(--accent-muted) flex items-center justify-center text-(--accent) font-bold text-xs">
                                                            {initial}
                                                        </div>
                                                        <div>
                                                            <p className="text-(--text-primary) text-sm">{displayName}</p>
                                                            {member.email && (
                                                                <p className="text-(--text-muted) text-xs">{member.email}</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs text-(--text-muted)">{memberRole}</span>
                                                        <button
                                                            onClick={() => handleRemoveMember(memberId)}
                                                            disabled={loading}
                                                            className="p-1.5 rounded-lg hover:bg-(--error-bg) text-(--text-muted) hover:text-(--error) transition-colors disabled:opacity-50"
                                                            title="Remove member"
                                                        >
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                <path d="M18 6L6 18M6 6l12 12" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {viewMode === "list" && (
                        loading ? (
                            <div className="text-center py-8 text-(--text-muted)">Loading teams...</div>
                        ) : teams.length === 0 ? (
                            <div className="text-center py-8">
                                <div className="w-16 h-16 rounded-2xl bg-(--bg-tertiary) mx-auto mb-4 flex items-center justify-center">
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
                                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                        <circle cx="9" cy="7" r="4" />
                                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                                    </svg>
                                </div>
                                <p className="text-(--text-muted) text-sm">No teams yet. Create one to get started!</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {teams.map((team, index) => (
                                    <div
                                        key={team.team_id || `team-${index}`}
                                        className="group p-4 rounded-xl bg-(--bg-tertiary) border border-(--border-primary) hover:border-(--accent)/50 transition-colors cursor-pointer"
                                    >
                                        <div className="flex items-center justify-between">
                                            <div
                                                className="flex-1"
                                                onClick={() => openTeamDetails(team)}
                                            >
                                                <h4 className="text-(--text-primary) font-medium">{team.name}</h4>
                                                {team.description && (
                                                    <p className="text-(--text-muted) text-sm mt-1">{team.description}</p>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-xs text-(--text-muted)">{team.memberCount || 0} members</span>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDeleteTeam(team.team_id);
                                                    }}
                                                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-(--error-bg) transition-all"
                                                    title="Delete team"
                                                >
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2">
                                                        <polyline points="3 6 5 6 21 6" />
                                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                                    </svg>
                                                </button>
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
                                                    <polyline points="9 18 15 12 9 6" />
                                                </svg>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )
                    )}
                </div>
            </div>
        </div>
    );
}
