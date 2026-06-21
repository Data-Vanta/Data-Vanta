"use client";
import React from "react";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  full?: boolean;
  variant?: "primary" | "ghost";
};

export const Button = React.forwardRef<HTMLButtonElement, Props>(
  ({ full, variant = "primary", style, disabled, className, ...rest }, ref) => {
    const base: React.CSSProperties = {
      width: full ? "100%" : undefined,
      height: 48,
      borderRadius: 999,
      border: "1px solid var(--border-primary)",
      background: variant === "primary" ? "var(--accent)" : "transparent",
      color: variant === "primary" ? "var(--accent-text)" : "var(--text-primary)",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: 800,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.6 : 1,
      transition: "transform .06s ease, opacity .2s ease, background-color .2s ease",
      boxShadow:
        variant === "primary" ? "0 8px 24px var(--accent-muted)" : "none",
    };

    return (
      <button
        ref={ref}
        style={{ ...base, ...style }}
        className={className}
        onMouseDown={(e) =>
          (e.currentTarget.style.transform = "translateY(1px)")
        }
        onMouseUp={(e) => (e.currentTarget.style.transform = "translateY(0)")}
        onMouseEnter={(e) => {
          if (variant === "primary") {
            e.currentTarget.style.background = "var(--accent-hover)";
          } else {
            e.currentTarget.style.background = "var(--bg-hover)";
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = variant === "primary" ? "var(--accent)" : "transparent";
        }}
        disabled={disabled}
        {...rest}
      />
    );
  }
);
Button.displayName = "Button";
