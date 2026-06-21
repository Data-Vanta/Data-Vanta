"use client";
import { useId } from "react";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
};

export function Input({ label, error, className, ...rest }: Props) {
  const id = useId();

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <label htmlFor={id} style={{ fontSize: 14, color: "#4a4a4a" }}>
        {label}
      </label>
      <input
        id={id}
        className={className}
        style={{
          height: 52,
          padding: "0 14px",
          borderRadius: 14,
          border: "1px solid #dcdcdc",
          background: "#fff",
          color: "#0b0b0b",
          fontSize: 14,
          outline: "none",
          transition: "border-color 0.2s ease, box-shadow 0.2s ease",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "#bfbfbf";
          e.currentTarget.style.boxShadow =
            "0 0 0 3px rgba(195, 255, 19, 0.28)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "#dcdcdc";
          e.currentTarget.style.boxShadow = "none";
        }}
        {...rest}
      />
      {error && <small style={{ color: "var(--error)" }}>{error}</small>}
    </div>
  );
}
