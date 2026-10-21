// Shared Resend email helpers + Santa Sleigh branded template for the
// volunteer registration emails (invite, approved, rejected, admin alert).

export const FROM_ADDRESS = 'Santa Super Sleigh Salford <noreply@santasleighsalford.co.uk>';
export const REPLY_TO = 'nathan.talbot@100thsalford.co.uk';

export function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// Production links always point at the real domains; on staging/deploy
// previews they point back at whichever host made the request, so a test
// invite sent from staging lands on staging.
export function siteUrls(req) {
  const u = new URL(req.url);
  const isProd = /(^|\.)santasleighsalford\.co\.uk$/i.test(u.hostname);
  const main = isProd ? 'https://santasleighsalford.co.uk' : u.origin;
  return {
    main,
    helpout: isProd ? 'https://helpout.santasleighsalford.co.uk/' : u.origin + '/helpout.html',
    volunteerLogin: main + '/volunteer.html?login=1',
    admin: main + '/admin.html'
  };
}

// paragraphs: array of HTML strings (caller escapes any user input).
// Status banner shown under the header so the state is obvious at a glance.
const STATUS_STYLES = {
  pending:  { bg: '#FFF4D6', border: '#EBC96B', color: '#7A4F00', icon: '⏳', heading: '#A8382F' },
  approved: { bg: '#E3F3E9', border: '#8FC9A6', color: '#1E5B45', icon: '✅', heading: '#1E5B45' }
};

// bodyHtml: optional pre-built HTML (e.g. a shift table) placed after the
// paragraphs and before the button.
// status: optional { tone: 'pending' | 'approved', label } banner.
export function brandedEmailHtml({ heading, paragraphs, bodyHtml, button, footnote, status }) {
  const st = status && STATUS_STYLES[status.tone];
  const statusHtml = st
    ? '<div style="margin:0 0 20px; padding:14px 16px; background:' + st.bg + '; border:2px solid ' + st.border + '; border-radius:10px; color:' + st.color + '; font-size:17px; font-weight:bold; letter-spacing:0.02em;">' +
        st.icon + '&nbsp; Status: ' + escapeHtml(status.label) +
      '</div>'
    : '';
  const headingColor = st ? st.heading : '#A8382F';
  const body = (paragraphs || []).map(function(p) {
    return '<p style="margin:0 0 16px; font-size:16px; line-height:1.6; color:#24272E;">' + p + '</p>';
  }).join('');
  const buttonHtml = button
    ? '<p style="margin:24px 0;"><a href="' + escapeHtml(button.url) + '" style="display:inline-block; background:#1E5B45; color:#ffffff; text-decoration:none; font-weight:bold; padding:14px 28px; border-radius:999px; font-size:16px;">' + escapeHtml(button.label) + '</a></p>' +
      '<p style="margin:0 0 16px; font-size:13px; color:#5B6169;">Button not working? Copy this link into your browser:<br><a href="' + escapeHtml(button.url) + '" style="color:#1E5B45; word-break:break-all;">' + escapeHtml(button.url) + '</a></p>'
    : '';
  return (
    '<div style="background:#F6F4F0; padding:24px 12px; font-family:-apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif;">' +
      '<div style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; border:1px solid #E7E2D9;">' +
        '<div style="background:#A8382F; padding:20px 24px; color:#ffffff;">' +
          '<div style="font-size:20px; font-weight:bold;">🎅 Santa Super Sleigh Salford</div>' +
          '<div style="font-size:13px; opacity:0.9; margin-top:4px;">100th Salford (St Luke\'s) Scout Group</div>' +
        '</div>' +
        '<div style="padding:28px 24px 12px;">' +
          statusHtml +
          '<h1 style="margin:0 0 20px; font-size:22px; color:' + headingColor + ';">' + escapeHtml(heading) + '</h1>' +
          body + (bodyHtml || '') + buttonHtml +
        '</div>' +
        (footnote ? '<div style="padding:16px 24px 24px; font-size:13px; line-height:1.5; color:#5B6169; border-top:1px solid #E7E2D9;">' + footnote + '</div>' : '') +
      '</div>' +
    '</div>'
  );
}

export async function sendEmail({ to, subject, html, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_ADDRESS, reply_to: replyTo || REPLY_TO, to: [to], subject, html })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error('Resend API error ' + res.status + ': ' + body);
  }
}
