// CDN caching for the public read endpoints, to keep function calls (and
// Netlify credits) flat however many visitors are on the site at once --
// e.g. hundreds of open track.html / index.html tabs on a route night.
//
// Why it lives in the functions: netlify.toml [[headers]] rules never apply
// to function responses (Netlify docs, "Custom headers"), so a function has
// to send its own caching headers.
//
//   Netlify-CDN-Cache-Control  how long Netlify's CDN keeps the response.
//                              `durable` shares one cached copy across all
//                              edge locations, so a miss at one edge doesn't
//                              mean another function call.
//   Cache-Control              what the visitor's browser does. Always
//                              "revalidate every time", so a browser never
//                              holds an older copy than the CDN does.
//   Netlify-Cache-Tag          lets admin writes (and new sightings) purge
//                              the relevant responses straight away, so
//                              caching never delays a change going live.
//
// New deploys clear the CDN cache automatically.

import { purgeCache } from '@netlify/functions';

export const CACHE_TAGS = {
  siteStatus: 'site-status',
  tracking: 'tracking',
  routes: 'routes',
  sightings: 'sightings'
};

// Headers for a cacheable public response. `vary` is a Netlify-Vary value
// (e.g. 'query=asOf') when a query param changes the response.
export function cdnCacheHeaders({ maxAge, staleWhileRevalidate, tags, vary }) {
  let cdn = 'public, durable, max-age=' + maxAge;
  if (staleWhileRevalidate) cdn += ', stale-while-revalidate=' + staleWhileRevalidate;
  const out = {
    'Netlify-CDN-Cache-Control': cdn,
    'Cache-Control': 'public, max-age=0, must-revalidate'
  };
  if (tags && tags.length) out['Netlify-Cache-Tag'] = tags.join(',');
  if (vary) out['Netlify-Vary'] = vary;
  return out;
}

// Purges cached responses for the given tags. Never throws: the write that
// triggered it has already succeeded, and the max-age on each endpoint is
// the backstop if a purge fails. Netlify allows two purges per tag every
// 5 seconds, so a quick burst of admin edits can hit that limit; with
// `retry` (admin writes) a failed purge is tried once more after a short
// wait, so the last edit in a burst still goes live straight away. Public
// writes (sightings) don't retry, to keep visitors' replies fast.
export async function purgePublicCache(tags, { retry = false } = {}) {
  try {
    await purgeCache({ tags });
  } catch (error) {
    if (retry) {
      await new Promise((resolve) => setTimeout(resolve, 2600));
      try {
        await purgeCache({ tags });
        return;
      } catch (retryError) {
        error = retryError;
      }
    }
    console.error('CDN cache purge failed for tags ' + tags.join(',') + ':', error.message || error);
  }
}
