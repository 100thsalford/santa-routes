// Checks for the hello@ mailbox's server-side helpers (netlify/lib/mailbox.js),
// run with plain Node (no dependencies, no build step):
//   node tests/mailbox.test.mjs
import assert from 'node:assert/strict';
import {
  parseAddressList, cleanOutboundHtml, htmlToText, base64Bytes, checkAttachments,
  isFolder, isMoveFolder, MAX_ATTACHMENT_BYTES
} from '../netlify/lib/mailbox.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

test('address lists: commas, semicolons, names and duplicates', () => {
  const r = parseAddressList('a@x.com; Bob Smith <b@y.org>, A@X.com,\n mailto:c@z.co.uk');
  assert.deepEqual(r.list, ['a@x.com', 'b@y.org', 'c@z.co.uk']);
  assert.deepEqual(r.invalid, []);
});

test('address lists: invalid entries are reported, not sent', () => {
  const r = parseAddressList(['ok@x.com', 'not an email', 'bad@', '@nope.com']);
  assert.deepEqual(r.list, ['ok@x.com']);
  assert.equal(r.invalid.length, 3);
});

test('address lists: empty input', () => {
  assert.deepEqual(parseAddressList('').list, []);
  assert.deepEqual(parseAddressList(undefined).list, []);
});

test('outbound HTML: scripts, handlers and javascript: links removed', () => {
  const dirty = '<p onclick="x()">Hi <a href="javascript:alert(1)">there</a></p><script>alert(1)</script>' +
    '<iframe src="https://evil"></iframe><img src=x onerror=alert(1)><a href="https://ok.example">fine</a>';
  const clean = cleanOutboundHtml(dirty);
  assert.ok(!/script/i.test(clean), clean);
  assert.ok(!/onclick|onerror/i.test(clean), clean);
  assert.ok(!/javascript:/i.test(clean), clean);
  assert.ok(!/iframe/i.test(clean), clean);
  assert.ok(clean.includes('href="https://ok.example"'), clean);
  assert.ok(clean.includes('Hi '), clean);
});

test('outbound HTML: ordinary formatting kept', () => {
  const html = '<p><b>Bold</b> <i>it</i></p><ul><li>One</li></ul>';
  assert.equal(cleanOutboundHtml(html), html);
});

test('plain-text version', () => {
  const text = htmlToText('<p>Hello &amp; welcome</p><ul><li>One</li><li>Two</li></ul><p>See <a href="https://x.org/a">our site</a><br>Thanks</p>');
  assert.equal(text, 'Hello & welcome\n• One\n• Two\nSee our site (https://x.org/a)\nThanks');
});

test('base64 size', () => {
  assert.equal(base64Bytes(Buffer.from('hello').toString('base64')), 5);
  assert.equal(base64Bytes(Buffer.from('hell').toString('base64')), 4);
  assert.equal(base64Bytes(Buffer.alloc(3000).toString('base64')), 3000);
  assert.equal(base64Bytes(''), 0);
});

test('attachments: valid ones are passed through in Resend\'s shape', () => {
  const r = checkAttachments([{ filename: 'poster.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-1.4').toString('base64') }]);
  assert.equal(r.error, undefined);
  assert.equal(r.attachments.length, 1);
  assert.equal(r.attachments[0].filename, 'poster.pdf');
  assert.equal(r.attachments[0].content_type, 'application/pdf');
});

test('attachments: data URL prefix stripped, odd names and types made safe', () => {
  const r = checkAttachments([{ filename: '../evil\r\n.txt', contentType: 'not a type', content: 'data:text/plain;base64,' + Buffer.from('hi').toString('base64') }]);
  assert.equal(r.attachments[0].content, Buffer.from('hi').toString('base64'));
  assert.ok(!/[\\/\r\n]/.test(r.attachments[0].filename), r.attachments[0].filename);
  assert.equal(r.attachments[0].content_type, 'application/octet-stream');
});

test('attachments: over 4 MB in total is refused', () => {
  const half = Buffer.alloc(MAX_ATTACHMENT_BYTES / 2 + 10).toString('base64');
  const r = checkAttachments([{ filename: 'a', content: half }, { filename: 'b', content: half }]);
  assert.match(r.error, /4 MB/);
});

test('attachments: too many, empty or unreadable files are refused', () => {
  const one = { filename: 'a.txt', content: Buffer.from('x').toString('base64') };
  assert.match(checkAttachments(new Array(11).fill(one)).error, /up to 10/);
  assert.match(checkAttachments([{ filename: 'e', content: '' }]).error, /couldn't be read/);
  assert.match(checkAttachments([{ filename: 'e', content: '!!!' }]).error, /couldn't be read/);
  assert.deepEqual(checkAttachments(undefined).attachments, []);
});

test('folders', () => {
  assert.ok(isFolder('inbox') && isFolder('sent') && isFolder('trash'));
  assert.ok(!isFolder('drafts'));
  assert.ok(isMoveFolder('archive') && !isMoveFolder('sent'));
});

console.log('\n' + passed + ' mailbox checks passed');
