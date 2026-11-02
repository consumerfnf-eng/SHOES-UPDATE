// Gates the internal deployment behind a shared password, no Cloudflare
// Access (and no card on file) required.
//
// This file ships in the public repo and gets picked up by `wrangler pages
// deploy` on BOTH the public and internal projects alike - there is no way
// to attach it to one project only. It stays harmless on the public site
// by redirecting it to the internal host. Internal canonical and preview
// domains fail closed without the existing password secret; other public
// preview hosts contain no private CATWALK files.
export async function onRequest(context) {
  const url=new URL(context.request.url);
  if(url.hostname==='shoes-update.pages.dev') {
    url.hostname='shoes-update-internal.pages.dev';
    return Response.redirect(url.toString(),302);
  }
  const password = context.env.INTERNAL_SITE_PASSWORD;
  if(!password&&(url.hostname==='shoes-update-internal.pages.dev'||url.hostname.endsWith('.shoes-update-internal.pages.dev')))
    return new Response('Internal site authentication is not configured.',{status:503});
  if (!password) return context.next();

  // The team is handed a password, not an account. Basic auth is only the
  // vehicle for it - browsers have no password-only dialog - so whatever
  // lands in the name box is accepted, including nothing at all; the
  // password alone is checked. Comparing the whole `name:password` string
  // instead would turn a correct password into a 401 for anyone who left
  // the name blank or typed their own.
  const header = context.request.headers.get('Authorization') ?? '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    let supplied = '';
    try { supplied = atob(encoded); } catch { supplied = ''; }
    const colon = supplied.indexOf(':');
    if (colon >= 0 && supplied.slice(colon + 1) === password) return context.next();
  }

  return new Response('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="SHOES-UPDATE internal"' },
  });
}
