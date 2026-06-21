"use client";
import { useState } from "react";
import Link from "next/link";
import { postJSON } from "@/lib/api-client";
import AuthScaffold from "../AuthScaffold";

export default function ForgotPasswordPage() {
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState<string>();
    const [err, setErr] = useState<string>();

    async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setErr(undefined);
        setMsg(undefined);
        setLoading(true);

        const f = new FormData(e.currentTarget);
        const email = String(f.get("email") || "");

        if (!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
            setLoading(false);
            setErr("Please enter a valid email.");
            return;
        }

        try {
            const apiUrl = `${process.env.NEXT_PUBLIC_API_BASE_URL}/auth/forget-password`;
            const result = await postJSON(apiUrl, { email });
            if (result.ok) {
                setMsg("If an account exists, we sent a reset link.");
            } else {
                setErr(result.error);
            }
        } catch (error) {
            console.error("Forgot password error:", error);
            setErr("Something went wrong. Please try again.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <AuthScaffold
            heroTitle="Recover access"
            heroText="Enter your email and we'll send a secure link to reset your password. No passwords shared, no waiting on support."
        >
            <h2
                className="text-2xl md:text-3xl font-bold mb-1.5"
                style={{ fontFamily: "var(--font-heading)" }}
            >
                Forgot password?
            </h2>
            <p className="text-sm text-(--text-muted) mb-7">
                Enter your email and we&rsquo;ll send a reset link.
            </p>

            <form onSubmit={onSubmit} className="space-y-4" noValidate>
                <label className="block">
                    <div className="mb-1.5 text-xs font-semibold text-(--text-secondary) uppercase tracking-wider">
                        Email
                    </div>
                    <input
                        name="email"
                        type="email"
                        autoComplete="email"
                        placeholder="you@company.com"
                        required
                        className="w-full h-12 px-4 rounded-xl bg-(--bg-tertiary) border border-(--border-primary) text-(--text-primary) placeholder:text-(--text-muted) focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent)/25 transition-all"
                    />
                </label>

                {err && (
                    <div className="rounded-lg border border-(--error)/30 bg-(--error-bg) text-(--error) text-sm px-3 py-2">
                        {err}
                    </div>
                )}
                {msg && (
                    <div className="rounded-lg border border-(--success)/30 bg-(--success-bg) text-(--success) text-sm px-3 py-2">
                        {msg}
                    </div>
                )}

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full h-12 rounded-xl bg-vanta-neon text-black font-bold hover:bg-vanta-neon/90 transition-all shadow-lg shadow-vanta-neon/25 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    {loading ? "Sending…" : "Send reset link"}
                </button>

                <p className="text-center text-sm text-(--text-muted) pt-2">
                    Remember your password?{" "}
                    <Link
                        href="/login"
                        className="text-(--accent) font-semibold hover:text-(--accent-hover) transition-colors"
                    >
                        Sign in
                    </Link>
                </p>
            </form>
        </AuthScaffold>
    );
}
