import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

// Only actual public snapshots establish publication; discovery/import dates do not.
export async function migratePublicationHistory(directory=process.cwd()) {
  const file=path.join(directory,'data/publication-history.json');
  try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const entries={};
  const revisions=execFileSync('git',['log','--reverse','--format=%H %cI','--','public/data/catalog.json'],{cwd:directory,encoding:'utf8'}).trim().split('\n');
  for(const row of revisions){
    const [commit,at]=row.trim().split(' ');if(!at)continue;
    let snapshot;try{snapshot=JSON.parse(execFileSync('git',['show',`${commit}:public/data/catalog.json`],{cwd:directory,encoding:'utf8',maxBuffer:40_000_000,stdio:['ignore','pipe','ignore']}));}catch{continue;}
    // Exclude pre-curation raw imports and never treat planned releases as posted.
    if(!snapshot.sourceStatus||snapshot.schemaVersion!==1)continue;
    for(const p of snapshot.products||[])if(p.id&&p.eligibility?.passed&&p.releaseStatus==='released'&&!entries[p.id])entries[p.id]={firstPublishedAt:at,sourceCommit:commit,brand:p.brand,style:p.style,url:p.url};
  }
  const prior=JSON.parse(await fs.readFile(path.join(directory,'public/data/catalog.json'),'utf8'));
  for(const p of prior.products||[])if(!entries[p.id])entries[p.id]={firstPublishedAt:prior.publishedAt,brand:p.brand,style:p.style,url:p.url,basis:'earliest-available-public-snapshot'};
  const history={schemaVersion:1,retentionMonths:3,basis:'first-published-kst-calendar-day',entries};
  await fs.writeFile(file,JSON.stringify(history,null,2));return history;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const h=await migratePublicationHistory();console.log(`Recovered ${Object.keys(h.entries).length} publication timestamps from Git snapshots.`);}
