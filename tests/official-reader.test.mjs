import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfficialReader,officialHtmlMarkdown,assertReadableOfficial,pacedOfficialFetch} from '../scripts/official-reader.mjs';
const url='https://shoe.example/products/abc';
const html='<title>ABC Sneakers</title><h1>ABC Sneakers</h1><p>ABC-001 running sneakers with mesh cushioning. Available from October 1, 2026. This description describes the official shoe.</p><a href="/products/abc">ABC-001 product details</a><img alt="ABC-001 side" src="/abc.jpg">';
test('official HTML preserves headings and exact links without executing scripts',()=>{
 const text=officialHtmlMarkdown(html+'<script>throw Error("bad")</script>',url);
 assert(text.includes('# ABC Sneakers'));assert(text.includes('![ABC-001 side](https://shoe.example/abc.jpg)'));assert(!text.includes('throw Error'));
});
test('lazy gallery images preserve card binding and a usable responsive image instead of a base64 placeholder',()=>{
 const text=officialHtmlMarkdown(html+'<a href="/products/lazy"><img src="data:image/gif;base64,abc" data-srcset="https://shoe.example/lazy.jpg?w=490 490w, https://shoe.example/lazy.jpg?w=1300&amp;h=1300 1300w, https://shoe.example/lazy.jpg?w=4096 4096w" alt="Lazy sneaker side">Lazy sneaker</a>',url);
 assert(text.includes('[![Lazy sneaker side](https://shoe.example/lazy.jpg?w=1300&h=1300)Lazy sneaker](https://shoe.example/products/lazy)'));
 assert(!text.includes('base64'));assert(!text.includes('w=4096'));
});
test('an empty src is not a photograph of the page it sits on',()=>{
 const text=officialHtmlMarkdown(html+'<a href="/products/empty"><img src="" alt="Empty placeholder">Empty sneaker</a>',url);
 assert(!text.includes('![Empty placeholder]'));
 // Nothing in the page may claim the page's own address as an image.
 assert(!/!\[[^\]]*\]\(https:\/\/shoe\.example\/products\/(?:abc|empty)\)/.test(text),text);
 // An empty href is not a link either: it resolved to the document itself.
 assert(!officialHtmlMarkdown(html+'<a href="">Nowhere</a>',url).includes('[Nowhere]('));
});
test('a picture element reads the renditions its sources name when its img carries no src',()=>{
 const picture='<a href="/products/prax"><picture>'
  +'<source media="(min-width: 1440px)" srcset="https://shoe.example/prax_SLR.jpg?w=1000, https://shoe.example/prax_SLR.jpg?w=2000 2x">'
  +'<source media="(min-width: 768px)" data-srcset="https://shoe.example/prax_SLS.jpg?w=1200, https://shoe.example/prax_SLS.jpg?w=2400 2x">'
  +'<img alt="Prax sneakers" draggable="false"></picture>Prax sneakers</a>';
 const text=officialHtmlMarkdown(html+picture,url);
 // A density srcset names no widths, so the 1x candidate is the one the page shows.
 assert(text.includes('![Prax sneakers](https://shoe.example/prax_SLR.jpg?w=1000)'),text);
 assert(!text.includes('prax_SLR.jpg?w=2000'));
 // A picture whose img already has its own source is left exactly as it was.
 const own=officialHtmlMarkdown(html+'<picture><source srcset="https://shoe.example/ignored.jpg 900w"><img src="/own.jpg" alt="Own"></picture>',url);
 assert(own.includes('![Own](https://shoe.example/own.jpg)'));assert(!own.includes('ignored.jpg'));
});
test('official requests honor cooldowns and retry transient failures without retrying denials',async()=>{
 let time=0,calls=0;const waits=[];const sleep=async ms=>{waits.push(ms);time+=ms;};
 const f=pacedOfficialFetch({now:()=>time,sleep,fetchImpl:async()=>++calls===1?new Response('',{status:429,headers:{'Retry-After':'8'}}):new Response('ok')});
 assert.equal((await f(url,{})).status,200);assert.equal(calls,2);assert(waits.includes(8000));
 let denied=0;const deny=pacedOfficialFetch({sleep,fetchImpl:async()=>{denied++;return new Response('',{status:403});}});
 assert.equal((await deny(url,{})).status,403);assert.equal(denied,1);
 let attempts=0;const timeout=pacedOfficialFetch({sleep,fetchImpl:async()=>{if(++attempts===1)throw new DOMException('timeout','TimeoutError');return new Response('ok');}});
 assert.equal((await timeout(url,{})).status,200);assert.equal(attempts,2);
});
test('security interstitials and not-found screens never count as readable',()=>{
 for(const body of ['Title: Just a moment...\nhello','Title: \nPowered and protected by\n[Akamai](https://akamai.com)','YOUR ACCESS TO YSL.COM IS TEMPORARILY RESTRICTED','# PAGE NOT FOUND'])assert.throws(()=>assertReadableOfficial(body));
});
test('fallback is restricted to reviewed official origins and never sends credentials',async()=>{
 const requests=[];const reader=createOfficialReader({origins:[url],read:async()=>{throw Error('Source HTTP 403');},fetchImpl:async(u,options)=>{requests.push({u,options});return new Response(html);}});
 assert((await reader.read('https://r.jina.ai/'+url)).includes('ABC-001'));assert.equal(requests.length,1);assert.equal(requests[0].options.redirect,'error');assert(!requests[0].options.headers.Authorization);
 await assert.rejects(reader.read('https://r.jina.ai/https://unreviewed.example/'));assert.equal(requests.length,1);
});
