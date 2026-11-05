import test from 'node:test';
import assert from 'node:assert/strict';
import {ADIDAS_LIVE_NEW_SOURCES as sources, parseAdidasLiveNewPage, collectAdidasLiveNew} from '../scripts/collect-adidas-live-new.mjs';

const base = 'https://www.adidas.com';
const men = `${base}/us/men-shoes-new_arrivals?sort=newest-to-oldest`;
const sneakers = `${base}/us/men-athletic_sneakers-shoes-new_arrivals?sort=newest-to-oldest`;
const adults = `${base}/us/men|women-athletic_sneakers-shoes-new_arrivals?sort=newest-to-oldest`;
const field = {men: 'multi_age_gender_en_us', women: 'multi_age_gender_en_us', shoes: 'division', athletic_sneakers: 'producttype_en_us', new_arrivals: 'new_arrivals_en_us', y_3: 'brand_en_us'};
const now = new Date('2026-11-05T06:00:00Z');
function product(id, extra = {}) {
  return {id, title: 'Test Sneakers', subTitle: 'Originals', category: 'Originals', modelNumber: 'MODEL1', url: `${base}/us/test-sneakers/${id}.html`, image: `https://assets.adidas.com/images/w_383,h_383/folder/Test_Sneakers_Black_${id}_00_plp_standard.jpg`, priceData: {prices: [{type: 'original', value: 100}]}, ...extra};
}
function page(url, rows, {total = rows.length, size = 48, filters = [], props = {}, nextUrl} = {}) {
  const u = new URL(url), taxonomy = decodeURIComponent(u.pathname).slice(4), start = Number(u.searchParams.get('start') ?? 0);
  const next = {query: {path: 'us', taxonomy, ...(u.searchParams.has('sort') ? {sort: u.searchParams.get('sort')} : {}), ...(start ? {start: String(start)} : {})}, props: {pageProps: {
    context: {brand: 'adidas', locale: 'en_US'}, pathname: decodeURIComponent(u.pathname), taxonomy,
    ...(u.searchParams.has('sort') ? {sortParam: u.searchParams.get('sort')} : {}),
    selectedFilters: taxonomy.split('-').flatMap(t => t.split('|')).map(value => ({on: field[value], value})),
    info: {count: total, viewSize: size, startIndex: start}, products: rows, filters, ...props,
  }}};
  return {rawHtml: `<html><body><script type="application/json" id="__NEXT_DATA__">${JSON.stringify(next)}</script>${nextUrl ? `<a href="${nextUrl.replaceAll('&', '&amp;')}">Next</a>` : ''}</body></html>`, metadata: {sourceURL: url, url, statusCode: 200}};
}
const facet = (on, value, url, count = 1) => ({id: on, values: [{on, value, url, count}]});
const nextAt = (url, start) => `${url}&start=${start}`;
function fixtures() {
  const one = product('AB1234', {releaseDate: '1900-01-01'}), two = product('CD1234', {subTitle: 'Women Originals'});
  const kids = product('KD1234', {title: 'Kids Sneakers', subTitle: 'Kids Originals'});
  const cleats = product('CL1234', {title: 'Predator Firm Ground Soccer Cleats', category: 'Performance'});
  const yKids = product('YK1234', {title: 'Predator Y-3 Soccer Cleats Kids', subTitle: 'Kids Y-3', category: 'Y-3'});
  const yAdult = product('YA1234', {title: 'F50 Y-3 Firm Ground Cleats', subTitle: 'Y-3', category: 'Y-3'});
  return new Map([
    [sources.adidas, page(sources.adidas, [one, kids], {total: 4, size: 2, nextUrl: nextAt(sources.adidas, 2), filters: [facet('multi_age_gender_en_us', 'men', men)]})],
    [nextAt(sources.adidas, 2), page(nextAt(sources.adidas, 2), [cleats, two], {total: 4, size: 2})],
    [men, page(men, [one], {filters: [facet('producttype_en_us', 'athletic_sneakers', sneakers)]})],
    [sneakers, page(sneakers, [one], {filters: [facet('multi_age_gender_en_us', 'women', adults)]})],
    [adults, page(adults, [one], {total: 2, size: 1, nextUrl: nextAt(adults, 1)})],
    [nextAt(adults, 1), page(nextAt(adults, 1), [two], {total: 2, size: 1})],
    [sources['Y-3'], page(sources['Y-3'], [yKids, yAdult])],
  ]);
}
const normalized = url => decodeURIComponent(url);
function reader(cache, reads = []) {
  return async (url, options) => {
    reads.push({url, options});
    const key = [...cache.keys()].find(key => normalized(key) === normalized(url));
    if (!key) throw Error('Uncaptured official URL: ' + url);
    return structuredClone(cache.get(key));
  };
}
async function collect(cache = fixtures(), options = {}) {
  return collectAdidasLiveNew({read: reader(cache), now, minIntervalMs: 0, ...options});
}
function rewrite(record, change) {
  const copy = structuredClone(record);
  const match = copy.rawHtml.match(/(<script[^>]*>)([\s\S]*?)(<\/script>)/);
  const data = JSON.parse(match[2]); change(data);
  copy.rawHtml = copy.rawHtml.replace(match[0], match[1] + JSON.stringify(data) + match[3]);
  return copy;
}

test('complete collection follows real facet links and every root/scope page', async () => {
  const reads = [], progress = [], checkpoints = [];
  const result = await collect(fixtures(), {read: reader(fixtures(), reads), onProgress: e => progress.push(e), onCheckpoint: e => {checkpoints.push(structuredClone(e)); e.products.length = 0;}});
  assert.deepEqual(result.errors, []);
  assert.equal(result.reads, 7);
  assert.ok(reads.every(r => r.options.formats[0] === 'rawHtml' && r.options.maxAge === 0 && r.options.onlyMainContent === false));
  const output = result.outputs.adidas;
  assert.deepEqual(output.products.map(p => p.style), ['AB1234', 'CD1234']);
  assert.equal(output.coverage.total, 4);
  assert.equal(output.coverage.read, 4);
  assert.equal(output.coverage.pages, 2);
  assert.equal(output.coverage.adultSneakerTotal, 2);
  assert.equal(output.coverage.adultSneakerPages, 2);
  assert.equal(output.coverage.exhaustive, true);
  assert.deepEqual(output.excluded.map(p => p.reason), ['children', 'not-sneakers']);
  assert.equal(result.outputs['Y-3'].products.length, 0);
  assert.equal(result.outputs['Y-3'].coverage.exhaustive, true);
  assert.equal(result.outputs['Y-3'].excluded.length, 2);
  assert.equal(checkpoints.length, 2);
  assert.equal(progress.at(-1).status, 'complete');
});

test('rows bind own SKU/image and New category without inventing release dates or gender', async () => {
  const {outputs} = await collect();
  const row = outputs.adidas.products[0];
  assert.equal(row.audience, 'adult'); assert.equal(row.gender, '');
  assert.equal(row.category, 'sneaker'); assert.equal(row.productType, 'sneaker');
  assert.equal(row.image, row.sourceImageUrl);
  assert.match(row.image, /_AB1234_/);
  assert.equal(row.arrivalEvidence.url, sources.adidas);
  assert.equal(row.arrivalEvidence.kind, 'new-arrivals-listing');
  assert.equal(row.scopeEvidence.url, adults);
  assert.ok(row.scopeEvidence.filters.includes('men') && row.scopeEvidence.filters.includes('women'));
  assert.equal(row.firstSeen, now.toISOString());
  for (const key of ['releaseDate', 'launchDate', 'newDate', 'isNew']) assert.equal(Object.hasOwn(row, key), false);
  assert.equal(outputs.adidas.products[1].gender, 'Women');
});

test('raw hydration is mandatory; visible markdown or AI json cannot replace original state', () => {
  const record = fixtures().get(sources.adidas);
  for (const bad of [record.rawHtml, {html: record.rawHtml, metadata: record.metadata}, {markdown: '# New Sneakers', json: {products: []}, metadata: record.metadata}, {...record, rawHtml: '<html>Access Denied</html>'}]) {
    assert.throws(() => parseAdidasLiveNewPage(bad, sources.adidas), /response|rawHtml|__NEXT_DATA__/);
  }
});

test('all upstream URLs and statuses must bind the exact source, sort and pagination', () => {
  const record = fixtures().get(sources.adidas);
  for (const bad of [
    {...record, metadata: {}}, {...record, status: 403}, {...record, metadata: {...record.metadata, statusCode: 429}},
    {...record, metadata: {...record.metadata, url: sources['Y-3']}}, {...record, requestedUrl: nextAt(sources.adidas, 48)},
    {...record, success: false},
  ]) assert.throws(() => parseAdidasLiveNewPage(bad, sources.adidas));
  const combined = fixtures().get(adults);
  assert.equal(parseAdidasLiveNewPage({...combined, metadata: {...combined.metadata, url: adults.replace('|', '%7C')}}, adults).total, 2);
});

test('selected New, category, locale and brand evidence cannot be inferred from route names', () => {
  const record = fixtures().get(sources.adidas);
  for (const change of [
    n => {n.props.pageProps.selectedFilters.pop();},
    n => {n.props.pageProps.taxonomy = 'shoes';},
    n => {n.props.pageProps.context.locale = 'en_GB';},
    n => {n.query.taxonomy = 'shoes';},
    n => {n.props.pageProps.pathname = '/us/shoes';},
    n => {n.props.pageProps.selectedFilters.push({on: 'brand_en_us', value: 'y_3'});},
  ]) assert.throws(() => parseAdidasLiveNewPage(rewrite(record, change), sources.adidas), /mismatch|filters/);
});

test('generic Predator products cannot become Y-3, even on a spoofed Y-3 route', async () => {
  const cache = fixtures();
  cache.set(sources['Y-3'], page(sources['Y-3'], [product('PR1234', {title: 'Predator Soccer Cleats', category: 'Performance'})]));
  const result = await collect(cache, {brands: ['Y-3']});
  assert.deepEqual(result.outputs, {});
  assert.match(result.errors[0].error, /brand mismatch/);
  assert.throws(() => parseAdidasLiveNewPage(cache.get(sources['Y-3']), 'https://www.adidas.com/us/y_3-shoes-new_arrivals', {brand: 'Y-3'}), /mismatch/);
});

test('source page and scope failures remain atomic with no partial products', async () => {
  for (const target of [nextAt(sources.adidas, 2), nextAt(adults, 1)]) {
    const cache = fixtures(); cache.delete(target);
    const result = await collect(cache, {brands: ['adidas']});
    assert.deepEqual(result.outputs, {});
    assert.equal(result.errors[0].status, 'incomplete');
    assert.match(result.errors[0].error, /Uncaptured/);
  }
});

test('totals, offsets, page sizes, overlaps and missing next links fail closed', async () => {
  for (const mode of ['total', 'offset', 'overlap', 'size', 'truncated', 'missing-next', 'terminal-next']) {
    const cache = fixtures(), first = cache.get(sources.adidas), lastUrl = nextAt(sources.adidas, 2);
    if (mode === 'missing-next') cache.set(sources.adidas, {...first, rawHtml: first.rawHtml.replace(/<a[\s\S]*?<\/a>/, '')});
    else if (mode === 'terminal-next') {const last = cache.get(lastUrl); cache.set(lastUrl, {...last, rawHtml: last.rawHtml.replace('</body>', `<a href="${nextAt(sources.adidas, 4)}">Next</a></body>`)});}
    else cache.set(lastUrl, rewrite(cache.get(lastUrl), n => {
      const p = n.props.pageProps;
      if (mode === 'total') {p.info.count = 5; p.products.push(product('EF1234')); p.info.viewSize = 3;}
      if (mode === 'offset') p.info.startIndex = 0;
      if (mode === 'overlap') p.products[0] = product('AB1234');
      if (mode === 'size') p.info.viewSize = 1;
      if (mode === 'truncated') p.products.pop();
    }));
    const result = await collect(cache, {brands: ['adidas']});
    assert.deepEqual(result.outputs, {}, mode);
    assert.equal(result.errors.length, 1, mode);
  }
});

test('a category scope cannot switch brands, omit adult filters, or invent SKUs', async () => {
  for (const mode of ['facet', 'adult', 'sku', 'child', 'image']) {
    const cache = fixtures();
    if (mode === 'facet') cache.set(men, rewrite(cache.get(men), n => {n.props.pageProps.filters[0].values[0].url = '/us/y_3-new_arrivals';}));
    else cache.set(adults, rewrite(cache.get(adults), n => {
      const p = n.props.pageProps;
      if (mode === 'adult') p.selectedFilters = p.selectedFilters.filter(f => f.value !== 'men');
      if (mode === 'sku') p.products[0] = product('ZZ1234');
      if (mode === 'child') p.products[0].subTitle = 'Kids Originals';
      if (mode === 'image') p.products[0].image = product('ZZ1234').image;
    }));
    const result = await collect(cache, {brands: ['adidas']});
    assert.deepEqual(result.outputs, {}, mode);
    assert.equal(result.errors.length, 1, mode);
  }
});

test('SKU image and product URL checks also apply to excluded records', () => {
  const record = fixtures().get(sources.adidas);
  for (const change of [
    n => {n.props.pageProps.products[1].image = product('XX1234').image;},
    n => {n.props.pageProps.products[1].url = 'https://other.example/KD1234.html';},
    n => {n.props.pageProps.products[1].id = null;},
  ]) assert.throws(() => parseAdidasLiveNewPage(rewrite(record, change), sources.adidas), /SKU|product/);
});

test('bounded read/page limits return incomplete coverage and independent Y-3 still completes', async () => {
  for (const options of [{maxReads: 1}, {maxPages: 1}]) {
    const result = await collect(fixtures(), {brands: ['adidas'], ...options});
    assert.deepEqual(result.outputs, {});
    assert.match(result.errors[0].error, /budget|limit/);
    assert.equal(result.reads, 1);
  }
  const cache = fixtures(); cache.delete(sources.adidas);
  const result = await collect(cache);
  assert.ok(result.outputs['Y-3']); assert.equal(result.outputs.adidas, undefined);
});

test('reader errors are not retried or converted into a successful empty New category', async () => {
  let calls = 0;
  const result = await collect(fixtures(), {brands: ['adidas'], read: async () => {calls++; throw Error('HTTP 429');}});
  assert.equal(calls, 1); assert.deepEqual(result.outputs, {});
  assert.match(result.errors[0].error, /429/);
});

test('checkpoint failure rejects instead of claiming successful persistence', async () => {
  await assert.rejects(collect(fixtures(), {onCheckpoint: async () => {throw Error('checkpoint unavailable');}}), /checkpoint unavailable/);
});

test('page progress arrives before continuation reads and callback errors propagate', async () => {
  const cache = fixtures(), trace = [];
  await collect(cache, {
    read: async (url, options) => {trace.push(`read:${url}`); return reader(cache)(url, options);},
    onProgress: async event => {if (event.type === 'page') trace.push(`page:${event.url}`);},
  });
  assert.ok(trace.indexOf(`page:${sources.adidas}`) < trace.indexOf(`read:${nextAt(sources.adidas, 2)}`));
  await assert.rejects(collect(cache, {onProgress: async () => {throw Error('progress unavailable');}}), /progress unavailable/);
});

test('data-id and data-href are not hydration identifiers or pagination links', () => {
  const record = fixtures().get(sources.adidas);
  assert.throws(() => parseAdidasLiveNewPage({...record, rawHtml: record.rawHtml.replace('id="__NEXT_DATA__"', 'data-id="__NEXT_DATA__"')}, sources.adidas), /__NEXT_DATA__/);
  assert.throws(() => parseAdidasLiveNewPage({...record, rawHtml: record.rawHtml.replace('<a href=', '<a data-href=')}, sources.adidas), /next category link/);
});

test('explicit cleat title wins even when the official sneaker facet includes it', async () => {
  const cache = fixtures();
  cache.set(adults, page(adults, [product('AB1234'), product('CL1234', {title: 'Predator Firm Ground Soccer Cleats', category: 'Performance'}), product('CD1234', {subTitle: 'Women Originals'})]));
  const result = await collect(cache, {brands: ['adidas']});
  assert.deepEqual(result.errors, []);
  assert.equal(result.outputs.adidas.coverage.adultSneakerTotal, 3);
  assert.equal(result.outputs.adidas.coverage.exhaustive, true);
  assert.deepEqual(result.outputs.adidas.products.map(p => p.style), ['AB1234', 'CD1234']);
  assert.equal(result.outputs.adidas.excluded.find(p => p.style === 'CL1234').reason, 'not-sneakers');
});
