// Shared helpers for the hello@ mailbox in the volunteer portal.
//
// The mail lives in a Resend Inbox (threads, folders, attachments); the
// portal is a thin client over Resend's Inboxes API. Nothing about the
// messages themselves is stored in our database -- only which volunteer
// sent what (mailbox_sent_log), because the shared inbox can't tell
// people apart.
//
// Env vars (Netlify, server-side only):
//   RESEND_INBOX_API_KEY -- optional. A Resend key with *full access*.
//                           Falls back to RESEND_API_KEY, but a
//                           "sending access" key can't read inboxes.
//   MAILBOX_ADDRESS      -- optional, defaults to hello@santasleighsalford.co.uk.
//
// The pure functions at the bottom (address parsing, HTML clean-up,
// attachment checks) are covered by tests/mailbox.test.mjs.

export const MAILBOX_ADDRESS = (process.env.MAILBOX_ADDRESS || 'hello@santasleighsalford.co.uk').trim().toLowerCase();

// Netlify buffers function requests at 6 MB, and attachments arrive as
// base64 (about a third bigger), so 4 MB of files is the safe ceiling.
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;
export const MAX_RECIPIENTS = 50;
export const FOLDERS = ['inbox', 'sent', 'archive', 'spam', 'trash'];
export const MOVE_FOLDERS = ['inbox', 'archive', 'spam', 'trash'];

export class MailboxError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 500;
  }
}

function apiKey() {
  return process.env.RESEND_INBOX_API_KEY || process.env.RESEND_API_KEY || '';
}

export function mailboxConfigured() {
  return !!apiKey();
}

function inboxPath() {
  return '/inboxes/' + encodeURIComponent(MAILBOX_ADDRESS);
}

// Calls the Resend API and returns parsed JSON, or throws a MailboxError
// with a message the portal can show as-is.
export async function resendApi(method, path, body, extraHeaders) {
  const key = apiKey();
  if (!key) throw new MailboxError('The mailbox isn\'t connected yet (no Resend API key). Please ask the team.', 503);
  const res = await fetch('https://api.resend.com' + path, {
    method,
    headers: Object.assign({
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'User-Agent': 'santa-sleigh-portal-mailbox'
    }, extraHeaders || {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
  if (!res.ok) {
    const detail = (data && (data.message || data.error)) || text || ('HTTP ' + res.status);
    console.error('mailbox: Resend ' + method + ' ' + path.replace(/\?.*$/, '') + ' -> ' + res.status + ': ' + String(detail).slice(0, 300));
    if (res.status === 401 || res.status === 403) {
      throw new MailboxError('The mailbox\'s Resend key can\'t open the inbox. It needs a full-access key (RESEND_INBOX_API_KEY).', 503);
    }
    if (res.status === 404) throw new MailboxError('That message or inbox couldn\'t be found. It may have been deleted.', 404);
    if (res.status === 422 || res.status === 400) throw new MailboxError(String(detail), 400);
    if (res.status === 429) throw new MailboxError('Too many requests to the mail service just now. Please wait a moment and try again.', 429);
    throw new MailboxError('The mail service had a problem (' + res.status + '). Please try again.', 502);
  }
  return data;
}

function query(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = sp.toString();
  return s ? '?' + s : '';
}

// ---- Inbox API wrappers ----------------------------------------------------

export function getInbox() {
  return resendApi('GET', inboxPath());
}

export function listThreads({ folder, read, limit, after, before }) {
  return resendApi('GET', inboxPath() + '/threads' + query({ folders: folder ? [folder] : undefined, read, limit, after, before }));
}

export function searchThreads({ folder, q, limit, after, before }) {
  return resendApi('GET', inboxPath() + '/threads/search' + query({ folders: folder ? [folder] : undefined, query: q, limit, after, before }));
}

export function getThread(threadId) {
  return resendApi('GET', inboxPath() + '/threads/' + encodeURIComponent(threadId));
}

export function listThreadEmails(threadId) {
  return resendApi('GET', inboxPath() + '/threads/' + encodeURIComponent(threadId) + '/emails' + query({ limit: 100 }));
}

export function updateThread(threadId, patch) {
  return resendApi('PATCH', inboxPath() + '/threads/' + encodeURIComponent(threadId), patch);
}

function idem(key) {
  return key ? { 'Idempotency-Key': String(key).slice(0, 256) } : undefined;
}

// A brand-new email from the inbox: create a draft, then send it, so it
// lands in the inbox's Sent folder and replies thread onto it.
export async function sendNew({ to, cc, bcc, subject, html, text, attachments, idempotencyKey }) {
  const draft = await resendApi('POST', inboxPath() + '/drafts', {
    to, cc, bcc, subject, html, text,
    attachments: attachments && attachments.length ? attachments : undefined
  }, idem(idempotencyKey && idempotencyKey + ':draft'));
  const sent = await resendApi('POST', inboxPath() + '/drafts/' + encodeURIComponent(draft.id) + '/send', undefined, idem(idempotencyKey && idempotencyKey + ':send'));
  return { emailId: sent && sent.id };
}

export async function replyTo({ threadId, emailId, replyAll, cc, bcc, subject, html, text, attachments, idempotencyKey }) {
  const res = await resendApi('POST',
    inboxPath() + '/threads/' + encodeURIComponent(threadId) + '/emails/' + encodeURIComponent(emailId) + '/reply',
    { reply_all: !!replyAll, cc, bcc, subject, html, text, attachments: attachments && attachments.length ? attachments : undefined },
    idem(idempotencyKey));
  return { emailId: res && res.id };
}

export async function forward({ threadId, emailId, to, cc, bcc, subject, html, text, attachments, idempotencyKey }) {
  const res = await resendApi('POST',
    inboxPath() + '/threads/' + encodeURIComponent(threadId) + '/emails/' + encodeURIComponent(emailId) + '/forward',
    { to, cc, bcc, subject, html, text, attachments: attachments && attachments.length ? attachments : undefined },
    idem(idempotencyKey));
  return { emailId: res && res.id };
}

// Attachment download links. Resend's docs don't name an Inboxes-specific
// attachment endpoint; received mail uses the Receiving attachments API
// and sent mail the Emails attachments API, both of which return a
// short-lived signed download_url.
export async function attachmentLink(emailId, attachmentId, direction) {
  const base = direction === 'outbound' ? '/emails/' : '/emails/receiving/';
  const data = await resendApi('GET', base + encodeURIComponent(emailId) + '/attachments/' + encodeURIComponent(attachmentId));
  if (!data || !data.download_url) throw new MailboxError('That attachment isn\'t available to download.', 404);
  return { url: data.download_url, filename: data.filename || null, expiresAt: data.expires_at || null };
}

// ---- Access ----------------------------------------------------------------

// Mailbox access = an approved, non-guest volunteer with mailbox_access on.
// Returns { allowed, volunteer } where volunteer has id/full_name/email.
export async function getMailboxAccess(db, user) {
  if (!user) return { allowed: false, volunteer: null };
  const rows = await db.sql`
    SELECT id, full_name, email, preferred_email, approval_status, is_guest, mailbox_access, mailbox_alerts
    FROM volunteers WHERE identity_user_id = ${user.id}
  `;
  if (!rows.length) return { allowed: false, volunteer: null };
  const v = rows[0];
  const allowed = !!v.mailbox_access && !v.is_guest && v.approval_status === 'approved';
  return { allowed, volunteer: v };
}

// ---- Pure helpers (tested) -------------------------------------------------

const EMAIL_RE = /^[^\s@<>(),;:"\[\]]+@[^\s@<>(),;:"\[\]]+\.[^\s@<>(),;:"\[\]]{2,}$/;

// "a@x.com, Bob <b@y.org>; c@z.net" -> { list: [...], invalid: [...] }
// Accepts a string or an array of strings. De-duplicates, case-insensitively.
export function parseAddressList(input) {
  const parts = (Array.isArray(input) ? input : [input])
    .flatMap((s) => String(s == null ? '' : s).split(/[,;\n]+/))
    .map((s) => s.trim())
    .filter(Boolean);
  const list = [];
  const invalid = [];
  const seen = new Set();
  for (const part of parts) {
    const m = part.match(/<([^<>]+)>\s*$/);
    const addr = (m ? m[1] : part).trim().replace(/^mailto:/i, '');
    if (!EMAIL_RE.test(addr)) { invalid.push(part); continue; }
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(addr);
  }
  return { list, invalid };
}

// Light server-side clean-up of HTML written in the portal's editor before
// it's emailed out. The browser already builds this from an allow-list;
// this is a backstop that removes anything active (scripts, embeds, event
// handlers, javascript: links). Recipients' mail apps sanitise again.
export function cleanOutboundHtml(html) {
  let s = String(html == null ? '' : html);
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style|iframe|object|embed|noscript|template|svg|math|form|textarea|select|button)\b[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<\/?(script|style|iframe|object|embed|noscript|template|svg|math|form|input|textarea|select|button|link|meta|base|frame|frameset)\b[^>]*>/gi, '');
  s = s.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/\s+(href|src|action|formaction|xlink:href)\s*=\s*("|')?\s*(javascript|vbscript|data):[^"'\s>]*\2?/gi, '');
  s = s.replace(/\s+style\s*=\s*("[^"]*expression\([^"]*"|'[^']*expression\([^']*')/gi, '');
  return s.trim();
}

// Plain-text version for the text/plain part of the email.
export function htmlToText(html) {
  return String(html == null ? '' : html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, label) => {
      const t = label.replace(/<[^>]+>/g, '').trim();
      return t && t !== href ? t + ' (' + href + ')' : href;
    })
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Size of base64 data once decoded.
export function base64Bytes(b64) {
  const s = String(b64 || '').replace(/\s+/g, '');
  if (!s) return 0;
  const pad = s.endsWith('==') ? 2 : (s.endsWith('=') ? 1 : 0);
  return Math.floor(s.length * 3 / 4) - pad;
}

// Validates the portal's attachments: [{ filename, contentType, content(base64) }].
// Returns { attachments } in Resend's shape, or { error }.
export function checkAttachments(input) {
  const items = Array.isArray(input) ? input : [];
  if (items.length > MAX_ATTACHMENTS) return { error: 'You can attach up to ' + MAX_ATTACHMENTS + ' files.' };
  let total = 0;
  const attachments = [];
  for (const a of items) {
    const content = String((a && a.content) || '').replace(/^data:[^,]*,/, '');
    if (!content || !/^[A-Za-z0-9+/=\s]+$/.test(content)) return { error: 'One of the attachments couldn\'t be read. Please attach it again.' };
    const bytes = base64Bytes(content);
    if (bytes === 0) return { error: 'One of the attachments is empty.' };
    total += bytes;
    const filename = String((a && a.filename) || 'attachment').replace(/[\\/\r\n\0"]+/g, '_').slice(0, 150) || 'attachment';
    const contentType = /^[\w.+-]+\/[\w.+-]+$/.test(String(a && a.contentType)) ? a.contentType : 'application/octet-stream';
    attachments.push({ filename, content, content_type: contentType });
  }
  if (total > MAX_ATTACHMENT_BYTES) return { error: 'Attachments can be up to 4 MB in total. Try fewer or smaller files.' };
  return { attachments };
}

export function isFolder(f) { return FOLDERS.includes(f); }
export function isMoveFolder(f) { return MOVE_FOLDERS.includes(f); }
