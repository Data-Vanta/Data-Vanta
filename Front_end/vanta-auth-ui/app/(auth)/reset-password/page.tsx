"use client";
import { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { postJSON } from "@/lib/api-client";
import AuthScaffold from "../AuthScaffold";

function ResetPasswordForm() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const token = searchParams.get("token");

    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState<string>();
    const [err, setErr] = useState<string>();
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setErr(undefined);
        setMsg(undefined);
        setLoading(true);

        if (!token) {
            setErr("Invalid or missing token.");
            setLoading(false);
            return;
        }

        const f = new FormData(e.currentTarget);
        const password = String(f.get("password") || "");
        const confirm = String(f.get("confirm") || "");

        if (password.length < 8) {
            setLoading(false);
            setErr("Password must be at least 8 characters.");
            return;
        }
        if (password !== confirm) {
            setLoading(false);
            setErr("Passwords do not match.");
            return;
        }

        try {
            const apiUrl = `${process.env.NEXT_PUBLIC_API_BASE_URL}/auth/change-password?token=${token}`;
            const result = await postJSON(apiUrl, { password });

            if (result.ok) {
                setMsg("Password changed. Redirecting to sign in…");
                setTimeout(() => {
                    router.push("/login");
                }, 1200);
            } else {
                setErr(result.error || "Could not reset password.");
            }
        } catch (error) {
            console.error("Reset password error:", error);
            setErr("Something went wrong. Please try again.");
        } finally {
            setLoading(false);
        }
    }

    if (!token) {
        return (
            <>
                <h2
                    className="text-2xl md:text-3xl font-bold mb-1.5 text-(--error)"
                    style={{ fontFamily: "var(--font-heading)" }}
                >
                    Invalid link
                </h2>
                <p className="text-sm text-(--text-muted) mb-6">
                    This password reset link is invalid or has expired.
                </p>
                <Link
                    href="/forgot-password"
                    className="block text-center w-full h-12 rounded-xl bg-vanta-neon text-black font-bold leading-12 hover:bg-vanta-neon/90 transition-all"
                >
                    Request a new link
                </Link>
            </>
        );
    }

    return (
        <>
            <h2
                className="text-2xl md:text-3xl font-bold mb-1.5"
                style={{ fontFamily: "var(--font-heading)" }}
            >
                Reset password
            </h2>
            <p className="text-sm text-(--text-muted) mb-7">
                Pick a new password for your account.
            </p>

            <form onSubmit={onSubmit} className="space-y-4" noValidate>
                <label className="block">
                    <div className="mb-1.5 text-xs font-semibold text-(--text-secondary) uppercase tracking-wider">
                        New password
                    </div>
                    <div className="relative">
                        <input
                            name="password"
                            type={showPassword ? "text" : "password"}
                            autoComplete="new-password"
                            placeholder="At least 8 characters"
                            required
                            minLength={8}
                            className={`${inputCls} pr-16`}
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword((s) => !s)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-(--text-muted) hover:text-(--text-primary) transition-colors"
                        >
                            {showPassword ? "Hide" : "Show"}
                        </button>
                    </div>
                </label>

                <label className="block">
                    <div className="mb-1.5 text-xs font-semibold text-(--text-secondary) uppercase tracking-wider">
                        Confirm password
                    </div>
                    <div className="relative">
                        <input
                            name="confirm"
                            type={showConfirm ? "text" : "password"}
                            autoComplete="new-password"
                            placeholder="Repeat it"
                            required
                            minLength={8}
                            className={`${inputCls} pr-16`}
                        />
                        <button
                            type="button"
                            onClick={() => setShowConfirm((s) => !s)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-(--text-muted) hover:text-(--text-primary) transition-colors"
                        >
                            {showConfirm ? "Hide" : "Show"}
                        </button>
                    </div>
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
                    {loading ? "Updating…" : "Update password"}
                </button>

                <p className="text-center text-sm text-(--text-muted) pt-2">
                    <Link
                        href="/login"
                        className="text-(--accent) font-semibold hover:text-(--accent-hover) transition-colors"
                    >
                        Back to sign in
                    </Link>
                </p>
            </form>
        </>
    );
}

const inputCls =
    "w-full h-12 px-4 rounded-xl bg-(--bg-tertiary) border border-(--border-primary) text-(--text-primary) placeholder:text-(--text-muted) focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent)/25 transition-all";

export default function ResetPasswordPage() {
    return (
        <AuthScaffold
            heroTitle="Secure access"
            heroText="Pick a strong new password — 8 characters minimum. We hash and never store it in plaintext."
        >
            <Suspense fallback={<div className="text-(--text-muted) text-sm">Loading…</div>}>
                <ResetPasswordForm />
            </Suspense>
        </AuthScaffold>
    );
}
