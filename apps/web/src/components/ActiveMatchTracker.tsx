"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export interface ActiveMatch {
  roomCode: string;
  matchId: string;
  role: "creator" | "opponent" | "spectator";
  status: number;
  game?: string;
  opponent?: string;
  stake?: string;
  lastVisited: number;
}

interface ActiveMatchContextValue {
  activeMatches: ActiveMatch[];
  trackMatch: (match: Omit<ActiveMatch, "lastVisited">) => void;
  removeMatch: (roomCode: string) => void;
  updateMatchStatus: (roomCode: string, status: number) => void;
}

const ActiveMatchContext = createContext<ActiveMatchContextValue>({
  activeMatches: [],
  trackMatch: () => {},
  removeMatch: () => {},
  updateMatchStatus: () => {},
});

export function useActiveMatches() {
  return useContext(ActiveMatchContext);
}

const STORAGE_KEY = "sv_active_matches";
const MAX_TRACKED = 10;
/** Matches resolved (5) or cancelled (6) are auto-removed after this many ms */
const STALE_MS = 2 * 60 * 60 * 1000; // 2 hours

function loadFromStorage(): ActiveMatch[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ActiveMatch[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function saveToStorage(matches: ActiveMatch[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(matches));
  } catch {
    // storage full or unavailable
  }
}

export function ActiveMatchProvider({ children }: { children: ReactNode }) {
  const [activeMatches, setActiveMatches] = useState<ActiveMatch[]>([]);

  // Load on mount
  useEffect(() => {
    const loaded = loadFromStorage();
    const now = Date.now();
    // Prune stale completed matches
    const fresh = loaded.filter((m) => {
      if (m.status === 5 || m.status === 6) {
        return now - m.lastVisited < STALE_MS;
      }
      return true;
    });
    setActiveMatches(fresh);
    saveToStorage(fresh);
  }, []);

  const trackMatch = useCallback((match: Omit<ActiveMatch, "lastVisited">) => {
    setActiveMatches((prev) => {
      const existing = prev.findIndex((m) => m.roomCode === match.roomCode);
      const entry: ActiveMatch = { ...match, lastVisited: Date.now() };
      let next: ActiveMatch[];
      if (existing >= 0) {
        next = [...prev];
        next[existing] = entry;
      } else {
        next = [entry, ...prev].slice(0, MAX_TRACKED);
      }
      saveToStorage(next);
      return next;
    });
  }, []);

  const removeMatch = useCallback((roomCode: string) => {
    setActiveMatches((prev) => {
      const next = prev.filter((m) => m.roomCode !== roomCode);
      saveToStorage(next);
      return next;
    });
  }, []);

  const updateMatchStatus = useCallback((roomCode: string, status: number) => {
    setActiveMatches((prev) => {
      const idx = prev.findIndex((m) => m.roomCode === roomCode);
      if (idx < 0) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], status, lastVisited: Date.now() };
      saveToStorage(next);
      return next;
    });
  }, []);

  return (
    <ActiveMatchContext.Provider value={{ activeMatches, trackMatch, removeMatch, updateMatchStatus }}>
      {children}
    </ActiveMatchContext.Provider>
  );
}
