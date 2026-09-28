import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStyleEditorial,editorialBlocks,discoverStyleArticles,collectStyleEditorials} from '../scripts/collect-style-editorials.mjs';

const now=new Date('2026-09-28T08:00:00Z'),url='https://magazine.example/story/sneaker-trends',source={id:'example-style',name:'Example Magazine',url:'https://magazine.example/',domain:'magazine.example',articlePrefix:'/story/',feedUrl:'https://magazine.example/feed/rss',discoveryUrl:'https://magazine.example/sneakers',seeds:[url]};
const config={publicationDays:30,maxArticlesPerSource:2,sources:[source],reviewedHeadings:[{label:'Netting',context:'fishnet|netted'},{label:'Retro Low Tops',context:'low[ -]profile|retro runners'}],reviewedPhrases:['ballet-sneaker','ultraslim retro sneakers']};
const dictionary={entries:[{id:'suede',kind:'material',aliases:['suede']},{id:'nike',kind:'brand',aliases:['Nike']}]};
const markup=(body,{publishedAt='2026-09-20T10:00:00Z',modifiedAt='2026-09-27T10:00:00Z',articleUrl=url,title='Current sneaker trends for fall',sponsor}={})=>`<html><script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',url:articleUrl,headline:title,datePublished:publishedAt,dateModified:modifiedAt,...(sponsor?{sponsor}:{} )})}</script><nav><h3>Suede Sneakers</h3><p>Never use menu text.</p></nav><article><h1>${title}</h1>${body}</article><footer><h3>Suede Sneakers</h3><p>Never use footer text.</p></footer></html>`;
const body='<p>We may earn a commission from affiliate links.</p><h3>Retro Low Tops</h3><p>Low-profile retro runners are current this fall.</p><h3>Netting</h3><p>Netted fishnet panels make these sneakers feel airy.</p><div class="UnifiedProductCard"><h3>Suede Sneakers</h3><p>A long product description that cannot be an editorial style trend.</p></div><div class="related-articles"><h3>Suede Sneakers</h3><p>This linked recommendation is also excluded.</p></div>';

test('Style headings come from independent article sections; affiliate disclosure is not sponsored content',()=>{
  const result=parseStyleEditorial(markup(body),{url,source,config,dictionary,now});assert.deepEqual(result.terms.map(t=>t.term),['Retro Low Tops','Netting']);assert.equal(result.publishedAt,'2026-09-20T10:00:00.000Z');assert.equal(result.contentHash.length,64);
  assert(!editorialBlocks(markup(body)).some(b=>b.text==='Suede Sneakers'));
  assert.throws(()=>parseStyleEditorial(markup(body,{sponsor:{name:'Advertiser'}}),{url,source,config,dictionary,now}),/INDEPENDENT/);
});
test('Article dates and origin are verified; a recent modification cannot revive an old publication',()=>{
  for(const publishedAt of ['2026-07-13T10:00:00Z','2026-09-29T00:00:00Z','invalid'])assert.throws(()=>parseStyleEditorial(markup(body,{publishedAt}),{url,source,config,dictionary,now}),/PUBLICATION/);
  assert.throws(()=>parseStyleEditorial(markup(body,{articleUrl:'https://different.example/story/sneaker-trends'}),{url,source,config,dictionary,now}),/METADATA/);
  assert.throws(()=>parseStyleEditorial(markup(body,{title:'The shoe forecast for next year'}),{url,source,config,dictionary,now}));
});
test('Exact headline/paragraph style phrases are retained; product names and section ordinal are not rankings',()=>{
  const html=markup('<p>Ultraslim retro sneakers continue into fall.</p><h2>1. Suede Sneakers</h2><p>Suede sneakers are a current choice for textured upper materials.</p><h2>Suede Heels</h2><p>These heels are outside the target range.</p>',{title:'The Ballet-Sneaker Trend for Fall'});
  const result=parseStyleEditorial(html,{url,source,config,dictionary,now});assert.deepEqual(result.terms.map(t=>t.term),['Ballet-Sneaker','Ultraslim retro sneakers','1. Suede Sneakers']);
});
test('Discovery uses only reviewed same-origin article links and bounded current RSS entries',()=>{
  const html='<a href="/story/new-sneaker-trends">New sneaker trends</a><a href="https://evil.example/story/sneaker-trends">Sneaker trends</a><a href="/shop/sneaker-trends">Shop</a><a href="/story/handbag-trends">Bag trends</a>';
  assert.deepEqual(discoverStyleArticles(html,source,{now}),['https://magazine.example/story/new-sneaker-trends']);
  const rss='<rss><channel><item><title>Fall sneaker trends</title><link>https://magazine.example/story/new-sneaker-trends</link><pubDate>Sun, 20 Sep 2026 10:00:00 GMT</pubDate></item><item><title>Old shoe trends</title><link>https://magazine.example/story/old-shoe-trends</link><pubDate>Tue, 01 Jul 2025 00:00:00 GMT</pubDate></item></channel></rss>';
  assert.deepEqual(discoverStyleArticles(rss,source,{now}),['https://magazine.example/story/new-sneaker-trends']);
});
test('Bounded collection returns unranked keywords and source metadata, never full article bodies',async()=>{
  const calls=[],other='https://magazine.example/story/new-sneaker-trends';
  const result=await collectStyleEditorials({now,config,dictionary,auditDir:null,readPublic:async value=>{calls.push(value);if(value===source.feedUrl)return '<rss><channel></channel></rss>';if(value===source.discoveryUrl)return `<a href="${other}">New sneaker trends</a><a href="/story/third-sneaker-trends">More sneaker trends</a>`;return markup(body,{articleUrl:value});}});
  assert.equal(calls.length,4);assert.deepEqual(calls.slice(2),[url,other]);assert.equal(result.sourceRanks.length,4);assert(result.sourceRanks.every(r=>r.rank===null&&r.kind==='editorial-keyword'&&r.publishedAt&&r.sourceUrl===r.evidenceUrl));assert.equal(result.editorialStatus[0].status,'available');assert(!JSON.stringify(result).includes('body'));assert(!JSON.stringify(result).includes('A long product description'));
  const failed=await collectStyleEditorials({now,config,dictionary,auditDir:null,readPublic:async()=>{throw Error('offline');}});assert.equal(failed.sourceRanks.length,0);assert.equal(failed.editorialStatus[0].status,'unavailable');
});
