// Service worker: shows push notifications (new messages, fees, kickoff, finals, cancelled practices)
// and opens the right page when one is tapped. It doesn't cache anything, so the app always loads fresh.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Cottontown", body: e.data ? e.data.text() : "" }; }
  const show = self.registration.showNotification(d.title || "Cottontown", {
    body: d.body || "", tag: d.tag || undefined, renotify: !!d.tag, icon: "/icon-192.png", badge: "/icon-192.png", data: { url: d.url || "/" },
  });
  const badge = self.navigator.setAppBadge && d.badge ? self.navigator.setAppBadge(d.badge).catch(() => {}) : null;
  e.waitUntil(Promise.all([show, badge].filter(Boolean)));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) if (w.url === url && "focus" in w) return w.focus();
    if (wins[0] && "navigate" in wins[0]) { await wins[0].navigate(url); return wins[0].focus(); }
    return self.clients.openWindow(url);
  })());
});
