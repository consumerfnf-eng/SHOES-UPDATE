// Bare strings are legacy trusted read(url) results. Structured cache results
// must retain upstream URL/status evidence, not just a scraper transport 200.
export function normalizeShopifyFeedBody(input, expectedUrl) {
  const expected = new URL(expectedUrl);
  if (!['https:', 'http:'].includes(expected.protocol) || !expected.pathname.endsWith('/products.json') || expected.hash || expected.username || expected.password) throw Error('Invalid official products endpoint');
  let body = input;
  if (typeof input !== 'string') {
    if (!input || typeof input !== 'object' || input.success === false || input.error) throw Error('Unsuccessful feed response');
    const data = input.data ?? input, metadata = data.metadata ?? {};
    const urls = [input.url, input.sourceURL, input.requestedUrl, data.url, data.sourceURL, data.requestedUrl, metadata.url, metadata.sourceURL].filter(v => v !== undefined);
    const statuses = [input.status, input.statusCode, data.status, data.statusCode, metadata.statusCode].filter(v => v !== undefined);
    if (!urls.length || urls.some(url => {
      try {
        const actual = new URL(url), wanted = new URL(expected);
        actual.searchParams.sort(); wanted.searchParams.sort();
        return actual.href !== wanted.href;
      } catch { return true; }
    })) throw Error('Feed source URL mismatch or missing');
    if (!statuses.length || statuses.some(status => status !== 200)) {
      const status = statuses.find(status => status !== 200);
      const error = Error(`HTTP ${status ?? 'unknown'}: feed status missing or unsuccessful`);
      error.status = status; error.headers = data.headers ?? input.headers;
      error.retryAfter = data.retryAfter ?? input.retryAfter;
      throw error;
    }
    body = data.body ?? data.html ?? data.rawHtml ?? data.markdown;
  }
  if (typeof body !== 'string') throw Error('Feed body must be source text');
  const raw = body;
  body = body.trim();
  let format = 'json';
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(body);
  if (fence) { body = fence[1]; format = 'markdown-json'; }
  else if (body.startsWith('<')) {
    // Extract the entire literal body/pre content, never a brace substring
    // from an arbitrary HTML page. JSON.parse decides whether it is JSON.
    const shell = /^(?:<!doctype html>\s*)?<html\b[^>]*>\s*(?:<head>\s*(?:<meta\b[^>]*>\s*)*<\/head>\s*)?<body\b[^>]*>([\s\S]*)<\/body>\s*<\/html>$/i.exec(body);
    const content = (shell ? shell[1] : body).trim();
    const pre = /^<pre\b[^>]*>([\s\S]*)<\/pre>$/i.exec(content);
    if (!shell && !pre) throw Error('HTML is not a JSON document');
    body = pre ? pre[1] : content;
    format = pre ? 'html-pre' : 'html-body';
  }
  let value;
  try { value = JSON.parse(body); }
  catch {
    // Entity decoding belongs only to HTML text that failed literal JSON
    // parsing. Never decode valid JSON (including body_html and \\u003c).
    if (format !== 'html-pre' && format !== 'html-body') throw Error('Invalid products feed JSON');
    body = body.replace(/&(#x[\da-f]+|#\d+|quot|apos|amp|lt|gt);/gi, (entity, code) => {
      if (code[0] === '#') {
        const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : entity;
      }
      return {quot: '"', apos: "'", amp: '&', lt: '<', gt: '>'}[code.toLowerCase()];
    });
    try { value = JSON.parse(body); } catch { throw Error('Invalid products feed JSON'); }
  }
  if (!value || typeof value !== 'object' || !Array.isArray(value.products)) throw Error('Invalid products feed schema');
  for (const p of value.products) {
    if (!p || typeof p !== 'object' || Array.isArray(p) || !((typeof p.id === 'number' && Number.isSafeInteger(p.id) && p.id > 0) || (typeof p.id === 'string' && /^\d+$/.test(p.id) && /[1-9]/.test(p.id)))) throw Error('Invalid product identity');
    for (const key of ['title', 'handle', 'vendor', 'product_type', 'body_html']) {
      if (p[key] !== undefined && p[key] !== null && typeof p[key] !== 'string') throw Error(`Invalid product ${key}`);
    }
    for (const key of ['images', 'variants', 'options']) {
      if (p[key] !== undefined && (!Array.isArray(p[key]) || p[key].some(item => !item || typeof item !== 'object' || Array.isArray(item)))) throw Error(`Invalid product ${key}`);
    }
  }
  return {text: body, value, raw, format};
}
