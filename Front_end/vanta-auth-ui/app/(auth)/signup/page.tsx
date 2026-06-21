"use client";
import { useState } from "react";
import Link from "next/link";
import { postJSON } from "@/lib/api-client";
import type { User } from "@/lib/types";

export default function SignupPage() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>();
  const [err, setErr] = useState<string>();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;

    setErr(undefined);
    setMsg(undefined);
    setLoading(true);

    const f = new FormData(form);
    const firstName = String(f.get("firstName") || "");
    const lastName = String(f.get("lastName") || "");
    const email = String(f.get("email") || "");
    const password = String(f.get("password") || "");
    const confirm = String(f.get("confirm") || "");

    if (!firstName || !lastName) {
      setLoading(false);
      setErr("First and last name are required.");
      return;
    }
    if (!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
      setLoading(false);
      setErr("Please enter a valid email.");
      return;
    }
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

    const name = `${firstName} ${lastName}`;

    try {
      const apiUrl = `${process.env.NEXT_PUBLIC_API_BASE_URL}/auth/signup`;
      const result = await postJSON<User>(apiUrl, { name, email, password });

      if (result.ok) {
        setMsg("Account created. Signing you in…");
        form.reset();
        // In dev (AUTO_VERIFY_USERS=true) the account is pre-verified, so we
        // could auto-sign-in. Simpler for now: send them to /login with a hint.
        setTimeout(() => {
          window.location.href = "/login";
        }, 900);
      } else {
        setErr(result.error);
      }
    } catch (error) {
      console.error("Signup error:", error);
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
        Create your account
      </h2>
      <p className="text-sm text-(--text-muted) mb-7">Free to start. No credit card needed.</p>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name">
            <input
              name="firstName"
              autoComplete="given-name"
              placeholder="Ada"
              required
              className={inputCls}
            />
          </Field>
          <Field label="Last name">
            <input
              name="lastName"
              autoComplete="family-name"
              placeholder="Lovelace"
              required
              className={inputCls}
            />
          </Field>
        </div>

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

        <Field label="Password">
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
        </Field>

        <Field label="Confirm password">
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
        </Field>

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
          {loading ? "Creating…" : "Create account"}
        </button>

        <p className="text-center text-sm text-(--text-muted) pt-2">
          Already have an account?{" "}
          <Link href="/login" className="text-(--accent) font-semibold hover:text-(--accent-hover) transition-colors">
            Sign in
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
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 text-xs font-semibold text-(--text-secondary) uppercase tracking-wider">
        {label}
      </div>
      {children}
    </label>
  );
}
