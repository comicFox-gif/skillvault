"use client";

import type { ReactNode } from "react";

/**
 * Shared page wrapper providing the background FX and consistent padding.
 * Pages no longer need to duplicate the gradient/grid background.
 */
export default function PageShell({
  children,
  maxWidth = "max-w-7xl",
  className = "",
}: {
  children: ReactNode;
  maxWidth?: string;
  className?: string;
}) {
  return (
    <main className="relative min-h-screen w-full overflow-x-hidden bg-transparent text-white selection:bg-sky-500/30">
      {/* Background FX */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] h-[600px] w-[600px] rounded-full bg-sky-900/20 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] h-[600px] w-[600px] rounded-full bg-slate-700/20 blur-[120px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:50px_50px] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_50%,#000_70%,transparent_100%)]" />
      </div>

      <div className={`relative z-10 mx-auto ${maxWidth} px-4 py-6 pb-24 sm:px-6 sm:py-8 md:pb-8 ${className}`}>
        {children}
      </div>
    </main>
  );
}
