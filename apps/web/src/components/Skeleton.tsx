"use client";

/**
 * Shimmer skeleton placeholder for loading states.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-white/5 ${className}`}
    />
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-white/5 bg-slate-900/60 p-5 space-y-3">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

export function StatSkeleton() {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5 text-center space-y-2">
      <Skeleton className="h-7 w-12 mx-auto" />
      <Skeleton className="h-3 w-16 mx-auto" />
    </div>
  );
}

export function TableRowSkeleton({ cols = 4 }: { cols?: number }) {
  return (
    <div className="flex items-center gap-4 py-3 px-4">
      {Array.from({ length: cols }, (_, i) => (
        <Skeleton key={i} className="h-4 flex-1" />
      ))}
    </div>
  );
}
