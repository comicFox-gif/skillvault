"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import {
  canUsePush,
  getNotificationPermission,
  requestNotificationPermission,
  showBrowserNotification,
  subscribePushNotifications,
} from "@/lib/notifications";

export default function NotificationCenter() {
  const { address, isConnected } = useAccount();
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(canUsePush());
    setPermission(getNotificationPermission());
  }, []);

  useEffect(() => {
    if (permission !== "granted") return;
    if (!isConnected || !address) return;
    void subscribePushNotifications(address);
  }, [permission, isConnected, address]);

  if (!supported || permission === "granted") return null;

  async function enableNotifications() {
    if (busy) return;
    setBusy(true);
    setStatusText("");
    try {
      const nextPermission = await requestNotificationPermission();
      setPermission(nextPermission);
      if (nextPermission !== "granted") {
        setStatusText("Notification permission not granted.");
        return;
      }
      if (isConnected && address) {
        await subscribePushNotifications(address);
      }
      await showBrowserNotification("Notifications enabled", {
        body: "You will receive match and tournament updates here.",
        tag: "skillvault-notifications-enabled",
        url: "/",
      });
      setStatusText("Notifications enabled.");
    } catch {
      setStatusText("Could not enable notifications.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 w-[min(92vw,340px)]">
      <div className="pointer-events-auto rounded-2xl border border-sky-500/30 bg-slate-900/95 p-4 shadow-[0_16px_50px_rgba(0,0,0,0.55)] backdrop-blur-xl">
        <div className="text-[10px] uppercase tracking-[0.35em] text-sky-300/80">Alerts</div>
        <p className="mt-2 text-xs text-gray-300">
          Enable browser alerts for match starts, result actions, and tournament updates.
        </p>
        <button
          type="button"
          onClick={() => void enableNotifications()}
          disabled={busy}
          className="mt-3 w-full cursor-pointer rounded-xl border border-sky-500/40 bg-sky-500/20 px-4 py-2 text-xs font-bold uppercase tracking-wider text-sky-100 disabled:opacity-60"
        >
          {busy ? "Enabling..." : "Enable Notifications"}
        </button>
        {permission === "denied" ? (
          <p className="mt-2 text-[11px] text-amber-200">
            Notifications are blocked by browser settings. Allow notifications and refresh.
          </p>
        ) : null}
        {statusText ? <p className="mt-2 text-[11px] text-sky-200">{statusText}</p> : null}
      </div>
    </div>
  );
}
