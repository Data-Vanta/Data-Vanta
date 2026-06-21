"use client";
import * as React from "react";
import styles from "@/app/(auth)/auth.module.css";

type Mode = "dark" | "light";

export interface PasswordInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  error?: string;
  mode?: Mode;
  inputClassName?: string; // ← جديد
  buttonClassName?: string; // ← جديد
  className?: string; // wrapper
  id?: string;
}

export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  PasswordInputProps
>(
  (
    {
      label,
      error,
      mode = "dark",
      inputClassName,
      buttonClassName,
      className,
      id,
      ...rest
    },
    ref
  ) => {
    const reactId = React.useId();
    const fieldId = id || reactId;
    const [show, setShow] = React.useState(false);

    const inputCls = [mode === "light" ? styles.lightInput : "", inputClassName]
      .filter(Boolean)
      .join(" ");

    const btnCls = [mode === "light" ? styles.showBtn : "", buttonClassName]
      .filter(Boolean)
      .join(" ");

    return (
      <div className={className} style={{ display: "grid", gap: 6 }}>
        <label htmlFor={fieldId} style={{ fontSize: 14 }}>
          {label}
        </label>

        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 88px", gap: 8 }}
        >
          <input
            id={fieldId}
            ref={ref}
            type={show ? "text" : "password"}
            className={inputCls}
            aria-invalid={!!error}
            aria-describedby={error ? `${fieldId}-error` : undefined}
            {...rest}
          />

          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className={btnCls || inputCls}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
            aria-pressed={show}
            aria-label={show ? "Hide password" : "Show password"}
          >
            {show ? "Hide" : "Show"}
          </button>
        </div>

        {error && (
          <small id={`${fieldId}-error`} style={{ color: "#ff6b6b" }}>
            {error}
          </small>
        )}
      </div>
    );
  }
);

PasswordInput.displayName = "PasswordInput";
