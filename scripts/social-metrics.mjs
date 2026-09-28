import {createHash} from 'node:crypto';

const key=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const url=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
const validDay=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const day=value=>new Date(Date.parse(value)+9*3600000).toISOString().slice(0,10);
function cutoff(today){const [y,m,d]=today.split('-').map(Number),date=new Date(Date.UTC(y,m-4,1));date.setUTCDate(Math.min(d,new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate()));return date.toISOString().slice(0,10);}
const units={'search-count':'searches','hashtag-post-count':'posts','view-count':'views'};
const dimensions=m=>[m.platform,m.metric,m.unit,m.scope,m.identity?.level||'variant',m.country||'',m.periodStart||'',m.periodEnd||'',m.scope==='cumulative'?day(m.capturedAt):''];
const comparable=(a,b)=>JSON.stringify(dimensions(a))===JSON.stringify(dimensions(b));
const identityKey=m=>`${key(m.identity.brand)}|${m.identity.level==='model'?'model:'+key(m.identity.modelId):'variant:'+key(m.identity.style)}`;
export const qualifyingSocialMetric=m=>['search-count','hashtag-post-count'].includes(m.metric)&&Number.isFinite(m.value)&&m.value>0;

export function validateSocialMetrics(product,today,{officialEligible=false,now=new Date(today+'T23:59:59.999+09:00')}={}){
  if(!officialEligible)return [];
  const result=new Map(),start=cutoff(today);
  for(const raw of product.socialMetrics||[]){
    if(raw.verified!==true||!raw.platform||!raw.query||!url(raw.sourceUrl)||!units[raw.metric]||raw.unit!==units[raw.metric]||!['period','cumulative'].includes(raw.scope))continue;
    if(raw.value!==null&&(!Number.isSafeInteger(raw.value)||raw.value<0))continue;
    if(!Number.isFinite(Date.parse(raw.capturedAt))||Date.parse(raw.capturedAt)>new Date(now).getTime()||day(raw.capturedAt)<start||day(raw.capturedAt)>today)continue;
    const captureDay=day(raw.capturedAt);
    if(key(raw.identity?.brand)!==key(product.brand))continue;
    let identity;
    if(raw.identity?.level==='model'){
      const model=product.officialProductEvidence?.modelIdentity;
      if(model?.verified!==true||!model.id||!model.name||raw.identity.modelId!==model.id||key(raw.identity.modelName)!==key(model.name))continue;
      identity={level:'model',brand:product.brand,modelId:model.id,modelName:model.name};
    }else{
      if(raw.identity?.level&&raw.identity.level!=='variant'||!key(product.style)||key(raw.identity?.style)!==key(product.style))continue;
      identity={level:'variant',brand:product.brand,style:product.style};
    }
    if(raw.scope==='period'&&(!validDay(raw.periodStart)||!validDay(raw.periodEnd)||raw.periodStart<cutoff(captureDay)||raw.periodEnd<raw.periodStart||raw.periodEnd>captureDay||raw.periodEnd<start))continue;
    if(raw.scope==='cumulative'&&(raw.periodStart!=null||raw.periodEnd!=null))continue;
    const metric={platform:raw.platform,metric:raw.metric,value:raw.value,unit:raw.unit,scope:raw.scope,periodStart:raw.periodStart??null,periodEnd:raw.periodEnd??null,capturedAt:raw.capturedAt,sourceUrl:raw.sourceUrl,query:raw.query,country:raw.country||'',verified:true,identity};
    for(const field of ['platformName','sourceLabel','displayValue','evidenceUrl','verificationMethod','contentHash'])if(raw[field]!==undefined)metric[field]=raw[field];
    if(metric.evidenceUrl&&!url(metric.evidenceUrl))continue;
    const c=raw.comparison;
    if(c?.coverage==='published-ranking'&&c.verified===true&&c.population==='items'&&c.id&&Number.isInteger(c.rank)&&c.rank>0&&Number.isInteger(c.itemCount)&&c.itemCount>=c.rank&&url(c.sourceUrl)&&comparable({...metric,...c},metric)){
      // External ranks require every comparison dimension explicitly stated, never inferred.
      if(c.identityLevel===identity.level&&['platform','metric','unit','scope','country','periodStart','periodEnd'].every(f=>c[f]===metric[f]))metric.comparison={id:c.id,rank:c.rank,itemCount:c.itemCount,sourceUrl:c.sourceUrl,verified:true,population:'items',coverage:'published-ranking',platform:c.platform,metric:c.metric,unit:c.unit,scope:c.scope,identityLevel:identity.level,country:c.country,periodStart:c.periodStart,periodEnd:c.periodEnd};
    }
    const id=JSON.stringify([...dimensions(metric),key(metric.query)]),previous=result.get(id);
    if(!previous||Date.parse(metric.capturedAt)>Date.parse(previous.capturedAt))result.set(id,metric);
  }
  return [...result.values()];
}

export function withSocialComparisons(products){
  const groups=new Map();
  for(const p of products)for(const m of p.socialMetrics||[]){
    if(!qualifyingSocialMetric(m))continue;
    const group=JSON.stringify(dimensions(m));if(!groups.has(group))groups.set(group,new Map());
    const items=groups.get(group),id=identityKey(m),old=items.get(id);
    // Repeated captures/aliases for one exact item cannot increase its volume or sample size.
    if(!old||Date.parse(m.capturedAt)>Date.parse(old.capturedAt))items.set(id,m);
  }
  return products.map(p=>({...p,socialMetrics:(p.socialMetrics||[]).map(m=>{
    if(!qualifyingSocialMetric(m)||m.comparison?.coverage==='published-ranking')return m;
    const group=JSON.stringify(dimensions(m)),items=groups.get(group);if(!items||items.size<2)return m;
    const selected=items.get(identityKey(m));if(selected.capturedAt!==m.capturedAt||selected.value!==m.value)return m;
    const rank=1+[...items.values()].filter(x=>x.value>m.value).length;
    return {...m,comparison:{id:'sample-'+createHash('sha256').update(group).digest('hex').slice(0,16),rank,itemCount:items.size,verified:true,population:'items',coverage:'observed-sample',method:'descending-observed-value',platform:m.platform,metric:m.metric,unit:m.unit,scope:m.scope,identityLevel:m.identity.level,country:m.country,periodStart:m.periodStart,periodEnd:m.periodEnd}};
  })}));
}
