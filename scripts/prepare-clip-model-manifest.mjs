import fs from 'node:fs/promises';
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const all=await read('.secrets/clip/manifest.json'),audit=await read('.secrets/clip/site-audit-v2.json').catch(()=>read('.secrets/clip/site-audit.json'));
const reviewed=new Map(audit.records.map(r=>[r.imageHash,r.truth||null]));
const models=new Map();for(const row of all.images)for(const p of row.products){if(!models.has(p.modelKey))models.set(p.modelKey,[]);models.get(p.modelKey).push(row);}
const selected=new Map();
for(const rows of models.values()){
 const options=[...rows].sort((a,b)=>(reviewed.get(b.imageHash)?1:0)-(reviewed.get(a.imageHash)?1:0)||(reviewed.has(a.imageHash)&&!reviewed.get(a.imageHash)?1:0)-(reviewed.has(b.imageHash)&&!reviewed.get(b.imageHash)?1:0)||a.imageHash.localeCompare(b.imageHash));
 selected.set(options[0].imageHash,options[0]);
}
const images=[...selected.values()].sort((a,b)=>a.imageHash.localeCompare(b.imageHash));
const manifest={...all,catalogImages:all.images.length,totalModels:models.size,selection:'One stable representative photo per existing verified design group; colour variants share the design label, no product regrouping.',images};
await fs.writeFile('.secrets/clip/model-manifest.json',JSON.stringify(manifest));
console.log(JSON.stringify({catalogImages:all.images.length,models:models.size,representatives:images.length}));
