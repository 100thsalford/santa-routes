// Shared input rules for volunteer names, emails and phone numbers.
//
// Every query already uses parameterised db.sql`...` templates and every
// display path escapes HTML, so these rules are a second layer: they keep
// markup/script-ish characters out of the data entirely. Hyphens and
// apostrophes stay allowed (Smith-Jones, O'Brien). Passwords are NOT run
// through this -- they go straight to Netlify Identity (bcrypt-hashed) and
// restricting characters would only make them weaker.
//
// helpout.html mirrors BLOCKED_CHARS and the mobile rule client-side for
// instant feedback; this file is the one that actually enforces them.

export const BLOCKED_CHARS = /[<>;()&]/;
export const BLOCKED_CHARS_MESSAGE = 'Please remove these characters: < > ; ( ) &';

export function hasBlockedChars(value) {
  return BLOCKED_CHARS.test(String(value || ''));
}

// UK mobile numbers only. Accepts 07..., +447..., 00447... or 447...,
// with spaces, hyphens or dots anywhere. Returns the number tidied to
// "07xxx xxxxxx", or null if it isn't a valid UK mobile.
export function normaliseUkMobile(value) {
  let digits = String(value || '').trim().replace(/[\s.-]/g, '');
  if (digits.startsWith('+44')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('0044')) digits = '0' + digits.slice(4);
  else if (/^447\d{9}$/.test(digits)) digits = '0' + digits.slice(2);
  if (digits.startsWith('007')) digits = digits.slice(1); // +44 07... typed with the 0 kept
  if (!/^07\d{9}$/.test(digits)) return null;
  return digits.slice(0, 5) + ' ' + digits.slice(5);
}

export const PHONE_MESSAGE = 'Please enter a UK mobile number, e.g. 07700 900123.';

// Validates the optional name/email/phone trio used by registration and
// the admin guest-volunteer forms. Returns { error } or { fullName, email,
// phone } with phone normalised (null when left blank).
export function checkContactDetails({ fullName, email, phone }) {
  const name = String(fullName || '').trim();
  const mail = String(email || '').trim();
  const tel = String(phone || '').trim();
  if (hasBlockedChars(name)) return { error: 'Name: ' + BLOCKED_CHARS_MESSAGE, field: 'fullName' };
  if (hasBlockedChars(mail)) return { error: 'Email: ' + BLOCKED_CHARS_MESSAGE, field: 'email' };
  let normalisedPhone = null;
  if (tel) {
    normalisedPhone = normaliseUkMobile(tel);
    if (!normalisedPhone) return { error: PHONE_MESSAGE, field: 'phone' };
  }
  return { fullName: name, email: mail, phone: normalisedPhone };
}
