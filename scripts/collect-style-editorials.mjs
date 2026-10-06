import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readPublicSource,decodeText,parseEditorialFeed} from './source-feeds.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const escaped=value=>String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const plain=value=>decodeText(value).replace(/&mdash;/g,'—').replace(/&ndash;/g,'–').replace(/&rsquo;/g,'’').replace(/&lsquo;/g,'‘').replace(/&ldquo;/g,'“').replace(/&rdquo;/g,'”').replace(/\s+/g,' ').trim();
const footwear=/\b(?:sneakers?|trainers?|shoes?|footwear|clogs?|sandals?)\b/i;
const trend=/\btrends?\b|\bstyles?\b.{0,50}\b(?:dominate|current|season)\b/i;
const excludedTheme=/\b(?:heels?|pumps?|loafers?|boots?|slippers?|flats?)\b/i;
const excludedKinds=new Set(['brand','model','category','franchise']);
const literal=term=>new RegExp(`(?<![\\p{L}\\p{N}])${escaped(term)}(?![\\p{L}\\p{N}])`,'iu');
const normalize=term=>plain(term).toLowerCase().replace(/[‐‑–—-]/g,' ');

function sourceUrl(value,source){try{const url=new URL(decodeText(value),source.url);return url.protocol==='https:'&&url.hostname===source.domain&&!url.username&&!url.password&&url.pathname.startsWith(source.articlePrefix)?url.origin+url.pathname:'';}catch{return '';}}
function jsonArticles(html){const articles=[];function walk(value){if(!value||typeof value!=='object')return;if([value['@type']].flat().some(t=>['Article','NewsArticle','BlogPosting'].includes(t)))articles.push(value);for(const v of Object.values(value))if(v&&typeof v==='object')Array.isArray(v)?v.forEach(walk):walk(v);}for(const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{walk(JSON.parse(match[1]));}catch{}}return articles;}

// Tokenize article text with ancestor state, so product cards, navigation and
// recommended stories cannot supply editorial headings or paragraph phrases.
export function editorialBlocks(html){
  const blocks=[],stack=[],voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const cleaned=html.replace(/<!--[^]*?-->/g,'').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
  const skip=/UnifiedProductCard|upc_|product[-_ ]?(?:card|offer)|related[-_ ]?(?:stories|articles|content)|recirc|recommend|read[-_ ]?more|newsletter|affiliate[-_ ]?widget/i;
  function finish(node){if(node.capture){const text=plain(node.text);if(text)blocks.push({tag:node.tag,text,position:node.position});}}
  for(const token of cleaned.matchAll(/<\/?[a-z][^>]*>|[^<]+/gi)){
    const raw=token[0];if(raw[0]!=='<'){for(const node of stack)if(node.capture)node.text+=raw;continue;}
    const close=/^<\//.test(raw),tag=raw.match(/^<\/?([a-z0-9]+)/i)?.[1].toLowerCase();if(!tag)continue;
    if(close){const index=stack.findLastIndex(n=>n.tag===tag);if(index>=0)for(const node of stack.splice(index).reverse())finish(node);continue;}
    const parent=stack.at(-1),inside=tag==='article'||parent?.inside;
    const articleContainer=/\bdata-widget-type=["']contentparsed["']|\bid=["'](?:content|article-body)["']/i.test(raw);
    const excluded=parent?.excluded||['nav','aside','footer'].includes(tag)||skip.test(raw)&&!articleContainer;
    const node={tag,inside,excluded,position:token.index,capture:inside&&!excluded&&['h1','h2','h3','p'].includes(tag),text:''};
    if(!voids.has(tag)&&!raw.endsWith('/>'))stack.push(node);
  }
  return blocks.sort((a,b)=>a.position-b.position);
}

export function parseStyleEditorial(html,{url,source,config,dictionary,now=new Date()}){
  const canonical=sourceUrl(url,source);if(!canonical)throw Error('STYLE_ARTICLE_ORIGIN_INVALID');
  const candidates=jsonArticles(html).filter(a=>sourceUrl(a.url||a.mainEntityOfPage?.['@id']||a.mainEntityOfPage,source)===canonical);
  if(candidates.length!==1)throw Error('STYLE_ARTICLE_METADATA_AMBIGUOUS');
  const article=candidates[0],stamp=Date.parse(article.datePublished),nowMs=new Date(now).getTime(),cutoff=nowMs-(config.publicationDays||30)*86400000;
  if(!Number.isFinite(stamp)||stamp<cutoff||stamp>nowMs)throw Error('STYLE_ARTICLE_PUBLICATION_OUTSIDE_WINDOW');
  const blocks=editorialBlocks(html),headline=blocks.find(b=>b.tag==='h1')?.text||plain(article.headline||'');
  if(!blocks.length||!footwear.test(headline+' '+article.headline)||!trend.test(headline+' '+article.headline))throw Error('STYLE_ARTICLE_NOT_EXPLICIT_CURRENT_TREND');
  if(/\b(?:forecast|prediction|predicts?|sponsored|advertorial|paid partnership)\b/i.test(headline+' '+article.headline)||article.sponsor)throw Error('STYLE_ARTICLE_NOT_INDEPENDENT_CURRENT_EDITORIAL');
  const terms=new Map(),reviewed=config.reviewedHeadings||[],phrases=config.reviewedPhrases||[];
  const add=(term,origin)=>{const key=normalize(term);if(term.length<=90&&!terms.has(key))terms.set(key,{term,origin});};
  for(let i=0;i<blocks.length;i++){
    const block=blocks[i];
    if(['h2','h3'].includes(block.tag)&&!excludedTheme.test(block.text)){
      let end=i+1;while(end<blocks.length&&!['h1','h2','h3'].includes(blocks[end].tag))end++;
      const context=blocks.slice(i+1,end).filter(b=>b.tag==='p').map(b=>b.text).join(' '),rule=reviewed.find(r=>normalize(r.label)===normalize(block.text));
      if(rule&&new RegExp(rule.context,'i').test(context))add(block.text,'editorial-heading');
      else if(footwear.test(block.text)&&context.length>30&&(dictionary.entries||[]).some(entry=>!excludedKinds.has(entry.kind)&&entry.aliases?.some(alias=>literal(alias).test(block.text))))add(block.text,'editorial-heading');
    }
    if(block.tag==='h1'||block.tag==='p'&&/\b(?:trend|fall|spring|summer|winter|season|current|continue|dominate)\b/i.test(block.text))for(const phrase of phrases){const match=block.text.match(literal(phrase));if(match)add(match[0],block.tag==='h1'?'editorial-headline-phrase':'editorial-paragraph-phrase');}
  }
  return {url:canonical,title:headline,publishedAt:new Date(stamp).toISOString(),modifiedAt:article.dateModified||null,terms:[...terms.values()],contentHash:hash(html)};
}

export function discoverStyleArticles(body,source,{now=new Date()}={}){
  const found=[];
  if(/<(?:rss|feed)\b/i.test(body)){for(const row of parseEditorialFeed(body,{...source,domain:source.domain.replace(/^www\./,'')},{now}))found.push({url:row.url,title:row.title});}
  else for(const match of body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi))found.push({url:match[1],title:plain(match[2].replace(/<[^>]+>/g,' '))});
  return [...new Set(found.filter(row=>footwear.test(row.title+' '+row.url.replace(/-/g,' '))&&/trend|style|fall|spring|summer|winter/i.test(row.title+' '+row.url)).map(row=>sourceUrl(row.url,source)).filter(Boolean))].slice(0,30);
}

export async function collectStyleEditorials({now=new Date(),config,dictionary,readPublic=readPublicSource,auditDir=resolve(fileURLToPath(new URL('../logs/research/style-editorials/',import.meta.url)))}={}){
  config??=JSON.parse(await readFile(new URL('../config/style-editorials.json',import.meta.url),'utf8'));
  dictionary??=JSON.parse(await readFile(new URL('../config/search-term-dictionary.json',import.meta.url),'utf8'));
  const checkedAt=new Date(now).toISOString(),limit=Math.min(8,Math.max(1,config.maxArticlesPerSource||4));
  const results=await Promise.all((config.sources||[]).map(async source=>{
    const status={platform:source.id,name:source.name,url:source.url,kind:'editorial-keyword',checkedAt},diagnostics=[],candidates=[];
    for(const discovery of [source.feedUrl,source.discoveryUrl].filter(Boolean)){
      try{const url=new URL(discovery);if(url.hostname!==source.domain||url.protocol!=='https:')throw Error('STYLE_DISCOVERY_ORIGIN_INVALID');const body=await readPublic(discovery,{maxBytes:4_000_000});candidates.push(...discoverStyleArticles(body,source,{now}));diagnostics.push({stage:'discovery',url:discovery,status:'fetched'});}
      catch(error){diagnostics.push({stage:'discovery',url:discovery,status:'unavailable',reason:error.message});}
    }
    candidates.push(...(source.seeds||[]).map(url=>sourceUrl(url,source)).filter(Boolean));
    const articles=await Promise.all([...new Set(candidates)].slice(0,limit).map(async url=>{
      try{const body=await readPublic(url,{maxBytes:4_000_000}),parsed=parseStyleEditorial(body,{url,source,config,dictionary,now});
        if(auditDir){await mkdir(auditDir,{recursive:true});const file=`${source.id.replace(/[^a-z0-9.-]/gi,'_')}-${checkedAt.replace(/[:.]/g,'-')}-${parsed.contentHash.slice(0,16)}.json`;await writeFile(resolve(auditDir,file),JSON.stringify({checkedAt,url,contentHash:parsed.contentHash,publishedAt:parsed.publishedAt,modifiedAt:parsed.modifiedAt,terms:parsed.terms,body:{format:'html',text:body}},null,2)+'\n');}
        return {parsed};
      }catch(error){return {diagnostic:{stage:'article',url,status:'excluded',reason:error.message}};}
    }));
    const valid=articles.filter(a=>a.parsed),digest=hash(JSON.stringify(valid.map(a=>[a.parsed.url,a.parsed.contentHash]))),snapshotId=`${source.id}:${checkedAt}:${digest.slice(0,16)}`;
    const sourceRanks=valid.flatMap(({parsed})=>parsed.terms.map(({term,origin})=>({platform:source.id,platformName:source.name,term,rank:null,kind:'editorial-keyword',verified:true,sourceUrl:parsed.url,evidenceUrl:parsed.url,capturedAt:checkedAt,publishedAt:parsed.publishedAt,rankingPeriod:null,snapshotId,contentHash:parsed.contentHash,rankBasis:origin,scope:'footwear',sourceOriginalContext:parsed.title.slice(0,180)})));
    return {sourceRanks,status:{...status,status:valid.length?'available':'unavailable',count:sourceRanks.length,reason:sourceRanks.length?null:valid.length?'최근 30일 본문에서 스타일 트렌드 항목 미확인':'최근 30일 스타일 트렌드 원문 확인 불가'},diagnostics:[...diagnostics,...articles.flatMap(a=>a.diagnostic?[a.diagnostic]:[])]};
  }));
  return {checkedAt,sourceRanks:results.flatMap(r=>r.sourceRanks),editorialStatus:results.map(r=>r.status),diagnostics:results.flatMap(r=>r.diagnostics)};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){const result=await collectStyleEditorials();console.log(JSON.stringify({checkedAt:result.checkedAt,sourceRanks:result.sourceRanks,editorialStatus:result.editorialStatus,diagnostics:result.diagnostics},null,2));}
