self.addEventListener('push', () => {
  // no-op (legacy root service worker disabled)
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
});
