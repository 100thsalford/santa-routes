// hello@ mailbox page (mailbox.html) for volunteers with mailbox access.
// Talks only to /.netlify/functions/mailbox, which checks access on every
// call and relays to Resend Inboxes. See netlify/functions/mailbox.js.
(function() {
    'use strict';

    var API = '/.netlify/functions/mailbox';
    var MAX_BYTES = 4 * 1024 * 1024;
    var MAX_FILES = 10;
    var POLL_MS = 60000;
    var FOLDER_NAMES = { inbox: 'Inbox', sent: 'Sent', archive: 'Archive', spam: 'Spam', trash: 'Bin' };

    var state = {
        address: '',
        me: null,               // { name, email }
        folder: 'inbox',
        query: '',
        threads: [],
        hasMore: false,
        loadingList: false,
        thread: null,           // { id, subject, folder, emails, sentBy }
        showImages: {},         // emailId -> true
        compose: null,          // { mode, threadId, emailId, target, requestId }
        files: [],              // { name, type, size, content }
        sending: false,
        started: false
    };

    var $ = function(id) { return document.getElementById(id); };

    // ---- Small utilities ----------------------------------------------------

    function showToast(message, type) {
        var container = $('toastContainer');
        var toast = document.createElement('div');
        toast.className = 'toast' + (type === 'error' ? ' error' : '');
        var text = document.createElement('span');
        text.textContent = message;
        toast.appendChild(text);
        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'toast-close';
        close.setAttribute('aria-label', 'Dismiss');
        close.textContent = '×';
        var timer = setTimeout(remove, 5000);
        function remove() { clearTimeout(timer); if (toast.parentNode) toast.parentNode.removeChild(toast); }
        close.onclick = remove;
        toast.appendChild(close);
        container.appendChild(toast);
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str).replace(/[&<>"']/g, function(c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function newRequestId() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/[^A-Za-z0-9-]/g, '');
        return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    }

    function formatSize(bytes) {
        if (bytes == null) return '';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
        return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    var dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' });
    var yearFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric' });
    var timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
    var fullFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    var keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' });

    function shortDate(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d)) return '';
        var now = new Date();
        if (keyFmt.format(d) === keyFmt.format(now)) return timeFmt.format(d);
        if (d.getFullYear() === now.getFullYear()) return dayFmt.format(d);
        return yearFmt.format(d);
    }

    function fullDate(iso) {
        var d = new Date(iso);
        return isNaN(d) ? '' : fullFmt.format(d);
    }

    // "Jo Bloggs <jo@x.com>" -> { name: 'Jo Bloggs', email: 'jo@x.com' }
    function parseAddress(s) {
        s = String(s || '').trim();
        var m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
        if (m) return { name: m[1].trim(), email: m[2].trim() };
        return { name: '', email: s };
    }

    function displayName(s) {
        var a = parseAddress(s);
        return a.name || a.email || 'Unknown sender';
    }

    function isOurAddress(s) {
        return parseAddress(s).email.toLowerCase() === String(state.address || '').toLowerCase();
    }

    // ---- API ------------------------------------------------------------------

    async function authHeaders() {
        var user = netlifyIdentity.currentUser();
        if (!user) throw new Error('Please log in again.');
        var token = await user.jwt();
        return { 'Authorization': 'Bearer ' + token };
    }

    async function apiGet(params) {
        var qs = new URLSearchParams(params).toString();
        var res = await fetch(API + '?' + qs, { headers: await authHeaders() });
        var data = await res.json().catch(function() { return {}; });
        if (!res.ok) throw apiError(res, data);
        return data;
    }

    async function apiPost(body) {
        var headers = await authHeaders();
        headers['Content-Type'] = 'application/json';
        var res = await fetch(API, { method: 'POST', headers: headers, body: JSON.stringify(body) });
        var data = await res.json().catch(function() { return {}; });
        if (!res.ok) throw apiError(res, data);
        return data;
    }

    function apiError(res, data) {
        if (res.status === 403 && data && data.error === 'no_access') {
            showGate(data.message || "You don't have access to the mailbox.", false, true);
        }
        if (res.status === 413) return new Error('That was too big to send. Attachments can be up to 4 MB in total.');
        return new Error((data && (data.message || data.error)) || ('Request failed (' + res.status + ')'));
    }

    // ---- Gate (logged out / no access) ----------------------------------------

    function showGate(text, showLogin, showPortal) {
        $('gateCard').hidden = false;
        $('appArea').hidden = true;
        $('gateText').textContent = text;
        $('gateLoginBtn').hidden = !showLogin;
        $('gatePortalLink').hidden = !showPortal;
    }

    async function start() {
        showGate('Loading the mailbox...', false, false);
        try {
            var res = await fetch('/.netlify/functions/get-volunteer-profile', { headers: await authHeaders() });
            var profile = await res.json();
            if (!res.ok) throw new Error(profile.error || 'Could not load your profile');
            if (profile.approvalStatus && profile.approvalStatus !== 'approved') {
                showGate('Your volunteer registration is still waiting for approval.', false, true);
                return;
            }
            if (!profile.mailboxAccess) {
                showGate("You don't have access to the mailbox. Ask an admin if you need it.", false, true);
                return;
            }
            var user = netlifyIdentity.currentUser();
            state.me = {
                name: profile.fullName || (user && user.user_metadata && user.user_metadata.full_name) || profile.email || '',
                email: profile.email || ''
            };
            var summary = await apiGet({ op: 'summary' });
            state.address = summary.address;
            $('addressLabel').textContent = summary.address;
            $('alertsToggle').checked = !!summary.alerts;
            setUnread(summary.unread);
            $('gateCard').hidden = true;
            $('appArea').hidden = false;
            state.started = true;
            loadThreads(false);
        } catch (err) {
            showGate("The mailbox couldn't load: " + err.message, false, true);
        }
    }

    function setUnread(n) {
        document.title = (n > 0 ? '(' + n + ') ' : '') + 'Mailbox | Santa Super Sleigh Salford';
        var inboxTab = document.querySelector('.mb-folder[data-folder="inbox"]');
        if (inboxTab) inboxTab.textContent = 'Inbox' + (n > 0 ? ' (' + n + ')' : '');
    }

    // ---- Thread list ------------------------------------------------------------

    async function loadThreads(append, quiet) {
        if (state.loadingList) return;
        state.loadingList = true;
        var list = $('threadList');
        if (!append && !quiet) {
            list.innerHTML = '';
            $('threadEmpty').hidden = false;
            $('threadEmpty').textContent = 'Loading...';
            $('loadMoreRow').hidden = true;
        }
        try {
            var params = { op: 'threads', folder: state.folder };
            if (state.query) params.q = state.query;
            if (append && state.threads.length) params.after = state.threads[state.threads.length - 1].id;
            var data = await apiGet(params);
            state.threads = append ? state.threads.concat(data.threads) : data.threads;
            state.hasMore = data.hasMore;
            renderThreads();
        } catch (err) {
            if (!quiet) {
                $('threadEmpty').hidden = false;
                $('threadEmpty').textContent = "Couldn't load conversations: " + err.message;
            }
        } finally {
            state.loadingList = false;
        }
    }

    function renderThreads() {
        var list = $('threadList');
        list.innerHTML = '';
        var empty = $('threadEmpty');
        if (!state.threads.length) {
            empty.hidden = false;
            empty.textContent = state.query
                ? 'Nothing in ' + FOLDER_NAMES[state.folder] + ' matches "' + state.query + '".'
                : (state.folder === 'inbox' ? 'No emails yet.' : FOLDER_NAMES[state.folder] + ' is empty.');
        } else {
            empty.hidden = true;
        }
        state.threads.forEach(function(t) {
            var li = document.createElement('li');
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'mb-thread' + (t.read ? '' : ' unread') + (state.thread && state.thread.id === t.id ? ' selected' : '');
            var who = state.folder === 'sent'
                ? 'To: ' + (t.to || []).map(displayName).join(', ')
                : displayName(t.from);
            var from = document.createElement('span');
            from.className = 'from';
            from.textContent = who + (t.emailCount > 1 ? ' (' + t.emailCount + ')' : '');
            var when = document.createElement('span');
            when.className = 'when';
            when.textContent = (t.hasAttachment ? '📎 ' : '') + shortDate(t.receivedAt);
            var subj = document.createElement('span');
            subj.className = 'subj';
            subj.textContent = t.subject;
            btn.appendChild(from);
            btn.appendChild(when);
            btn.appendChild(subj);
            btn.setAttribute('aria-label', (t.read ? '' : 'Unread. ') + who + '. ' + t.subject + '. ' + shortDate(t.receivedAt));
            btn.addEventListener('click', function() { openThread(t.id); });
            li.appendChild(btn);
            list.appendChild(li);
        });
        $('loadMoreRow').hidden = !state.hasMore;
    }

    function setFolder(folder) {
        state.folder = folder;
        state.query = '';
        $('searchInput').value = '';
        document.querySelectorAll('.mb-folder').forEach(function(b) {
            var on = b.dataset.folder === folder;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        closeReading();
        loadThreads(false);
    }

    // ---- Reading a conversation ------------------------------------------------

    function closeReading() {
        state.thread = null;
        $('layout').classList.remove('reading');
        $('readContent').hidden = true;
        $('readPlaceholder').hidden = false;
        document.querySelectorAll('.mb-thread.selected').forEach(function(b) { b.classList.remove('selected'); });
    }

    async function openThread(id) {
        $('layout').classList.add('reading');
        $('readPlaceholder').hidden = true;
        $('readContent').hidden = false;
        $('readSubject').textContent = 'Loading...';
        $('readMessages').innerHTML = '';
        $('readActions').innerHTML = '';
        document.querySelectorAll('.mb-thread').forEach(function(b, i) {
            b.classList.toggle('selected', state.threads[i] && state.threads[i].id === id);
        });
        try {
            var data = await apiGet({ op: 'thread', id: id });
            state.thread = { id: id, subject: data.thread.subject, folder: data.thread.folder || state.folder, emails: data.emails, sentBy: data.sentBy || {} };
            var t = state.threads.filter(function(x) { return x.id === id; })[0];
            if (t && !t.read) { t.read = true; renderThreads(); refreshUnread(); }
            renderThread();
            $('readSubject').focus({ preventScroll: true });
        } catch (err) {
            $('readSubject').textContent = "Couldn't open this conversation";
            var p = document.createElement('p');
            p.className = 'mb-empty';
            p.textContent = err.message;
            $('readMessages').appendChild(p);
        }
    }

    function actionButton(label, onClick) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'mb-icon-btn';
        b.textContent = label;
        b.addEventListener('click', onClick);
        $('readActions').appendChild(b);
        return b;
    }

    function renderThread() {
        var th = state.thread;
        $('readSubject').textContent = th.subject;
        $('readActions').innerHTML = '';
        var folder = th.folder || state.folder;
        if (folder === 'inbox') {
            actionButton('🗄 Archive', function() { moveThread('archive', 'Archived.'); });
            actionButton('🚫 Spam', function() { moveThread('spam', 'Moved to Spam.'); });
            actionButton('🗑 Bin', function() { moveThread('trash', 'Moved to the Bin.'); });
            actionButton('✉️ Mark unread', markUnread);
        } else if (folder === 'spam') {
            actionButton('✅ Not spam', function() { moveThread('inbox', 'Moved to the Inbox.'); });
            actionButton('🗑 Bin', function() { moveThread('trash', 'Moved to the Bin.'); });
        } else if (folder === 'trash') {
            actionButton('📥 Move to Inbox', function() { moveThread('inbox', 'Moved to the Inbox.'); });
        } else if (folder === 'archive') {
            actionButton('📥 Move to Inbox', function() { moveThread('inbox', 'Moved to the Inbox.'); });
            actionButton('🗑 Bin', function() { moveThread('trash', 'Moved to the Bin.'); });
        } else {
            actionButton('🗑 Bin', function() { moveThread('trash', 'Moved to the Bin.'); });
        }

        var box = $('readMessages');
        box.innerHTML = '';
        // Newest first (volunteer feedback). th.emails stays oldest-first,
        // which replyTarget() and forwarding rely on.
        th.emails.slice().reverse().forEach(function(e) { box.appendChild(renderMessage(e)); });
        var hasEmails = th.emails.length > 0;
        $('replyBtn').disabled = !hasEmails;
        $('replyAllBtn').disabled = !hasEmails;
        $('forwardBtn').disabled = !hasEmails;
    }

    function renderMessage(e) {
        var wrap = document.createElement('article');
        wrap.className = 'mb-msg ' + (e.direction === 'outbound' ? 'outbound' : 'inbound');

        var head = document.createElement('div');
        head.className = 'mb-msg-head';
        var who = document.createElement('div');
        who.className = 'who';
        who.textContent = e.direction === 'outbound' ? 'From ' + (state.address || 'us') : e.from;
        head.appendChild(who);
        var meta = document.createElement('div');
        meta.className = 'meta';
        var lines = ['To: ' + (e.to || []).join(', ')];
        if (e.cc && e.cc.length) lines.push('Cc: ' + e.cc.join(', '));
        if (e.bcc && e.bcc.length) lines.push('Bcc: ' + e.bcc.join(', '));
        lines.push(fullDate(e.receivedAt));
        meta.textContent = lines.join(' · ');
        head.appendChild(meta);
        if (e.direction === 'outbound') {
            var by = document.createElement('span');
            by.className = 'mb-sentby';
            var info = state.thread.sentBy[e.id];
            by.textContent = info && info.name ? 'Sent by ' + info.name : 'Sent from the mailbox';
            head.appendChild(by);
        }
        wrap.appendChild(head);

        if (e.html) {
            var remote = hasRemoteImages(e.html);
            var allow = !!state.showImages[e.id];
            if (remote && !allow) {
                var note = document.createElement('div');
                note.className = 'mb-images-note';
                var span = document.createElement('span');
                span.textContent = 'Pictures from the web are hidden to protect your privacy.';
                var show = document.createElement('button');
                show.type = 'button';
                show.className = 'mb-icon-btn';
                show.textContent = 'Show pictures';
                show.addEventListener('click', function() {
                    state.showImages[e.id] = true;
                    wrap.parentNode.replaceChild(renderMessage(e), wrap);
                });
                note.appendChild(span);
                note.appendChild(show);
                wrap.appendChild(note);
            }
            var body = document.createElement('div');
            body.className = 'mb-msg-body';
            body.appendChild(emailFrame(e.html, allow));
            wrap.appendChild(body);
        } else {
            var textBody = document.createElement('div');
            textBody.className = 'mb-msg-body mb-msg-text';
            textBody.textContent = e.text || '(No message text)';
            wrap.appendChild(textBody);
        }

        if (e.attachments && e.attachments.length) {
            var atts = document.createElement('div');
            atts.className = 'mb-attachments';
            e.attachments.forEach(function(a) {
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'mb-attachment';
                b.textContent = '📎 ' + a.filename + (a.size ? ' (' + formatSize(a.size) + ')' : '');
                b.title = 'Open ' + a.filename;
                b.addEventListener('click', function() { openAttachment(e, a, b); });
                atts.appendChild(b);
            });
            wrap.appendChild(atts);
        }
        return wrap;
    }

    // Received HTML is shown in a sandboxed frame: no scripts, no forms, no
    // plugins, links open in a new tab, and (until "Show pictures") nothing
    // is loaded from the web, so senders can't track when it's read.
    // allow-same-origin is only there so this page can measure the frame's
    // height; without allow-scripts nothing inside can run.
    var STRIP_TAGS = 'script,noscript,iframe,frame,frameset,object,embed,applet,form,input,button,select,textarea,link,meta,base,template,portal';

    function cleanReceivedHtml(html) {
        var doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
        doc.querySelectorAll(STRIP_TAGS).forEach(function(n) { n.remove(); });
        doc.querySelectorAll('*').forEach(function(el) {
            Array.prototype.slice.call(el.attributes).forEach(function(attr) {
                var name = attr.name.toLowerCase();
                var value = String(attr.value || '').trim().toLowerCase();
                if (name.indexOf('on') === 0) el.removeAttribute(attr.name);
                else if ((name === 'href' || name === 'src' || name === 'action' || name === 'xlink:href' || name === 'formaction') &&
                    /^(javascript|vbscript):/.test(value.replace(/\s+/g, ''))) el.removeAttribute(attr.name);
            });
        });
        doc.querySelectorAll('a[href]').forEach(function(a) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); });
        var styles = Array.prototype.map.call(doc.querySelectorAll('style'), function(s) { return s.outerHTML; }).join('');
        doc.querySelectorAll('style').forEach(function(s) { s.remove(); });
        return styles + (doc.body ? doc.body.innerHTML : '');
    }

    function hasRemoteImages(html) {
        return /(src|background)\s*=\s*["']?\s*(https?:)?\/\//i.test(html) || /url\(\s*["']?\s*(https?:)?\/\//i.test(html);
    }

    function emailFrame(html, allowRemote) {
        var iframe = document.createElement('iframe');
        iframe.setAttribute('sandbox', 'allow-same-origin allow-popups allow-popups-to-escape-sandbox');
        iframe.setAttribute('referrerpolicy', 'no-referrer');
        iframe.setAttribute('title', 'Email message');
        var csp = "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data: cid:" + (allowRemote ? ' https: http:' : '');
        iframe.srcdoc =
            '<!doctype html><html><head><meta charset="utf-8">' +
            '<meta http-equiv="Content-Security-Policy" content="' + csp + '">' +
            '<base target="_blank">' +
            '<style>html,body{margin:0;padding:0;}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:15px;line-height:1.5;color:#24272E;overflow-wrap:anywhere;}img{max-width:100%;height:auto;}table{max-width:100%;}pre{white-space:pre-wrap;}blockquote{margin:0.5em 0;padding-left:0.75em;border-left:3px solid #E7E2D9;color:#5B6169;}</style>' +
            '</head><body>' + cleanReceivedHtml(html) + '</body></html>';
        function fit() {
            try {
                var d = iframe.contentDocument;
                if (d && d.documentElement) iframe.style.height = Math.max(60, d.documentElement.scrollHeight + 4) + 'px';
            } catch (e) { iframe.style.height = '480px'; }
        }
        iframe.addEventListener('load', function() {
            fit();
            try {
                iframe.contentDocument.querySelectorAll('img').forEach(function(img) {
                    if (!img.complete) img.addEventListener('load', fit);
                });
            } catch (e) { /* height stays as measured */ }
            setTimeout(fit, 400);
        });
        return iframe;
    }

    async function openAttachment(email, att, btn) {
        // Open the tab straight away (inside the click) so pop-up blockers
        // allow it, then point it at the short-lived download link.
        var win = window.open('', '_blank');
        btn.disabled = true;
        try {
            var data = await apiGet({ op: 'attachment', emailId: email.id, attachmentId: att.id, direction: email.direction });
            if (win) { win.opener = null; win.location.href = data.url; }
            else window.location.href = data.url;
        } catch (err) {
            if (win) win.close();
            showToast("Couldn't open that attachment: " + err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    async function moveThread(folder, message) {
        if (!state.thread) return;
        var id = state.thread.id;
        try {
            await apiPost({ op: 'move', threadId: id, folder: folder });
            showToast(message);
            state.threads = state.threads.filter(function(t) { return t.id !== id; });
            closeReading();
            renderThreads();
            refreshUnread();
        } catch (err) {
            showToast("Couldn't move it: " + err.message, 'error');
        }
    }

    async function markUnread() {
        if (!state.thread) return;
        var id = state.thread.id;
        try {
            await apiPost({ op: 'read', threadId: id, read: false });
            state.threads.forEach(function(t) { if (t.id === id) t.read = false; });
            closeReading();
            renderThreads();
            refreshUnread();
        } catch (err) {
            showToast("Couldn't mark it unread: " + err.message, 'error');
        }
    }

    async function refreshUnread() {
        try {
            var s = await apiGet({ op: 'summary' });
            setUnread(s.unread);
        } catch (e) { /* not important */ }
    }

    // ---- Compose / reply / forward -------------------------------------------

    function signatureHtml() {
        var first = state.me && state.me.name ? escapeHtml(String(state.me.name).split(' ')[0]) : '';
        return '<p><br></p><p>' + (first ? first + '<br>' : '') + 'Santa Super Sleigh Salford<br>100th Salford (St Luke\'s) Scout Group</p>';
    }

    function messageText(e) {
        if (e.text) return e.text;
        var doc = new DOMParser().parseFromString(cleanReceivedHtml(e.html || ''), 'text/html');
        doc.querySelectorAll('style').forEach(function(s) { s.remove(); });
        doc.querySelectorAll('br').forEach(function(br) { br.replaceWith('\n'); });
        doc.querySelectorAll('p,div,li,tr,h1,h2,h3').forEach(function(n) { n.append('\n'); });
        return (doc.body ? doc.body.textContent : '').replace(/\n{3,}/g, '\n\n').trim();
    }

    function quoteHtml(e, forwarding) {
        var text = messageText(e);
        if (text.length > 20000) text = text.slice(0, 20000) + '\n[…]';
        var header = forwarding
            ? '<p>---------- Forwarded message ----------<br>From: ' + escapeHtml(e.from) + '<br>Date: ' + escapeHtml(fullDate(e.receivedAt)) +
              '<br>Subject: ' + escapeHtml(e.subject || state.thread.subject) + '<br>To: ' + escapeHtml((e.to || []).join(', ')) + '</p>'
            : '<p>On ' + escapeHtml(fullDate(e.receivedAt)) + ', ' + escapeHtml(e.direction === 'outbound' ? state.address : e.from) + ' wrote:</p>';
        return header + '<blockquote>' + escapeHtml(text).replace(/\n/g, '<br>') + '</blockquote>';
    }

    function withPrefix(prefix, subject) {
        var s = String(subject || '').trim();
        var re = new RegExp('^' + prefix + ':\\s', 'i');
        return re.test(s) ? s : prefix + ': ' + s;
    }

    // Reply to the newest message someone sent us (or the newest message if
    // the thread only has ours).
    function replyTarget() {
        var emails = state.thread ? state.thread.emails : [];
        for (var i = emails.length - 1; i >= 0; i--) if (emails[i].direction === 'inbound') return emails[i];
        return emails[emails.length - 1] || null;
    }

    function openCompose(mode) {
        var target = mode === 'new' ? null : (mode === 'forward' ? state.thread.emails[state.thread.emails.length - 1] : replyTarget());
        if (mode !== 'new' && !target) return;
        state.compose = { mode: mode, target: target, threadId: state.thread ? state.thread.id : null, requestId: newRequestId() };
        state.files = [];
        renderFiles();
        $('composeError').textContent = '';
        $('toInput').value = '';
        $('ccInput').value = '';
        $('bccInput').value = '';
        $('ccRow').hidden = true;
        $('bccRow').hidden = true;
        $('showCcBtn').hidden = false;

        var titles = { 'new': 'New email', reply: 'Reply', replyAll: 'Reply all', forward: 'Forward' };
        $('composeTitle').textContent = titles[mode];
        var context = $('composeContext');
        var editor = $('editor');

        if (mode === 'new') {
            context.hidden = true;
            $('toRow').hidden = false;
            $('subjectRow').hidden = false;
            $('subjectInput').value = '';
            editor.innerHTML = signatureHtml();
        } else if (mode === 'forward') {
            context.hidden = false;
            context.textContent = 'Forwarding "' + state.thread.subject + '"' + (target.attachments && target.attachments.length ? ' with its attachments' : '') + '.';
            $('toRow').hidden = false;
            $('subjectRow').hidden = false;
            $('subjectInput').value = withPrefix('Fwd', target.subject || state.thread.subject);
            editor.innerHTML = signatureHtml() + quoteHtml(target, true);
        } else {
            context.hidden = false;
            $('toRow').hidden = true;
            $('subjectRow').hidden = true;
            $('subjectInput').value = withPrefix('Re', target.subject || state.thread.subject);
            var main = target.direction === 'outbound' ? (target.to || []) : [(target.replyTo && target.replyTo[0]) || target.from];
            var others = mode === 'replyAll'
                ? (target.direction === 'outbound' ? (target.cc || []) : (target.to || []).concat(target.cc || []))
                : [];
            var everyone = main.concat(others).filter(function(a) { return a && !isOurAddress(a); });
            var seen = {};
            everyone = everyone.filter(function(a) { var k = parseAddress(a).email.toLowerCase(); if (seen[k]) return false; seen[k] = true; return true; });
            context.textContent = (mode === 'replyAll' ? 'Replying to all: ' : 'Replying to: ') + (everyone.map(displayName).join(', ') || 'the sender');
            editor.innerHTML = signatureHtml() + quoteHtml(target, false);
        }

        $('senderNote').textContent = 'Sends from ' + state.address + '. Your name (' + (state.me && state.me.name || 'you') + ') is recorded as the sender for the team.';
        $('composeOverlay').classList.add('open');
        document.body.style.overflow = 'hidden';
        setTimeout(function() {
            if (mode === 'new' || mode === 'forward') $('toInput').focus();
            else focusEditorStart();
        }, 30);
    }

    function focusEditorStart() {
        var editor = $('editor');
        editor.focus();
        var range = document.createRange();
        range.setStart(editor, 0);
        range.collapse(true);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }

    function composeDirty() {
        if (!state.compose) return false;
        return !!($('toInput').value.trim() || $('ccInput').value.trim() || state.files.length ||
            (state.compose.mode === 'new' && ($('subjectInput').value.trim() || $('editor').textContent.replace(/\s+/g, ' ').trim().length > 80)));
    }

    function closeCompose(force) {
        if (!state.compose) return;
        if (!force && state.sending) return;
        if (!force && composeDirty() && !confirm('Discard this email?')) return;
        state.compose = null;
        state.files = [];
        $('composeOverlay').classList.remove('open');
        document.body.style.overflow = '';
    }

    // Only simple formatting goes out: everything else is unwrapped and
    // every attribute except a link's href is dropped.
    var KEEP_TAGS = { P: 1, BR: 1, B: 1, STRONG: 1, I: 1, EM: 1, U: 1, UL: 1, OL: 1, LI: 1, A: 1, BLOCKQUOTE: 1, DIV: 1, H1: 1, H2: 1, H3: 1 };
    var DROP_TAGS = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, FORM: 1, INPUT: 1, BUTTON: 1, SELECT: 1, TEXTAREA: 1, META: 1, LINK: 1, BASE: 1, SVG: 1, MATH: 1, TEMPLATE: 1, IMG: 1, VIDEO: 1, AUDIO: 1 };

    function cleanComposeHtml(html) {
        var doc = new DOMParser().parseFromString('<div id="root">' + html + '</div>', 'text/html');
        var root = doc.getElementById('root');
        (function walk(node) {
            Array.prototype.slice.call(node.childNodes).forEach(function(child) {
                if (child.nodeType === 8) { child.remove(); return; }
                if (child.nodeType !== 1) return;
                var tag = child.tagName;
                if (DROP_TAGS[tag]) { child.remove(); return; }
                walk(child);
                if (!KEEP_TAGS[tag]) {
                    while (child.firstChild) child.parentNode.insertBefore(child.firstChild, child);
                    child.remove();
                    return;
                }
                var href = tag === 'A' ? (child.getAttribute('href') || '') : '';
                Array.prototype.slice.call(child.attributes).forEach(function(a) { child.removeAttribute(a.name); });
                if (tag === 'A') {
                    if (/^(https?:|mailto:)/i.test(href.trim())) child.setAttribute('href', href.trim());
                }
                if (tag === 'BLOCKQUOTE') child.setAttribute('style', 'margin:0 0 0 0.5em;padding-left:0.75em;border-left:3px solid #ccc;color:#555;');
            });
        })(root);
        return root.innerHTML;
    }

    function renderFiles() {
        var list = $('fileList');
        list.innerHTML = '';
        var total = 0;
        state.files.forEach(function(f, i) {
            total += f.size;
            var li = document.createElement('li');
            var name = document.createElement('span');
            name.textContent = '📎 ' + f.name + ' (' + formatSize(f.size) + ')';
            var rm = document.createElement('button');
            rm.type = 'button';
            rm.className = 'mb-btn quiet';
            rm.textContent = '✕';
            rm.setAttribute('aria-label', 'Remove ' + f.name);
            rm.addEventListener('click', function() { state.files.splice(i, 1); renderFiles(); });
            li.appendChild(name);
            li.appendChild(rm);
            list.appendChild(li);
        });
        $('fileTotal').textContent = state.files.length
            ? formatSize(total) + ' of 4 MB used.'
            : 'Up to 4 MB in total.';
    }

    function readFile(file) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function() { resolve(String(reader.result).replace(/^data:[^,]*,/, '')); };
            reader.onerror = function() { reject(new Error("Couldn't read " + file.name)); };
            reader.readAsDataURL(file);
        });
    }

    async function addFiles(fileList) {
        var files = Array.prototype.slice.call(fileList || []);
        var total = state.files.reduce(function(s, f) { return s + f.size; }, 0);
        for (var i = 0; i < files.length; i++) {
            var file = files[i];
            if (state.files.length >= MAX_FILES) { showToast('You can attach up to ' + MAX_FILES + ' files.', 'error'); break; }
            if (!file.size) { showToast(file.name + ' is empty.', 'error'); continue; }
            if (total + file.size > MAX_BYTES) { showToast(file.name + " is too big: attachments can be up to 4 MB in total.", 'error'); continue; }
            try {
                var content = await readFile(file);
                state.files.push({ name: file.name, type: file.type || 'application/octet-stream', size: file.size, content: content });
                total += file.size;
            } catch (err) {
                showToast(err.message, 'error');
            }
        }
        renderFiles();
    }

    async function send() {
        if (!state.compose || state.sending) return;
        var c = state.compose;
        var err = $('composeError');
        err.textContent = '';
        var html = cleanComposeHtml($('editor').innerHTML);
        var body = {
            op: c.mode === 'new' ? 'send' : (c.mode === 'forward' ? 'forward' : 'reply'),
            requestId: c.requestId,
            cc: $('ccInput').value,
            bcc: $('bccInput').value,
            html: html,
            attachments: state.files.map(function(f) { return { filename: f.name, contentType: f.type, content: f.content }; })
        };
        if (c.mode === 'new' || c.mode === 'forward') {
            body.to = $('toInput').value;
            if (!body.to.trim()) { err.textContent = 'Add at least one To address.'; $('toInput').focus(); return; }
        }
        if (c.mode === 'new') {
            body.subject = $('subjectInput').value.trim();
            if (!body.subject) { err.textContent = 'Add a subject.'; $('subjectInput').focus(); return; }
        } else {
            body.threadId = c.threadId;
            body.emailId = c.target.id;
            body.subject = $('subjectInput').value.trim() || undefined;
            if (c.mode === 'replyAll') body.replyAll = true;
        }

        state.sending = true;
        $('sendBtn').disabled = true;
        $('sendBtn').textContent = 'Sending...';
        try {
            await apiPost(body);
            var wasThread = c.threadId;
            closeCompose(true);
            showToast('Sent.');
            if (wasThread && state.thread && state.thread.id === wasThread) openThread(wasThread);
            if (state.folder === 'sent' || c.mode === 'new') loadThreads(false, true);
        } catch (e) {
            err.textContent = e.message;
        } finally {
            state.sending = false;
            $('sendBtn').disabled = false;
            $('sendBtn').textContent = 'Send';
        }
    }

    // ---- Wiring ------------------------------------------------------------------

    document.querySelectorAll('.mb-folder').forEach(function(b) {
        b.addEventListener('click', function() { setFolder(b.dataset.folder); });
    });
    $('searchForm').addEventListener('submit', function(e) {
        e.preventDefault();
        state.query = $('searchInput').value.trim();
        closeReading();
        loadThreads(false);
    });
    $('loadMoreBtn').addEventListener('click', function() { loadThreads(true); });
    $('refreshBtn').addEventListener('click', function() { loadThreads(false); refreshUnread(); });
    $('readBackBtn').addEventListener('click', closeReading);
    $('newEmailBtn').addEventListener('click', function() { openCompose('new'); });
    $('replyBtn').addEventListener('click', function() { openCompose('reply'); });
    $('replyAllBtn').addEventListener('click', function() { openCompose('replyAll'); });
    $('forwardBtn').addEventListener('click', function() { openCompose('forward'); });
    $('composeCloseBtn').addEventListener('click', function() { closeCompose(false); });
    $('composeCancelBtn').addEventListener('click', function() { closeCompose(false); });
    $('sendBtn').addEventListener('click', send);
    $('showCcBtn').addEventListener('click', function() {
        $('ccRow').hidden = false;
        $('bccRow').hidden = false;
        $('showCcBtn').hidden = true;
        $('ccInput').focus();
    });
    $('fileInput').addEventListener('change', function(e) {
        addFiles(e.target.files);
        e.target.value = '';
    });

    $('toolbar').addEventListener('mousedown', function(e) { if (e.target.closest('button')) e.preventDefault(); });
    $('toolbar').addEventListener('click', function(e) {
        var btn = e.target.closest('button');
        if (!btn) return;
        var cmd = btn.dataset.cmd;
        $('editor').focus();
        if (cmd === 'createLink') {
            var url = prompt('Link address (https://...)', 'https://');
            if (!url || !/^(https?:\/\/|mailto:)/i.test(url.trim())) return;
            document.execCommand('createLink', false, url.trim());
        } else {
            document.execCommand(cmd, false, null);
        }
    });

    $('alertsToggle').addEventListener('change', async function(e) {
        var on = e.target.checked;
        try {
            await apiPost({ op: 'alerts', enabled: on });
            showToast(on ? "You'll get an email when new mail arrives." : 'New mail alerts turned off.');
        } catch (err) {
            e.target.checked = !on;
            showToast("Couldn't save that: " + err.message, 'error');
        }
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && state.compose) closeCompose(false);
    });
    window.addEventListener('beforeunload', function(e) {
        if (composeDirty()) { e.preventDefault(); e.returnValue = ''; }
    });

    // Quietly refresh the list every minute while the page is open.
    setInterval(function() {
        if (!state.started || state.compose || document.hidden) return;
        loadThreads(false, true);
        refreshUnread();
    }, POLL_MS);

    $('gateLoginBtn').addEventListener('click', function() { netlifyIdentity.open('login'); });

    netlifyIdentity.on('init', function(user) {
        if (user) start();
        else showGate('Please log in to use the mailbox.', true, false);
    });
    netlifyIdentity.on('login', function() { netlifyIdentity.close(); start(); });
    netlifyIdentity.on('logout', function() {
        state.started = false;
        closeCompose(true);
        showGate('You\'ve logged out.', true, false);
    });
    // The widget calls netlifyIdentity.init() itself on DOMContentLoaded --
    // don't call it again (see the note at the end of volunteer.html).
})();
