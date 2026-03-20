import webpush, { type PushSubscription } from "web-push";
import {
  listPushSubscriptionsForWallets,
  markPushDelivery,
  removePushSubscriptionByEndpoint,
} from "@/lib/server/notificationStore";

type PushMessagePayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  data?: Record<string, unknown>;
};

type PushSendResult = {
  targetedWallets: number;
  subscriptionsFound: number;
  sent: number;
  failed: number;
  skipped: boolean;
  reason?: string;
};

let webPushConfigured = false;
let webPushConfigAttempted = false;

function configureWebPush() {
  if (webPushConfigAttempted) return webPushConfigured;
  webPushConfigAttempted = true;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = process.env.VAPID_SUBJECT?.trim() ?? "mailto:admin@skillvault.app";

  if (!publicKey || !privateKey) {
    webPushConfigured = false;
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  webPushConfigured = true;
  return true;
}

function buildPayload(message: PushMessagePayload) {
  return JSON.stringify({
    title: String(message.title ?? "").slice(0, 120),
    body: String(message.body ?? "").slice(0, 240),
    tag: message.tag ? String(message.tag).slice(0, 64) : "skillvault-update",
    data: {
      ...(message.data ?? {}),
      url: message.url ?? "/",
    },
    icon: "/icon.svg",
    badge: "/icon.svg",
  });
}

function toPushSubscription(record: {
  endpoint: string;
  p256dh: string;
  auth: string;
}): PushSubscription {
  return {
    endpoint: record.endpoint,
    keys: {
      p256dh: record.p256dh,
      auth: record.auth,
    },
  };
}

export async function sendPushToWallets(
  wallets: string[],
  message: PushMessagePayload,
): Promise<PushSendResult> {
  const normalizedWallets = Array.from(
    new Set(
      (wallets ?? [])
        .map((wallet) => String(wallet ?? "").trim().toLowerCase())
        .filter((wallet) => /^0x[a-f0-9]{40}$/.test(wallet)),
    ),
  );
  if (!normalizedWallets.length) {
    return { targetedWallets: 0, subscriptionsFound: 0, sent: 0, failed: 0, skipped: true, reason: "No wallets." };
  }

  if (!configureWebPush()) {
    return {
      targetedWallets: normalizedWallets.length,
      subscriptionsFound: 0,
      sent: 0,
      failed: 0,
      skipped: true,
      reason: "VAPID keys are not configured.",
    };
  }

  const subscriptions = await listPushSubscriptionsForWallets(normalizedWallets);
  if (!subscriptions.length) {
    return {
      targetedWallets: normalizedWallets.length,
      subscriptionsFound: 0,
      sent: 0,
      failed: 0,
      skipped: true,
      reason: "No push subscriptions for target wallets.",
    };
  }

  const payload = buildPayload(message);
  let sent = 0;
  let failed = 0;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(toPushSubscription(subscription), payload, {
        TTL: 300,
        urgency: "high",
      });
      sent += 1;
      await markPushDelivery(subscription.endpoint, true);
    } catch (error: any) {
      failed += 1;
      const statusCode = Number(error?.statusCode ?? 0);
      await markPushDelivery(
        subscription.endpoint,
        false,
        String(error?.body || error?.message || "Push delivery failed."),
      );
      if (statusCode === 404 || statusCode === 410) {
        await removePushSubscriptionByEndpoint(subscription.endpoint);
      }
    }
  }

  return {
    targetedWallets: normalizedWallets.length,
    subscriptionsFound: subscriptions.length,
    sent,
    failed,
    skipped: false,
  };
}
