self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "SkillVault";
  const data = payload.data || {};

  // Build a smart URL based on notification type
  let url = data.url || "/";
  if (!data.url) {
    const type = data.type || "";
    const newRoomCode = data.newRoomCode || "";
    const roomCode = data.roomCode || "";

    if (type === "rematch_requested" && newRoomCode) {
      // Opponent gets notified of rematch — route to OLD match room where join/cancel prompt shows
      url = roomCode ? `/matches/${roomCode}` : "/matches";
    } else if (type === "rematch_accepted" && newRoomCode) {
      url = `/matches/${newRoomCode}`;
    } else if (type === "match_joined" && roomCode) {
      url = `/matches/${roomCode}`;
    } else if (type === "match_created" && roomCode) {
      url = `/matches/${roomCode}`;
    } else if (type === "outcome_proposed" && roomCode) {
      url = `/matches/${roomCode}`;
    } else if (type === "referral_joined") {
      url = "/profile";
    } else if (roomCode) {
      url = `/matches/${roomCode}`;
    } else if (newRoomCode) {
      url = `/matches/${newRoomCode}`;
    }
  }

  const options = {
    body: payload.body || "You have a new platform update.",
    icon: payload.icon || "/icon.svg",
    badge: payload.badge || "/icon.svg",
    tag: payload.tag || "skillvault-update",
    renotify: true,
    data: { ...data, url },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      // Try to find an existing tab with the same match room and focus it
      for (const client of windowClients) {
        const clientUrl = new URL(client.url);
        const targetUrl = new URL(url, clientUrl.origin);
        if (clientUrl.pathname === targetUrl.pathname && "focus" in client) {
          client.navigate(targetUrl.href);
          return client.focus();
        }
      }
      // Otherwise reuse any existing tab or open a new one
      for (const client of windowClients) {
        if ("focus" in client) {
          client.navigate(new URL(url, client.url).href);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
      return undefined;
    }),
  );
});
