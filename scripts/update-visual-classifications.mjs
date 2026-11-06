import fs from 'node:fs';import fsp from 'node:fs/promises';import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);
const args=process.argv.slice(2),modelAt=args.indexOf('--model-dir'),modelDir=modelAt>=0?args[modelAt+1]:'.secrets/clip-models/site-v2';
if(!modelDir)throw Error('Missing --model-dir');
await fsp.mkdir('.secrets/clip',{recursive:true});await fsp.mkdir('logs',{recursive:true});
if(args.includes('--background')){
 const log=fs.openSync('logs/clip-background-update.log','a');
 const child=spawn(process.execPath,[fileURLToPath(import.meta.url),...args.filter(a=>a!=='--background')],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log,log]});
 child.unref();fs.closeSync(log);console.log(JSON.stringify({backgroundPid:child.pid,log:'logs/clip-background-update.log'}));
}else{
 const lock='.secrets/clip/update.lock';
 try{const fd=fs.openSync(lock,'wx');fs.writeFileSync(fd,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));fs.closeSync(fd);}
 catch(error){if(error.code!=='EEXIST')throw error;let existing;try{existing=JSON.parse(fs.readFileSync(lock,'utf8'));process.kill(existing.pid,0);console.log(JSON.stringify({alreadyRunning:existing.pid}));process.exit(0);}catch(check){if(check.code!=='ESRCH')throw Error('Inspect the private CLIP update lock before retrying');}fs.unlinkSync(lock);fs.writeFileSync(lock,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}),{flag:'wx'});}
 const run=(command,params)=>{const result=spawnSync(command,params,{cwd:root,windowsHide:true,stdio:'inherit'});if(result.status!==0)throw Error(command+' failed; existing public snapshot retained until a validated atomic publication');};
 try{
  const metadataFile=path.join(modelDir,'metadata.json');if(!fs.existsSync(metadataFile)){console.log('Local model unavailable; existing classification snapshot retained.');process.exitCode=0;}
  else{
   const metadata=JSON.parse(fs.readFileSync(metadataFile,'utf8'));
   let manifest,audit;
   if(metadata.validated===true){run(process.execPath,['scripts/prepare-clip-manifest.mjs']);run(process.execPath,['scripts/prepare-clip-model-manifest.mjs']);manifest='.secrets/clip/model-manifest.json';}
   else{manifest='.secrets/clip/pilot-manifest.json';console.log('Quality gate closed: pilot review queue only; no bulk automatic classification.');}
   audit=fs.existsSync('.secrets/clip/site-audit-v2.json')?'.secrets/clip/site-audit-v2.json':'.secrets/clip/site-audit.json';
   if(!fs.existsSync(manifest))throw Error('A completed private pilot or validated model manifest is required');
   const python=process.env.CLIP_PYTHON||'python',view=metadata.encoder.includes('shoe-letterbox')?'shoe-letterbox':'original';
   run(python,['scripts/clip_classify.py','--manifest',manifest,'--view',view,'--threads','4','--batch','2','--features-only']);
   const publish=['scripts/publish_visual_classifications.py','--manifest',manifest,'--model-dir',modelDir,'--audit',audit];
   if(!args.includes('--publish'))publish.push('--output','.secrets/clip/preview-public.json','--queue-output','.secrets/clip/preview-admin.json');
   run(python,publish);
   if(args.includes('--sync-admin')){if(!args.includes('--publish'))throw Error('--sync-admin requires an operational --publish');run(process.execPath,['scripts/sync-visual-classification-queue.mjs','.secrets/clip/admin-queue.json']);}
   console.log(JSON.stringify({completed:true,automaticEnabled:metadata.validated===true,published:args.includes('--publish')}));
  }
 }finally{try{if(JSON.parse(fs.readFileSync(lock,'utf8')).pid===process.pid)fs.unlinkSync(lock);}catch{}}
}
