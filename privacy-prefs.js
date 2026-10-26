// FILE: privacy-prefs.js -- analytics preferences (loaded in <head> on every
// public page, BEFORE analytics.js).
//
// Optional analytics = the Cloudflare Web Analytics beacon + our own
// first-party events (log-analytics) + street-demand logging (log-search).
// It is ON by default and visitors can turn it off at any time via any
// element with a data-analytics-prefs attribute (footer link, privacy page).
// A browser sending Global Privacy Control is treated as OFF unless the
// visitor has explicitly chosen ON here.
//
// The choice is a single first-party localStorage value (no cookie). It is
// checked before the beacon is injected and before analytics.js sends
// anything, so an OFF choice means no optional analytics requests at all.
// Street search, maps, tracking and volunteer login are unaffected.
//
// Also expires the old, inert santa_sleigh_cookie_consent cookie from the
// retired cookie banner. Netlify Identity's auth cookie is never touched.
(function () {
    'use strict';

    var KEY = 'sss_analytics_pref'; // 'on' | 'off' | absent (default)
    var CF_TOKEN = '3b7106934eac4fcfa830d632dc201682';

    function read() {
        try { return window.localStorage.getItem(KEY); } catch (e) { return null; }
    }
    function write(value) {
        try { window.localStorage.setItem(KEY, value); return true; } catch (e) { return false; }
    }
    function gpc() {
        return navigator.globalPrivacyControl === true;
    }
    function analyticsEnabled() {
        var v = read();
        if (v === 'off') return false;
        if (v === 'on') return true;
        return !gpc();
    }
    function isLocal() {
        return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
    }

    // Retire the old consent cookie (set by the previous cookie banner).
    try {
        document.cookie = 'santa_sleigh_cookie_consent=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax';
    } catch (e) { /* ignore */ }

    function loadBeacon() {
        if (isLocal() || document.querySelector('script[data-cf-beacon]')) return;
        var s = document.createElement('script');
        s.defer = true;
        s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
        s.setAttribute('data-cf-beacon', JSON.stringify({ token: CF_TOKEN }));
        (document.head || document.documentElement).appendChild(s);
    }

    // qr.html (the QR sign hop) sets SSS_SKIP_BEACON: it redirects at once,
    // and the homepage it lands on loads the beacon itself.
    if (analyticsEnabled() && !window.SSS_SKIP_BEACON) loadBeacon();

    // ---- Preferences dialog ------------------------------------------------
    var styleAdded = false;
    function addStyles() {
        if (styleAdded) return;
        styleAdded = true;
        var css =
            '.sss-prefs-overlay{position:fixed;inset:0;background:rgba(20,20,24,.55);z-index:6000;display:flex;align-items:center;justify-content:center;padding:16px}' +
            '.sss-prefs-dialog{background:#fff;color:#24272E;border-radius:14px;max-width:440px;width:100%;padding:22px 20px;box-shadow:0 10px 40px rgba(0,0,0,.25);font-size:15px;line-height:1.55}' +
            '.sss-prefs-dialog h2{margin:0 0 10px;font-size:1.25rem;color:var(--santa-red,#A8382F)}' +
            '.sss-prefs-dialog p{margin:0 0 12px}' +
            '.sss-prefs-row{display:flex;gap:10px;align-items:flex-start;margin:14px 0;padding:12px;border:1px solid #E7E2D9;border-radius:10px}' +
            '.sss-prefs-row input{width:20px;height:20px;margin-top:2px;flex:0 0 auto}' +
            '.sss-prefs-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}' +
            '.sss-prefs-actions button{font:inherit;padding:10px 18px;border-radius:999px;cursor:pointer;border:2px solid var(--santa-green,#1E5B45)}' +
            '.sss-prefs-save{background:var(--santa-green,#1E5B45);color:#fff}' +
            '.sss-prefs-cancel{background:#fff;color:var(--santa-green,#1E5B45)}' +
            '.sss-prefs-dialog a{color:var(--santa-red,#A8382F);font-weight:600}' +
            '.sss-prefs-status{min-height:1.4em;font-weight:600;color:var(--santa-green,#1E5B45);margin-top:8px}' +
            '.sss-prefs-dialog :focus-visible{outline:3px solid #EBC96B;outline-offset:2px}';
        var el = document.createElement('style');
        el.textContent = css;
        document.head.appendChild(el);
    }

    function openPreferences(trigger) {
        addStyles();
        var previousFocus = trigger || document.activeElement;
        var overlay = document.createElement('div');
        overlay.className = 'sss-prefs-overlay';
        overlay.innerHTML =
            '<div class="sss-prefs-dialog" role="dialog" aria-modal="true" aria-labelledby="sssPrefsTitle">' +
              '<h2 id="sssPrefsTitle">Analytics preferences</h2>' +
              '<p>We use anonymous usage statistics (Cloudflare Web Analytics and our own page-view, interaction and street-search records) to understand which features people use and which streets they look for. They contain no IP addresses or visitor IDs.</p>' +
              '<div class="sss-prefs-row">' +
                '<input type="checkbox" id="sssPrefsAnalytics">' +
                '<label for="sssPrefsAnalytics"><strong>Allow anonymous usage statistics</strong><br>Turning this off does not stop street search, maps, live tracking or volunteer login from working.</label>' +
              '</div>' +
              '<p style="font-size:13px;color:#5B6169">Your choice is saved in this browser only. <a href="/privacy.html#analytics">Privacy policy</a></p>' +
              '<div class="sss-prefs-actions">' +
                '<button type="button" class="sss-prefs-save">Save</button>' +
                '<button type="button" class="sss-prefs-cancel">Cancel</button>' +
              '</div>' +
              '<div class="sss-prefs-status" role="status" aria-live="polite"></div>' +
            '</div>';
        document.body.appendChild(overlay);

        var box = overlay.querySelector('#sssPrefsAnalytics');
        var status = overlay.querySelector('.sss-prefs-status');
        box.checked = analyticsEnabled();
        box.focus();

        function close() {
            document.removeEventListener('keydown', onKey, true);
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            if (previousFocus && previousFocus.focus) previousFocus.focus();
        }
        function onKey(e) {
            if (e.key === 'Escape') { e.preventDefault(); close(); return; }
            if (e.key === 'Tab') {
                var f = overlay.querySelectorAll('input,button,a[href]');
                var first = f[0], last = f[f.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        }
        document.addEventListener('keydown', onKey, true);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
        overlay.querySelector('.sss-prefs-cancel').addEventListener('click', close);
        overlay.querySelector('.sss-prefs-save').addEventListener('click', function () {
            var on = box.checked;
            var wasOn = analyticsEnabled();
            if (!write(on ? 'on' : 'off')) {
                status.textContent = 'Sorry, this browser is blocking saved settings, so your choice could not be stored.';
                return;
            }
            updateStatusLabels();
            status.textContent = on ? 'Saved: usage statistics are on.' : 'Saved: usage statistics are off.';
            if (on) loadBeacon();
            // An already-loaded Cloudflare beacon can't be unloaded, so reload
            // the page once to stop it after switching off.
            var needsReload = !on && wasOn && !!document.querySelector('script[data-cf-beacon]');
            setTimeout(function () {
                close();
                if (needsReload) window.location.reload();
            }, 900);
        });
    }

    function updateStatusLabels() {
        var els = document.querySelectorAll('[data-analytics-status]');
        for (var i = 0; i < els.length; i++) {
            els[i].textContent = analyticsEnabled() ? 'on' : 'off';
        }
    }

    document.addEventListener('click', function (e) {
        var t = e.target && e.target.closest ? e.target.closest('[data-analytics-prefs]') : null;
        if (!t) return;
        e.preventDefault();
        openPreferences(t);
    });
    document.addEventListener('DOMContentLoaded', updateStatusLabels);

    window.SSSPrivacy = {
        analyticsEnabled: analyticsEnabled,
        openPreferences: openPreferences
    };
})();
