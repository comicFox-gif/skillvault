"use client";

type PushEventPayload = {
  wallets: string[];
  title: string;
  body: string;
  url?: string;
  tag?: string;
  data?: Record<string, unknown>;
};

type NotifyOptions = {
  body?: string;
  tag?: string;
  url?: string;
  data?: Record<string, unknown>;
  requireInteraction?: boolean;
  silent?: boolean;
};

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "";
const SW_FILE = "/sw-push.js";
const DEFAULT_ICON = "/icon.svg";

function normalizeWallet(walletRaw: string) {
  return String(walletRaw ?? "").trim().toLowerCase();
}

function isWallet(value: string) {
  return /^0x[a-f0-9]{40}$/.test(value);
}

function base64UrlToUint8Array(input: string) {
  const padding = "=".repeat((4 - (input.length % 4)) % 4);
  const base64 = (input + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = typeof window !== "undefined" ? window.atob(base64) : "";
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export function canUsePush() {
  if (typeof window === "undefined") return false;
  return "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
}

export async function registerPushWorker() {
  if (!canUsePush()) return null;
  try {
    return await navigator.serviceWorker.register(SW_FILE);
  } catch {
    return null;
  }
}

export async function requestNotificationPermission() {
  if (!canUsePush()) return "unsupported" as const;
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    await registerPushWorker();
  }
  return permission;
}

export async function subscribePushNotifications(walletRaw?: string) {
  if (!canUsePush()) return false;
  if (Notification.permission !== "granted") return false;
  if (!VAPID_PUBLIC_KEY) return false;

  const wallet = normalizeWallet(walletRaw ?? "");
  if (!isWallet(wallet)) return false;

  const registration = await registerPushWorker();
  if (!registration) return false;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const response = await fetch("/api/notifications/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wallet,
      subscription: subscription.toJSON(),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    }),
  });
  return response.ok;
}

export async function showBrowserNotification(title: string, options: NotifyOptions = {}) {
  if (!canUsePush()) return false;
  if (Notification.permission !== "granted") return false;

  const payloadData = { ...(options.data ?? {}), url: options.url };
  const notificationOptions: NotificationOptions = {
    body: options.body,
    tag: options.tag,
    data: payloadData,
    icon: DEFAULT_ICON,
    badge: DEFAULT_ICON,
    requireInteraction: options.requireInteraction,
    silent: options.silent,
  };

  const registration = await registerPushWorker();
  if (registration) {
    await registration.showNotification(title, notificationOptions);
    return true;
  }

  new Notification(title, notificationOptions);
  return true;
}

export async function publishWalletNotification(payload: PushEventPayload) {
  const wallets = Array.from(
    new Set(
      (payload.wallets ?? [])
        .map((wallet) => normalizeWallet(wallet))
        .filter((wallet) => isWallet(wallet)),
    ),
  );
  if (!wallets.length) return;

  await fetch("/api/notifications/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wallets,
      title: String(payload.title ?? "").slice(0, 120),
      body: String(payload.body ?? "").slice(0, 240),
      url: payload.url ? String(payload.url) : undefined,
      tag: payload.tag ? String(payload.tag).slice(0, 64) : undefined,
      data: payload.data ?? {},
    }),
  }).catch(() => undefined);
}
