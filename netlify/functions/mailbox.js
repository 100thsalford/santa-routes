// The hello@ mailbox in the volunteer portal (mailbox.html).
//
// Only volunteers an admin has given mailbox access (volunteers.
// mailbox_access) can use it; that's checked on every call, so removing
// access takes effect straight away. The mail itself lives in a Resend
// Inbox -- see netlify/lib/mailbox.js.
//
// GET  ?op=summary                         -> { address, unread, alerts }
// GET  ?op=threads&folder=inbox[&q=][&after=|&before=] -> { threads, hasMore }
// GET  ?op=thread&id=                      -> { thread, emails, sentBy }
//                                             (also marks it read)
// GET  ?op=attachment&emailId=&attachmentId=&direction= -> { url, filename }
// POST { op: 'send', to, cc, bcc, subject, html, attachments, requestId }
// POST { op: 'reply', threadId, emailId, replyAll, cc, bcc, html, attachments, requestId }
// POST { op: 'forward', threadId, emailId, to, cc, bcc, html, attachments, requestId }
// POST { op: 'move', threadId, folder }
// POST { op: 'read', threadId, read }
// POST { op: 'alerts', enabled }
//
// Every email sent is logged in mailbox_sent_log with the volunteer's name,
// so the thread view can show "Sent by ...".

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import {
  MAILBOX_ADDRESS, MAX_RECIPIENTS, MailboxError,
  getMailboxAccess, getInbox, listThreads, searchThreads, getThread, listThreadEmails, updateThread,
  sendNew, replyTo, forward, attachmentLink,
  parseAddressList, cleanOutboundHtml, htmlToText, checkAttachments, isFolder, isMoveFolder
} from '../lib/mailbox.js';

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers });
}

function cleanId(v) {
  const s = String(v == null ? '' : v).trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(s) ? s : '';
}

function recipients(body, field, required) {
  const { list, invalid } = parseAddressList(body[field] || []);
  const label = { to: 'To', cc: 'Cc', bcc: 'Bcc' }[field];
  if (invalid.length) throw new MailboxError('Check the ' + label + ' addresses: ' + invalid.slice(0, 3).join(', '), 400);
  if (required && !list.length) throw new MailboxError('Add at least one To address.', 400);
  return list;
}

function messageBody(body) {
  const html = cleanOutboundHtml(body.html);
  const text = htmlToText(html);
  if (!text && !/<img\b/i.test(html)) throw new MailboxError('Write a message first.', 400);
  return { html, text };
}

function attachmentsFrom(body) {
  const checked = checkAttachments(body.attachments);
  if (checked.error) throw new MailboxError(checked.error, 400);
  return checked.attachments;
}

async function logSent(db, volunteer, action, info) {
  try {
    await db.sql`
      INSERT INTO mailbox_sent_log (volunteer_id, sender_name, action, thread_id, email_id, subject, recipient_count)
      VALUES (${volunteer.id}, ${volunteer.full_name || volunteer.email || null}, ${action},
              ${info.threadId || null}, ${info.emailId || null}, ${info.subject ? String(info.subject).slice(0, 300) : null},
              ${info.recipientCount || 0})
    `;
  } catch (err) {
    // The email has gone; don't report a failure just because the log didn't save.
    console.error('mailbox: sent log failed:', err.message);
  }
}

function threadSummary(t) {
  return {
    id: t.id,
    subject: t.subject || '(no subject)',
    from: t.from || '',
    to: t.to || [],
    emailCount: t.email_count || 0,
    hasAttachment: !!t.has_attachment,
    read: !!t.read,
    receivedAt: t.received_at,
    folder: t.folder,
    labels: (t.labels || []).map((l) => ({ name: l.name, color: l.color }))
  };
}

function emailView(e) {
  return {
    id: e.id,
    direction: e.direction,
    from: e.from,
    to: e.to || [],
    cc: e.cc || [],
    bcc: e.bcc || [],
    replyTo: e.reply_to || [],
    subject: e.subject || '',
    html: e.html || null,
    text: e.text || null,
    attachments: (e.attachments || []).map((a) => ({ id: a.id, filename: a.filename || 'attachment', size: a.size || null })),
    receivedAt: e.received_at
  };
}

async function handleGet(req, db, access) {
  const url = new URL(req.url);
  const op = url.searchParams.get('op') || 'summary';

  if (op === 'summary') {
    const inbox = await getInbox();
    return json({
      address: inbox.email_address || MAILBOX_ADDRESS,
      fromName: inbox.from_name || null,
      unread: inbox.unread || 0,
      lastReceived: inbox.last_received || null,
      alerts: !!access.volunteer.mailbox_alerts
    });
  }

  if (op === 'threads') {
    const folder = url.searchParams.get('folder') || 'inbox';
    if (!isFolder(folder)) return json({ error: 'Unknown folder' }, 400);
    const q = (url.searchParams.get('q') || '').trim().slice(0, 200);
    const after = cleanId(url.searchParams.get('after')) || undefined;
    const before = cleanId(url.searchParams.get('before')) || undefined;
    const opts = { folder, limit: 25, after, before: after ? undefined : before };
    const data = q ? await searchThreads(Object.assign(opts, { q })) : await listThreads(opts);
    return json({
      threads: (data && data.data ? data.data : []).map(threadSummary),
      hasMore: !!(data && data.has_more)
    });
  }

  if (op === 'thread') {
    const id = cleanId(url.searchParams.get('id'));
    if (!id) return json({ error: 'Missing thread id' }, 400);
    const [thread, emails] = await Promise.all([getThread(id), listThreadEmails(id)]);
    const list = (emails && emails.data ? emails.data : [])
      .slice()
      .sort((a, b) => String(a.received_at).localeCompare(String(b.received_at)))
      .map(emailView);

    const emailIds = list.map((e) => e.id);
    const sentRows = emailIds.length ? await db.sql`
      SELECT email_id, sender_name, action FROM mailbox_sent_log WHERE email_id = ANY(${emailIds})
    ` : [];
    const sentBy = {};
    for (const r of sentRows) sentBy[r.email_id] = { name: r.sender_name, action: r.action };

    if (thread && !thread.read) {
      try { await updateThread(id, { read: true }); } catch (err) { console.error('mailbox: mark read failed:', err.message); }
    }
    return json({
      thread: { id, subject: (thread && thread.subject) || '(no subject)', folder: thread && thread.folder, read: true },
      emails: list,
      sentBy
    });
  }

  if (op === 'attachment') {
    const emailId = cleanId(url.searchParams.get('emailId'));
    const attachmentId = cleanId(url.searchParams.get('attachmentId'));
    const direction = url.searchParams.get('direction') === 'outbound' ? 'outbound' : 'inbound';
    if (!emailId || !attachmentId) return json({ error: 'Missing attachment id' }, 400);
    return json(await attachmentLink(emailId, attachmentId, direction));
  }

  return json({ error: 'Unknown request' }, 400);
}

async function handlePost(req, db, access) {
  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'Invalid request' }, 400); }
  const op = body && body.op;
  const v = access.volunteer;
  const requestId = cleanId(body.requestId) || undefined;

  if (op === 'send') {
    const to = recipients(body, 'to', true);
    const cc = recipients(body, 'cc');
    const bcc = recipients(body, 'bcc');
    if (to.length + cc.length + bcc.length > MAX_RECIPIENTS) throw new MailboxError('Up to ' + MAX_RECIPIENTS + ' recipients per email.', 400);
    const subject = String(body.subject || '').trim().slice(0, 300);
    if (!subject) throw new MailboxError('Add a subject.', 400);
    const { html, text } = messageBody(body);
    const attachments = attachmentsFrom(body);
    const result = await sendNew({ to, cc, bcc, subject, html, text, attachments, idempotencyKey: requestId });
    await logSent(db, v, 'send', { emailId: result.emailId, subject, recipientCount: to.length + cc.length + bcc.length });
    return json({ sent: true, emailId: result.emailId });
  }

  if (op === 'reply' || op === 'forward') {
    const threadId = cleanId(body.threadId);
    const emailId = cleanId(body.emailId);
    if (!threadId || !emailId) throw new MailboxError('Missing message id.', 400);
    const cc = recipients(body, 'cc');
    const bcc = recipients(body, 'bcc');
    const to = op === 'forward' ? recipients(body, 'to', true) : [];
    if (to.length + cc.length + bcc.length > MAX_RECIPIENTS) throw new MailboxError('Up to ' + MAX_RECIPIENTS + ' recipients per email.', 400);
    const { html, text } = messageBody(body);
    const attachments = attachmentsFrom(body);
    const subject = body.subject ? String(body.subject).trim().slice(0, 300) : undefined;
    const result = op === 'reply'
      ? await replyTo({ threadId, emailId, replyAll: !!body.replyAll, cc, bcc, subject, html, text, attachments, idempotencyKey: requestId })
      : await forward({ threadId, emailId, to, cc, bcc, subject, html, text, attachments, idempotencyKey: requestId });
    await logSent(db, v, op, { threadId, emailId: result.emailId, subject, recipientCount: Math.max(1, to.length) + cc.length + bcc.length });
    return json({ sent: true, emailId: result.emailId });
  }

  if (op === 'move') {
    const threadId = cleanId(body.threadId);
    if (!threadId || !isMoveFolder(body.folder)) throw new MailboxError('Choose where to move it.', 400);
    await updateThread(threadId, { folder: body.folder });
    return json({ moved: true });
  }

  if (op === 'read') {
    const threadId = cleanId(body.threadId);
    if (!threadId) throw new MailboxError('Missing thread id.', 400);
    await updateThread(threadId, { read: !!body.read });
    return json({ read: !!body.read });
  }

  if (op === 'alerts') {
    await db.sql`UPDATE volunteers SET mailbox_alerts = ${!!body.enabled}, updated_at = NOW() WHERE id = ${v.id}`;
    return json({ alerts: !!body.enabled });
  }

  return json({ error: 'Unknown request' }, 400);
}

export default async (req) => {
  try {
    const user = await getUser();
    if (!user) return json({ error: 'Not logged in' }, 401);

    const db = getDatabase();
    const access = await getMailboxAccess(db, user);
    if (!access.allowed) return json({ error: 'no_access', message: 'You don\'t have access to the mailbox. Ask an admin if you need it.' }, 403);

    if (req.method === 'GET') return await handleGet(req, db, access);
    if (req.method === 'POST') return await handlePost(req, db, access);
    return json({ error: 'Method not allowed' }, 405);
  } catch (err) {
    if (err instanceof MailboxError) return json({ error: err.message }, err.status);
    console.error('mailbox error:', err);
    return json({ error: 'Something went wrong with the mailbox. Please try again.' }, 500);
  }
};
