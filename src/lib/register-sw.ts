// Previously registered a service worker for offline caching. The SW's
// navigateFallback served stale HTML/JS after deploys, crashing the
// production site. We now unregister any leftover SW on every load.
export function registerSW() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      for (const r of regs) r.unregister();
    }).catch(() => {});
  });
}
