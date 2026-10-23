// Latest public posts from the Santa Super Sleigh Facebook Page, for the
// "Latest Updates" panel on the home page. Replaces Facebook's embedded
// Page Plugin, which stopped returning any posts.
//
// Needs two Netlify environment variables (see FACEBOOK_SETUP.md):
//   FACEBOOK_PAGE_ID       numeric ID of the Page
//   FACEBOOK_ACCESS_TOKEN  a Page access token with pages_read_engagement
//
// If either is missing, or Facebook rejects the call (e.g. the token has
// expired), this returns { success: false, posts: [] } and the home page
// falls back to the embedded plugin plus an "Open Facebook" button, so a
// broken token never breaks the page. The real error goes to the function
// log only, never to visitors.
//
// Responses are cached at the CDN for 10 minutes, so Facebook is called at
// most a few times an hour however many people visit.

const GRAPH_VERSION = 'v21.0';
const MAX_POSTS = 5;
const MAX_MESSAGE_CHARS = 600;

const baseHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*'
};

function json(body, cacheSeconds) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: Object.assign({}, baseHeaders, {
      'Cache-Control': cacheSeconds
        ? 'public, max-age=' + cacheSeconds + ', s-maxage=' + cacheSeconds
        : 'no-store'
    })
  });
}

export default async function handler() {
  const pageId = process.env.FACEBOOK_PAGE_ID || '';
  const token = process.env.FACEBOOK_ACCESS_TOKEN || '';

  if (!pageId || !token) {
    return json({ success: false, reason: 'not-configured', posts: [] }, 60);
  }

  try {
    const fields = 'id,message,created_time,full_picture,permalink_url';
    const url = 'https://graph.facebook.com/' + GRAPH_VERSION + '/' + encodeURIComponent(pageId) +
      '/published_posts?fields=' + fields + '&limit=' + (MAX_POSTS + 3);
    // Token in a header, not the URL, so it can't end up in logs.
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) {
      let detail = '';
      try { detail = JSON.stringify((await res.json()).error || {}); } catch (e) { /* ignore */ }
      console.error('Facebook API error', res.status, detail);
      return json({ success: false, reason: 'api-error', posts: [] }, 60);
    }
    const data = await res.json();
    const posts = (data.data || [])
      // Photo-only posts have no text; still show them if they have a picture.
      .filter(function (p) { return p.message || p.full_picture; })
      .slice(0, MAX_POSTS)
      .map(function (p) {
        const message = p.message || '';
        return {
          id: p.id,
          message: message.length > MAX_MESSAGE_CHARS ? message.slice(0, MAX_MESSAGE_CHARS).trimEnd() + '…' : message,
          createdTime: p.created_time,
          picture: p.full_picture || null,
          url: p.permalink_url || null
        };
      });
    return json({ success: true, posts: posts, lastUpdated: new Date().toISOString() }, 600);
  } catch (err) {
    console.error('Error fetching Facebook posts:', err);
    return json({ success: false, reason: 'error', posts: [] }, 60);
  }
}
