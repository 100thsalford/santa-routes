// CORS for the two public helpout endpoints. In production the helpout
// page lives on helpout.santasleighsalford.co.uk and calls these functions
// on the main domain (so the subdomain needs no function routing of its
// own); on staging the page and functions share one origin and CORS
// doesn't come into it.

const ALLOWED_ORIGINS = ['https://helpout.santasleighsalford.co.uk'];

export function corsHeaders(req, methods) {
  const origin = req.headers.get('origin');
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Vary': 'Origin'
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = methods;
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  return headers;
}
