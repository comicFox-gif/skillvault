"use client";

import { useCallback, useRef, type MouseEvent, type ReactNode, type ButtonHTMLAttributes } from "react";

interface AnimatedButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  loading?: boolean;
  loadingText?: string;
  variant?: "primary" | "danger" | "ghost" | "success";
}

export default function AnimatedButton({
  children,
  icon,
  loading,
  loadingText,
  variant = "primary",
  className = "",
  onClick,
  disabled,
  ...rest
}: AnimatedButtonProps) {
  const btnRef = useRef<HTMLButtonElement>(null);

  const handleClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      if (loading || disabled) return;

      // Spawn ripple
      const btn = btnRef.current;
      if (btn) {
        const rect = btn.getBoundingClientRect();
        const circle = document.createElement("span");
        circle.className = "ripple-circle";
        circle.style.left = `${e.clientX - rect.left}px`;
        circle.style.top = `${e.clientY - rect.top}px`;
        btn.appendChild(circle);
        setTimeout(() => circle.remove(), 600);
      }

      onClick?.(e);
    },
    [onClick, loading, disabled],
  );

  const variantClasses: Record<string, string> = {
    primary:
      "border-sky-500/40 bg-sky-500/15 text-sky-100 hover:bg-sky-500/25 hover:border-sky-400/60 hover:shadow-[0_0_20px_rgba(56,189,248,0.15)]",
    danger:
      "border-red-500/40 bg-red-600 text-white hover:bg-red-500 hover:shadow-[0_0_20px_rgba(239,68,68,0.2)]",
    ghost:
      "border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white",
    success:
      "border-emerald-500/40 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25 hover:shadow-[0_0_20px_rgba(16,185,129,0.15)]",
  };

  return (
    <button
      ref={btnRef}
      type="button"
      className={`btn-ripple btn-press inline-flex items-center justify-center gap-2.5 rounded-lg border px-5 py-3 text-xs font-bold uppercase tracking-wider transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${variantClasses[variant] ?? variantClasses.primary} ${className}`}
      onClick={handleClick}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <>
          <svg className="h-4 w-4 animate-spin-slow" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>{loadingText || "Processing..."}</span>
        </>
      ) : (
        <>
          {icon && <span className="flex-shrink-0">{icon}</span>}
          <span>{children}</span>
        </>
      )}
    </button>
  );
}
