// Service worker for the volunteer portal app (installed from
// volunteer.html via volunteer.webmanifest).
//
// It only does push notifications: it shows each push from lib/push.js and
// opens the portal when one is tapped. It deliberately has no fetch
// handler and caches nothing, so the site always loads fresh from Netlify
// and "just push to main" changes show up straight away.
//
// Payload: { title, body, url, tag } (JSON). iOS requires every push to
// show a notification, so even a bad payload shows a generic one.

self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(event) { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', function(event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  var title = data.title || 'Santa Super Sleigh Salford';
  var options = {
    body: data.body || 'You have a new update in the volunteer portal.',
    icon: '/media/app/icon-192.png',
    badge: '/media/app/badge-96.png',
    data: { url: typeof data.url === 'string' && data.url.charAt(0) === '/' ? data.url : '/volunteer.html' }
  };
  if (data.tag) { options.tag = data.tag; options.renotify = true; }
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var target = new URL(event.notification.data && event.notification.data.url || '/volunteer.html', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (new URL(c.url).pathname === '/volunteer.html' && 'focus' in c) {
        if ('navigate' in c) return c.navigate(target).then(function(w) { return (w || c).focus(); }).catch(function() { return c.focus(); });
        return c.focus();
      }
    }
    return self.clients.openWindow(target);
  }));
});
