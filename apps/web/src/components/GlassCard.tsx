"use client";

import type { ReactNode } from "react";

/**
 * Reusable glassmorphic card used throughout the app.
 */
export default function GlassCard({
  children,
  className = "",
  glow = false,
  hover = true,
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
  hover?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] via-white/[0.03] to-transparent p-[1px] shadow-[0_10px_40px_rgba(0,0,0,0.4)] ${
        hover ? "transition-transform duration-200 hover:scale-[1.01] hover:shadow-[0_15px_50px_rgba(0,0,0,0.5)]" : ""
      } ${className}`}
    >
      {glow && (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(56,189,248,0.15),transparent_45%),radial-gradient(circle_at_90%_90%,rgba(59,130,246,0.1),transparent_45%)]" />
      )}
      <div className="relative rounded-[15px] bg-slate-900/90 p-5 backdrop-blur-xl">
        {children}
      </div>
    </div>
  );
}
