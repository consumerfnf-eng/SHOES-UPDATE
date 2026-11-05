import fs from 'node:fs/promises';import {spawnSync} from 'node:child_process';
import path from 'node:path';import os from 'node:os';
const literal=value=>value===null?'NULL':typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'";
const render=(sql,params)=>{let at=0;const result=sql.replace(/\?/g,()=>literal(params[at++]));if(at!==params.length)throw Error('Incorrect SQL binding count');return result;};
export function adminD1(){
 let serial=0;
 let binary;
 async function execute(sql,query=false){
  if(!binary){const cache=process.platform==='win32'?path.join(process.env.LOCALAPPDATA,'npm-cache','_npx'):path.join(os.homedir(),'.npm','_npx');const candidates=[];for(const dir of await fs.readdir(cache)){const file=path.join(cache,dir,'node_modules','wrangler','bin','wrangler.js');const stat=await fs.stat(file).catch(()=>null);if(stat)candidates.push({file,time:stat.mtimeMs});}binary=candidates.sort((a,b)=>b.time-a.time)[0]?.file;if(!binary)throw Error('Run npx wrangler --version once before using the operator helper');}
  await fs.mkdir('.secrets',{recursive:true});const file=`.secrets/admin-operation-${process.pid}-${serial++}.sql`;await fs.writeFile(file,sql,{mode:0o600});
  let run;for(let attempt=0;attempt<3;attempt++){
   run=spawnSync(process.execPath,[binary,'d1','execute','shoes-admin-monitor','--remote',...(query?['--command',sql]:['--file',file]),'--json'],{encoding:'utf8',maxBuffer:16*1024*1024});
   if(run.status===0){try{const start=run.stdout.search(/^\s*\[\s*\{/m);return JSON.parse(run.stdout.slice(start<0?0:start).trim());}catch{}}
   if(attempt<2)await new Promise(r=>setTimeout(r,1200*(attempt+1)));
  }
  await fs.writeFile('.secrets/admin-operation-error.log',(run?.stderr||'')+'\n'+(run?.stdout||''),{mode:0o600});throw Error('D1 operation failed; see private diagnostics');
 }
 return {execute,prepare(sql){let args=[];return {bind(...params){args=params;return this;},async all(){const result=await execute(render(sql,args),true);return {results:result.flatMap(r=>r.results||[])};},async first(){return (await this.all()).results[0]||null;}};}};
}
