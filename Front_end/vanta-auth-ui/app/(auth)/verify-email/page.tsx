"use client";

import Link from "next/link";
import { useState } from "react";
import AuthScaffold from "../AuthScaffold";

export default function VerifyEmailPage() {
    const [sent, setSent] = useState(false);
    const [sending, setSending] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    function readToken(): string {
        if (typeof window === "undefined") return "";
        const ls = localStorage.getItem("authToken");
        if (ls) return ls;
        const match = document.cookie.match(/(?:^|;\s*)token=([^;]+)/);
        return match ? decodeURIComponent(match[1]) : "";
    }

    async function resend() {
        setSending(true);
        setErr(null);
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api/v1";
            const token = readToken();
            if (!token) {
                throw new Error("Your session expired. Please sign in again.");
            }
            const res = await fetch(`${apiUrl}/auth/resend-verification`, {
                method: "POST",
                headers: { "x-auth-token": token },
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(body.message || "Could not resend email.");
            }
            setSent(true);
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Unknown error");
        } finally {
            setSending(false);
        }
    }

    return (
        <AuthScaffold
            heroTitle="One more step"
            heroText="We sent you a verification email. Click the link inside to unlock the dashboard — it takes about 10 seconds."
        >
            <div className="text-center">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-vanta-neon/10 border border-vanta-neon/30 flex items-center justify-center mb-5">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#BCFF3C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                        <polyline points="22,6 12,13 2,6" />
                    </svg>
                </div>
                <h2
                    className="text-2xl md:text-3xl font-bold mb-2"
                    style={{ fontFamily: "var(--font-heading)" }}
                >
                    Check your email
                </h2>
                <p className="text-sm text-(--text-muted) mb-7 max-w-sm mx-auto">
                    We sent a verification link to your inbox. Click it to unlock the dashboard.
                </p>

                {sent && (
                    <div className="mb-4 rounded-lg border border-(--success)/30 bg-(--success-bg) text-(--success) text-sm px-3 py-2">
                        A new verification email is on its way.
                    </div>
                )}
                {err && (
                    <div className="mb-4 rounded-lg border border-(--error)/30 bg-(--error-bg) text-(--error) text-sm px-3 py-2">
                        {err}
                    </div>
                )}

                <div className="flex flex-col gap-3">
                    <button
                        onClick={resend}
                        disabled={sending || sent}
                        className="w-full h-12 rounded-xl bg-vanta-neon text-black font-bold hover:bg-vanta-neon/90 transition-all shadow-lg shadow-vanta-neon/25 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {sending ? "Sending…" : sent ? "Sent" : "Resend verification email"}
                    </button>
                    <Link
                        href="/login"
                        className="text-sm text-(--text-muted) hover:text-(--text-primary) transition-colors"
                    >
                        Back to sign in
                    </Link>
                </div>
            </div>
        </AuthScaffold>
    );
}
