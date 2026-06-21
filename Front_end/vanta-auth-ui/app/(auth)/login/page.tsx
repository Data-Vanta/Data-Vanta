"use client";
import { useState } from "react";
import Link from "next/link";
import { postJSON } from "@/lib/api-client";
import type { AuthToken } from "@/lib/types";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>();
  const [err, setErr] = useState<string>();
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(undefined);
    setMsg(undefined);
    setLoading(true);

    const f = new FormData(e.currentTarget);
    const email = String(f.get("email") || "");
    const password = String(f.get("password") || "");

    if (!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
      setLoading(false);
      setErr("Please enter a valid email.");
      return;
    }
    if (!password || password.length < 8) {
      setLoading(false);
      setErr("Password must be at least 8 characters.");
      return;
    }

    try {
      const apiUrl = `${process.env.NEXT_PUBLIC_API_BASE_URL}/auth/signin`;
      const result = await postJSON<AuthToken>(apiUrl, { email, password });

      if (result.ok) {
        // Wipe any stale session data from a previous login on this browser
        localStorage.clear();
        sessionStorage.clear();
        document.cookie = "token=; path=/; max-age=0; SameSite=Strict";

        localStorage.setItem("authToken", result.data.token);
        document.cookie = `token=${result.data.token}; path=/; max-age=86400; SameSite=Strict`;
        setMsg("Signed in. Redirecting…");
        window.location.href = "/dashboard";
      } else {
        setErr(result.error);
      }
    } catch (error) {
      console.error("Login error:", error);
      setErr("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h2
        className="text-2xl md:text-3xl font-bold mb-1.5"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        Welcome back
      </h2>
      <p className="text-sm text-(--text-muted) mb-7">Sign in to keep exploring your data.</p>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Email">
          <input
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            required
            className={inputCls}
          />
        </Field>

        <Field
          label="Password"
          rightLink={
            <Link href="/forgot-password" className="text-xs text-(--accent) hover:text-(--accent-hover) transition-colors">
              Forgot?
            </Link>
          }
        >
          <div className="relative">
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
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
        </Field>

        <label className="flex items-center gap-2 text-sm text-(--text-secondary) select-none cursor-pointer">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.currentTarget.checked)}
            className="w-4 h-4 accent-vanta-neon"
          />
          Remember me
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
          {loading ? "Signing in…" : "Sign in"}
        </button>

        <p className="text-center text-sm text-(--text-muted) pt-2">
          New to Vanta?{" "}
          <Link href="/signup" className="text-(--accent) font-semibold hover:text-(--accent-hover) transition-colors">
            Create an account
          </Link>
        </p>
      </form>
    </>
  );
}

const inputCls =
  "w-full h-12 px-4 rounded-xl bg-(--bg-tertiary) border border-(--border-primary) text-(--text-primary) placeholder:text-(--text-muted) focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent)/25 transition-all";

function Field({
  label,
  rightLink,
  children,
}: {
  label: string;
  rightLink?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold text-(--text-secondary) uppercase tracking-wider">
          {label}
        </span>
        {rightLink}
      </div>
      {children}
    </label>
  );
}
