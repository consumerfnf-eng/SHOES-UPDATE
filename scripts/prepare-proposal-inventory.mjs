// Private reference inventory. Does not change the product catalog or classify it.
import fs from 'node:fs/promises';import {createHash} from 'node:crypto';
import {variantGroupKey} from '../public/assets/catalog-view.mjs';
import {siteBrandGroup} from '../public/assets/site-brand-policy.mjs';
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const catalog=await read('public/data/catalog.json'),catwalk=await read('public/data/catwalk.json');
const byModel=new Map();
for(const p of catalog.products){
 const original=p.presentation?.cachedPath;if(!/^\/images\/[a-f0-9]{64}\.(?:jpg|webp|png)$/.test(original||''))continue;
 if(/\b(?:pump|stiletto|slingback|wedge heel|heeled sandal|heeled boot)\b|펌프스|하이힐|슬링백/i.test(p.name))continue;
 const key=p.brand+'|'+variantGroupKey(p),g=siteBrandGroup(p.brand);
 const candidate={...p,modelKey:key,group:g};
 const old=byModel.get(key);const quality=r=>Number(r.presentation?.imageQuality?.score||0)+(r.presentation?.frame?.width||.7)*(r.presentation?.frame?.height||.5);
 if(!old||quality(candidate)>quality(old))byModel.set(key,candidate);
}
const models=[...byModel.values()],selected=models.filter(p=>p.group==='LUX');
const others=new Map();for(const p of models.filter(p=>p.group!=='LUX')){if(!others.has(p.brand))others.set(p.brand,[]);others.get(p.brand).push(p);}
const novelty=p=>(/mary.?jane|ballet|sandal|slide|slipper|mule|boot|clog|barefoot|메리제인|발레|샌들|슬라이드|슬리퍼|뮬|부츠|클로그/i.test(p.name)?100:0)+(/trail|hike|climb|strap|moc|loaf|트레일|하이크|스트랩/i.test(p.name)?50:0);
for(const list of others.values())selected.push(...list.sort((a,b)=>novelty(b)-novelty(a)||a.modelKey.localeCompare(b.modelKey)).slice(0,14));
const records=[];
for(const p of selected){
 const image=p.presentation.cachedPath,path='public'+image;
 try{const bytes=await fs.readFile(path),hash=createHash('sha256').update(bytes).digest('hex');records.push({key:'product:'+p.id,id:p.id,kind:'product',brand:p.brand,name:p.name,group:p.group,modelKey:p.modelKey,imageHash:hash,path,image,original:image,url:p.url,credit:p.brand+' · 브랜드 공식',sourceSeason:'',sourceDate:p.officialProductEvidence?.verifiedAt||p.firstPublishedAt||'',text:[p.name,p.fullName,p.material,p.colorway,p.description,p.officialCategory,...(p.keywords||[])].filter(Boolean).join(' '),productType:p.productType||p.category,frame:p.presentation.frame||null,style:p.style||'',color:p.colorway||'',listPrice:p.listPrice||p.priceKRW||null});}catch{}
}
for(const p of catwalk.looks){
 if((p.hashtags||[]).some(t=>/heeledpump|slingback|wedgeheels/i.test(t)))continue;
 try{const path='public'+p.image,hash=createHash('sha256').update(await fs.readFile(path)).digest('hex');records.push({key:'show:'+p.id,id:p.id,kind:'show',brand:p.brand,name:p.brand+' · '+(p.collection==='fashion-feed'?'Fashion Feed':'Runway'),modelKey:'show:'+p.id,imageHash:hash,path,image:p.image,original:p.image,url:p.sourceFeedUrl||p.originalUrl||p.sourceUrl,credit:p.brand+' · '+(p.collection==='fashion-feed'?'WGSN Fashion Feed':'WGSN Runway'),sourceSeason:p.season,sourceDate:p.sourceDate||'',width:p.width,height:p.height,text:[p.brand,p.season,p.imageType,...(p.hashtags||[])].filter(Boolean).join(' '),collection:p.collection||'runway'});}catch{}
}
const mlb=await read('.secrets/proposals-105/mlb-baselines.json').catch(()=>({records:[]}));records.push(...mlb.records);
const unique=new Map();for(const r of records)if(!unique.has(r.key))unique.set(r.key,r);
const all=[...unique.values()];await fs.mkdir('.secrets/proposals-105',{recursive:true});
await fs.writeFile('.secrets/proposals-105/inventory.json',JSON.stringify({schemaVersion:1,createdAt:new Date().toISOString(),records:all}));
const images=[...new Map(all.map(r=>[r.imageHash,{imageHash:r.imageHash,path:r.path,products:[{id:r.id,brand:r.brand,name:r.name,modelKey:r.modelKey}]}])).values()];
await fs.writeFile('.secrets/proposals-105/features-manifest.json',JSON.stringify({schemaVersion:1,images}));
console.log(JSON.stringify({records:all.length,photos:images.length,types:all.reduce((a,r)=>(a[r.kind]=(a[r.kind]||0)+1,a),{})}));
