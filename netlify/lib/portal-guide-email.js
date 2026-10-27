// "Getting the most out of the portal" section for the volunteer approval
// email: five features, each an image beside a short note, alternating
// sides. Built for email clients: inline styles only, and fluid
// inline-block columns that sit side by side at full width and stack on
// phones. dir="rtl" on the image-right rows keeps the image first when the
// columns stack.
//
// Screenshots live in /media/email/ and are of the real portal with
// made-up demo data (fictional nights, names and route), so no real route
// or volunteer details go out in an email that could be forwarded.
// Bump IMG_VERSION if you replace them.

const IMG_VERSION = '20261027';

const FEATURES = [
  {
    img: 'portal-signup.jpg',
    alt: 'Open Nights list with Sign up buttons',
    eyebrow: '🎄 Pick your nights',
    title: 'Find a night and sign up',
    text: '<strong>Open Nights</strong> lists every night the Sleigh is out. The badge shows how many more volunteers each night needs. Tap <strong>Sign up</strong> and it goes straight into <strong>My Schedule</strong>.'
  },
  {
    img: 'portal-details.jpg',
    alt: 'A night opened up to show gather time and meeting point',
    eyebrow: '📍 Know where and when',
    title: 'Meeting point and time',
    text: 'Tap <strong>Details</strong> on any night for the gather time, a what3words meeting point that opens in your maps, notes from the team and who else is coming.'
  },
  {
    img: 'portal-printable.jpg',
    alt: 'Printable route map with the turns listed underneath',
    eyebrow: '🖨️ Printable map',
    title: 'Your route on paper',
    text: 'Each route has a <strong>Printable map</strong> with every turn listed underneath. Save it to your phone or print it to keep in your pocket on the night.<br><span style="color:#A8382F;">Please keep route maps within the volunteer group.</span>'
  },
  {
    img: 'portal-live-map.jpg',
    alt: 'Interactive route map with a blue dot showing your location',
    eyebrow: '🔵 Live map',
    title: 'See where you are on the route',
    text: '<strong>View interactive map</strong> gives turn-by-turn directions. Tap <strong>Show my location</strong> and a blue dot follows you along the route, so you can keep ahead of the Sleigh. Your location stays on your phone.'
  },
  {
    img: 'portal-donate.jpg',
    alt: 'Scan to Donate QR code and Take Card Payments button',
    eyebrow: '💝 Donations',
    title: 'Taking donations on the night',
    text: '<strong>Scan to Donate</strong> shows a QR code residents can scan to give online. Once you\'re signed up for a night, <strong>Take Card Payments</strong> lets you take contactless donations on your own phone.'
  }
];

function featureRow(f, i, baseUrl) {
  const imageRight = i % 2 === 1;
  const src = baseUrl + '/media/email/' + f.img + '?v=' + IMG_VERSION;
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">' +
      '<tr><td dir="' + (imageRight ? 'rtl' : 'ltr') + '" style="font-size:0; text-align:center;">' +
        '<div dir="ltr" style="display:inline-block; width:100%; max-width:240px; vertical-align:middle;">' +
          '<img src="' + src + '" width="240" alt="' + f.alt + '" style="display:block; width:100%; max-width:240px; height:auto; border:0; border-radius:14px; margin:0 auto;">' +
        '</div>' +
        '<div dir="ltr" style="display:inline-block; width:100%; max-width:256px; vertical-align:middle; text-align:left;">' +
          '<div style="padding:12px 12px 6px 14px;">' +
            '<div style="font-size:12px; font-weight:bold; letter-spacing:0.06em; text-transform:uppercase; color:#1E5B45; margin:0 0 6px;">' + f.eyebrow + '</div>' +
            '<div style="font-size:18px; font-weight:bold; line-height:1.3; color:#24272E; margin:0 0 8px;">' + f.title + '</div>' +
            '<div style="font-size:15px; line-height:1.55; color:#3D424A;">' + f.text + '</div>' +
          '</div>' +
        '</div>' +
      '</td></tr>' +
    '</table>'
  );
}

// baseUrl: the site the images are served from (siteUrls(req).main), so a
// test approval sent from staging uses staging's copies.
export function portalGuideHtml(baseUrl) {
  return (
    '<div style="margin:28px 0 8px; padding-top:24px; border-top:1px solid #E7E2D9;">' +
      '<h2 style="margin:0 0 6px; font-size:20px; color:#A8382F;">Getting the most out of the portal</h2>' +
      '<p style="margin:0 0 22px; font-size:15px; line-height:1.55; color:#5B6169;">Five things worth knowing before your first night:</p>' +
      FEATURES.map(function(f, i) { return featureRow(f, i, baseUrl); }).join('') +
      '<p style="margin:4px 0 16px; padding:12px 14px; background:#F6F4F0; border-radius:10px; font-size:14px; line-height:1.5; color:#3D424A;">' +
        '🧭 When you first log in, a quick tour shows you around. You can replay it any time from the <strong>Tour</strong> button at the top of the portal.' +
      '</p>' +
    '</div>'
  );
}
