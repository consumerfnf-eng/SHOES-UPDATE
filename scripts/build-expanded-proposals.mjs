// Finalized, audited schema-3 inputs only. No catalog/inventory/private-source resolver.
// Validation is the default; --render explicitly authorizes local artifact generation.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {BOARD_SIZE,HERO_RECT,referenceRect,jpegPdf} from '../public/assets/board-export.mjs';
import {validateExpandedProposals} from './proposal-quality.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const run=promisify(execFile),hash=value=>createHash('sha256').update(value).digest('hex');
const SEASONS=['27SS','27FW','28SS'],QUOTAS={daily:10,feminine:10,active:9,seasonal:6};
export const MAX_PROPOSAL_ASSET_BYTES=24*1024*1024;
export const SEASON_JPEG_SIZE={width:3000,height:1687,quality:.86};
export function assertProposalAssetSize(size,label){if(size>=MAX_PROPOSAL_ASSET_BYTES)throw Error(`${label} must be below 24 MiB (got ${size} bytes)`);}
const pdfLinks=idea=>[...idea.references.map((r,i)=>{const f=referenceRect({hero:true},i);return {url:r.url,rect:[f.x,f.y,f.width,215]};}),{url:idea.hero.url,rect:[HERO_RECT.x,HERO_RECT.y,HERO_RECT.width,660]}];
const nonempty=v=>typeof v==='string'&&v.trim().length>0;
const webUrl=v=>{try{const u=new URL(v);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}};

export function expandedPublicFile(publicRoot,url){
 if(typeof url!=='string'||!url.startsWith('/')||url.startsWith('//')||/[?#\\]/.test(url))throw Error('Expected same-origin public asset: '+url);
 const decoded=decodeURIComponent(url);
 if(decoded.split('/').includes('..')||decoded.includes('\\')||decoded.includes('\0'))throw Error('Unsafe public asset: '+url);
 const file=path.resolve(publicRoot,'.'+decoded),relative=path.relative(path.resolve(publicRoot),file);
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Unsafe public asset: '+url);
 return file;
}

export function validateExpandedConfig(config,reports){
 if(config?.schemaVersion!==3||!Array.isArray(config.ideas)||config.ideas.length!==105)throw Error('Schema 3 requires exactly 105 finalized ideas');
 if(config.seasons&&JSON.stringify(config.seasons)!==JSON.stringify(SEASONS))throw Error('Expected seasons 27SS, 27FW, 28SS');
 const ids=new Set(),titles=new Set();
 for(const season of SEASONS){
  const list=config.ideas.filter(i=>i.season===season);
  if(list.length!==35)throw Error('Exactly 35 ideas required: '+season);
  for(const [category,count] of Object.entries(QUOTAS))if(list.filter(i=>i.category===category).length!==count)throw Error('Wrong category quota: '+season+' '+category);
 }
 for(const i of config.ideas){
  if(!/^[a-z0-9-]+$/.test(i.id||'')||i.id.length>100||ids.has(i.id))throw Error('Duplicate or unsafe idea id: '+i.id);ids.add(i.id);
  const title=String(i.title||'').normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}]+/gu,'');
  if(!title||titles.has(title))throw Error('Duplicate or missing concept title: '+i.id);titles.add(title);
  if(!['core-update','new-extension','experimental'].includes(i.designRole)||!Array.isArray(i.tags)||!i.tags.every(nonempty)||!nonempty(i.insight))throw Error('Incomplete proposal copy: '+i.id);
  for(const [field,keys] of Object.entries({construction:['last','upper','closure','sole','distinctive'],mlbFit:['target','carryover','change','reason','feasibility']}))for(const k of keys)if(!nonempty(i[field]?.[k]))throw Error('Missing '+field+'.'+k+': '+i.id);
  if(!Array.isArray(i.references)||i.references.length!==6||new Set(i.references.map(r=>r.kind+':'+r.id)).size!==6)throw Error('Six distinct references required: '+i.id);
  if(!i.hero||!nonempty(i.hero.sourceSeason)||!nonempty(i.hero.credit)||!['same-season','earlier-season','curated-season'].includes(i.hero.seasonRelation))throw Error('Hero source season/credit/relation required: '+i.id);
  for(const r of [...i.references,i.hero]){
   if(!nonempty(r.id)||!webUrl(r.url)||!nonempty(r.name))throw Error('Incomplete source identity: '+i.id);
   for(const field of ['image','original'])if(r[field]!=null)expandedPublicFile('/public-root',r[field]);
   if(!r.image&&!r.original)throw Error('Missing source image: '+i.id);
   if(r.sourceDate!=null&&typeof r.sourceDate!=='string')throw Error('Source date must remain a string: '+i.id);
  }
  if(!Array.isArray(i.forecast)||!i.forecast.length||i.forecast.some(f=>!nonempty(f.id)||!Number.isInteger(f.page)||f.page<1||!webUrl(f.url)||!nonempty(f.heading)||!nonempty(f.claim)))throw Error('Explicit forecast page/heading/claim required: '+i.id);
  if(i.boardCopy!=null)for(const k of ['insight','application','memo'])if(i.boardCopy[k]!=null&&typeof i.boardCopy[k]!=='string')throw Error('boardCopy must contain strings: '+i.id);
 }
 if(!Array.isArray(reports))throw Error('Official forecast report index required for final schema-3 validation');
 const quality=validateExpandedProposals(config,reports,{requireReview:true});
 return {ideas:105,seasons:SEASONS.map(season=>({season,total:35,...QUOTAS})),boardSize:BOARD_SIZE,quality};
}

// Keep the editable import fallback exactly; boardCopy overrides even empty strings.
export function expandedBoardFields(idea){
 const board={id:idea.id,season:idea.season,project:`MLB ${idea.season} · ${idea.title}`.trim().slice(0,60),title:[idea.title,idea.subtitle].filter(Boolean).join(' · '),tags:(idea.tags||[]).map(t=>'#'+t).join(' '),tagsMode:'manual',insight:idea.insight,
  application:(idea.strategies||Object.entries(idea.construction||{}).map(([k,v])=>`${({last:'라스트',upper:'갑피',closure:'여밈',sole:'밑창',distinctive:'차별 요소'})[k]||k}: ${v}`)).filter(t=>!t.startsWith('검증')).join('\n'),
  memo:(Number(idea.targetPrice)>0?`목표가 가설 · ${Number(idea.targetPrice).toLocaleString('ko-KR')}원\n`:'')+(idea.strategies||[]).filter(t=>t.startsWith('검증')).join('\n')};
 if(idea.mlbFit?.reason)board.memo+='\nMLB 적합 근거 · '+idea.mlbFit.reason;
 if(idea.mlbFit?.feasibility)board.memo+='\n실현 가능성 · '+idea.mlbFit.feasibility;
 for(const k of ['insight','application','memo'])if(typeof idea.boardCopy?.[k]==='string')board[k]=idea.boardCopy[k];
 return board;
}

async function atomic(file,bytes){
 await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';
 try{await fs.writeFile(temp,bytes);await fs.rename(temp,file);}finally{await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
async function fileHash(file){return hash(await fs.readFile(file));}
async function cached(stamp,digest,files){
 try{const receipt=JSON.parse(await fs.readFile(stamp,'utf8'));return receipt.digest===digest&&(await Promise.all(files.map(async f=>receipt.artifacts[path.basename(f)]===await fileHash(f)))).every(Boolean);}catch(e){if(['ENOENT','ENOTDIR'].includes(e.code)||e instanceof SyntaxError)return false;throw e;}
}
async function stampArtifacts(stamp,digest,files){await atomic(stamp,JSON.stringify({digest,artifacts:Object.fromEntries(await Promise.all(files.map(async f=>[path.basename(f),await fileHash(f)])))}));}

const MIME={'.mjs':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.avif':'image/avif'};
const DOCUMENT=`<!doctype html><html lang="ko"><meta charset="utf-8"><style>@font-face{font-family:Pretendard;font-weight:500;src:url('/assets/fonts/Pretendard-Medium.woff2')}@font-face{font-family:Pretendard;font-weight:700;src:url('/assets/fonts/Pretendard-Bold.woff2')}</style><body></body></html>`;

export async function createExpandedRenderer({publicRoot=path.join(ROOT,'public'),cacheDir=path.join(ROOT,'.cache/expanded-proposals'),previewOnly=false,previewDir}={}){
 publicRoot=path.resolve(publicRoot);cacheDir=path.resolve(cacheDir);
 if(previewOnly){if(!previewDir)throw Error('Private previewDir required for candidate layout pilots');previewDir=path.resolve(previewDir);const rel=path.relative(publicRoot,previewDir);if(!rel||(!rel.startsWith('..')&&!path.isAbsolute(rel)))throw Error('Candidate pilot outputs must stay outside the public root');}
 const modules=['board-export.mjs','board-store.mjs','board-crop.mjs','reference-boards.mjs','research-brief.mjs'];
 const version=hash(JSON.stringify(await Promise.all([fileURLToPath(import.meta.url),...modules.map(m=>path.join(publicRoot,'assets',m)),...['Medium','Bold'].map(w=>path.join(publicRoot,'assets/fonts',`Pretendard-${w}.woff2`))].map(fileHash))));
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://local');
  if(url.pathname==='/__expanded-render.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(DOCUMENT);return;}
  const file=expandedPublicFile(publicRoot,url.pathname),real=await fs.realpath(file),rel=path.relative(await fs.realpath(publicRoot),real);
  if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('outside public root');
  const data=await fs.readFile(real);res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream'}).end(data);
 }catch{res.writeHead(404).end();}});
 let browser,page,renders=0;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const origin=`http://127.0.0.1:${server.address().port}`;
 const close=async()=>{try{await browser?.close();}finally{await new Promise(r=>server.close(r));}};
 try{
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1600,height:900},deviceScaleFactor:1});
  await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  page=await context.newPage();await page.goto(origin+'/__expanded-render.html');
 }catch(e){await close();throw e;}
 return {version,close,async renderIdea(idea){
  const sources=[...idea.references,idea.hero],sourceHashes=[];
  if(!previewOnly&&sources.some(source=>source?.reviewStatus!=='reviewed'))throw Error('Rendering requires visually reviewed photos: '+idea.id);
  for(const source of sources)for(const field of ['image','original'])if(source[field]){
   const file=expandedPublicFile(publicRoot,source[field]),real=await fs.realpath(file),rel=path.relative(await fs.realpath(publicRoot),real);
   if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('Source escapes public root');
   sourceHashes.push([source[field],await fileHash(real)]);
  }
  const digest=hash(JSON.stringify({version,previewOnly,idea,sourceHashes})),name=`expanded-${idea.id}-${digest.slice(0,16)}`,dir=path.join(previewOnly?previewDir:path.join(publicRoot,'proposals'),name),stamp=path.join(cacheDir,name+'.json');
  const seasonPage=path.join(cacheDir,name+'.jpg'),files=[...['board.png','preview.webp','board.pdf'].map(f=>path.join(dir,f)),seasonPage];
  const assets={download:`/proposals/${name}/board.png`,preview:`/proposals/${name}/preview.webp`,pdf:`/proposals/${name}/board.pdf`};
  if(await cached(stamp,digest,files))return {...assets,digest,cached:true,files,seasonPage,links:pdfLinks(idea)};
  // Recycle the page periodically; no collection of source bitmaps/canvases survives a board.
  if(renders++&&renders%8===0)await page.reload();
  const result=await page.evaluate(async({idea,fields,seasonSize})=>{
   const {snapshotSource}=await import('/assets/board-store.mjs'),{proposalEntrySource}=await import('/assets/reference-boards.mjs');
   const {FULL_CROP}=await import('/assets/board-crop.mjs'),{drawBoardPage,jpegPdf,referenceRect,HERO_RECT,BOARD_WIDTH}=await import('/assets/board-export.mjs');
   const board={...fields,entries:[]},assets=new Map();
   for(const source of idea.references){const {entry,asset}=await snapshotSource(proposalEntrySource(source,{colorway:source.color,style:source.style}));board.entries.push(entry);assets.set(asset.id,asset);}
   const hero=await snapshotSource(proposalEntrySource(idea.hero,{},true));hero.entry.crop={...FULL_CROP};board.hero=hero.entry;assets.set(hero.asset.id,hero.asset);
   const canvas=await drawBoardPage(board,board.entries,assets,{width:BOARD_WIDTH}),preview=document.createElement('canvas');preview.width=1600;preview.height=900;preview.getContext('2d').drawImage(canvas,0,0,1600,900);
   const blob=(c,type,quality)=>new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error('Canvas encoding failed')),type,quality));
   const png=await blob(canvas,'image/png'),webp=await blob(preview,'image/webp',.86),jpeg=await blob(canvas,'image/jpeg',.98);
   const seasonCanvas=document.createElement('canvas');seasonCanvas.width=seasonSize.width;seasonCanvas.height=seasonSize.height;seasonCanvas.getContext('2d').drawImage(canvas,0,0,seasonCanvas.width,seasonCanvas.height);const seasonJpeg=await blob(seasonCanvas,'image/jpeg',seasonSize.quality);
   const links=[...board.entries.map((entry,i)=>{const r=referenceRect(board,i);return {url:entry.sourceUrl,rect:[r.x,r.y,r.width,215]};}),{url:board.hero.sourceUrl,rect:[HERO_RECT.x,HERO_RECT.y,HERO_RECT.width,660]}];
   const pdf=jpegPdf([{bytes:new Uint8Array(await jpeg.arrayBuffer()),width:canvas.width,height:canvas.height,links}]);
   const base64=async b=>{const bytes=new Uint8Array(await b.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);};
   const result={png:await base64(png),preview:await base64(webp),pdf:await base64(pdf),seasonJpeg:await base64(seasonJpeg),width:canvas.width,height:canvas.height};
   canvas.width=preview.width=seasonCanvas.width=1;canvas.height=preview.height=seasonCanvas.height=1;assets.clear();return result;
  },{idea,fields:expandedBoardFields(idea),seasonSize:SEASON_JPEG_SIZE});
  if(result.width!==BOARD_SIZE.width||result.height!==BOARD_SIZE.height)throw Error('Incorrect canvas dimensions');
  for(const [i,key] of ['png','preview','pdf','seasonJpeg'].entries()){const bytes=Buffer.from(result[key],'base64');assertProposalAssetSize(bytes.length,idea.id+' '+key);await atomic(files[i],bytes);}
  await stampArtifacts(stamp,digest,files);return {...assets,digest,cached:false,files,seasonPage,links:pdfLinks(idea)};
 },async renderOverview(season,rows,files){
  if(rows.length!==35)throw Error('Season overview requires 35 tiles');
  const encoded=await page.evaluate(async({season,rows})=>{
   await Promise.all([document.fonts.load('500 20px Pretendard'),document.fonts.load('700 20px Pretendard')]);
   const canvas=document.createElement('canvas');canvas.width=6000;canvas.height=3375;const ctx=canvas.getContext('2d');ctx.scale(3.75,3.75);ctx.textBaseline='top';ctx.fillStyle='#fff';ctx.fillRect(0,0,1600,900);
   const text=(value,x,y,width,size,lines=1,weight=500,color='#344d64')=>{ctx.font=`${weight} ${size}px Pretendard`;ctx.fillStyle=color;const chars=[...String(value||'')];for(let row=0;row<lines&&chars.length;row++){let line='';while(chars.length&&ctx.measureText(line+chars[0]).width<=width)line+=chars.shift();if(row===lines-1&&chars.length){while(ctx.measureText(line+'…').width>width)line=line.slice(0,-1);line+='…';}ctx.fillText(line,x,y+row*size*1.3);}};
   text(`MLB · ${season} · 35개 디자인 기획안`,32,28,1500,27,1,700);text('데일리 10 · 페미닌 10 · 액티브 9 · 시즈널 6  /  개별 사진 출처와 상세 적용안은 시즌 전체 PDF에서 확인',32,68,1500,12);
   const categories={daily:'데일리',feminine:'페미닌',active:'액티브',seasonal:'시즈널'};
   for(const [i,row] of rows.entries()){
    const x=32+i%5*310,y=110+Math.floor(i/5)*104;ctx.fillStyle='#f6f8fa';ctx.fillRect(x,y,298,96);
    const response=await fetch(row.preview);if(!response.ok)throw Error('Missing overview preview');const bitmap=await createImageBitmap(await response.blob());
    // Crop the hero pane out of the small board preview, preserving its full context.
    const sx=bitmap.width/1600,sy=bitmap.height/900;ctx.drawImage(bitmap,48*sx,165*sy,432*sx,586*sy,x+8,y+6,62,84);bitmap.close();
    text(`${String(i+1).padStart(2,'0')} · ${categories[row.category]||row.category}`,x+80,y+8,208,9);
    text(row.title,x+80,y+25,208,14,2,700,'#19394e');
    text([row.hero.sourceSeason,row.hero.credit].filter(Boolean).join(' · '),x+80,y+66,208,8,2);
   }
   text('MLB 기획안 · 실제 MLB 제품 사진이 아님. 화보의 실제 출처 시즌은 기획 시즌과 별도로 표기했습니다.',32,866,1535,10);
   const preview=document.createElement('canvas');preview.width=1600;preview.height=900;preview.getContext('2d').drawImage(canvas,0,0,1600,900);
   const encode=async(c,type,q)=>{const b=await new Promise(r=>c.toBlob(r,type,q)),bytes=new Uint8Array(await b.arrayBuffer());let bin='';for(let i=0;i<bytes.length;i+=32768)bin+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(bin);};
   const result=[await encode(canvas,'image/png'),await encode(preview,'image/webp',.86)];canvas.width=preview.width=1;return result;
  },{season,rows:rows.map(r=>({title:r.idea.title,category:r.idea.category,hero:{sourceSeason:r.idea.hero.sourceSeason,credit:r.idea.hero.credit},preview:r.result.preview}))});
  for(const [i,value] of encoded.entries()){const bytes=Buffer.from(value,'base64');assertProposalAssetSize(bytes.length,'Season overview');await atomic(files[i],bytes);}
 }};
}

export async function writeExpandedSeasonPdf(pages,target,{python='python'}={}){
 const raw=target+'.'+randomUUID()+'.raw.tmp',optimized=target+'.'+randomUUID()+'.tmp';await fs.mkdir(path.dirname(target),{recursive:true});
 try{
  const records=[];for(const page of pages)records.push({bytes:await fs.readFile(page.seasonPage),...SEASON_JPEG_SIZE,links:page.links});
  const pdf=jpegPdf(records);await fs.writeFile(raw,new Uint8Array(await pdf.arrayBuffer()));
  // Lossless PDF-object cleanup only; JPEGs are encoded once from the native canvas.
  await run(python,['-c',`import sys\nfrom pypdf import PdfReader,PdfWriter\nr=PdfReader(sys.argv[1]);w=PdfWriter();w.append(r)\nfor page in w.pages: page.compress_content_streams()\nw.compress_identical_objects(remove_identicals=True,remove_orphans=True)\nw.write(sys.argv[2]);w.close()\nassert len(PdfReader(sys.argv[2]).pages)==int(sys.argv[3])`,raw,optimized,String(pages.length)],{maxBuffer:1024*1024});
  const size=(await fs.stat(optimized)).size;assertProposalAssetSize(size,'Season PDF');await fs.rename(optimized,target);return size;
 }finally{for(const file of [raw,optimized])await fs.unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}

export async function mergeExpandedPdfs(files,target,{python='python'}={}){
 const temp=target+'.'+randomUUID()+'.tmp';await fs.mkdir(path.dirname(target),{recursive:true});
 try{
  await run(python,['-c',`import json,sys\nfrom pypdf import PdfReader,PdfWriter\njob=json.loads(sys.argv[1]); writer=PdfWriter()\nfor file in job['files']:\n reader=PdfReader(file)\n if len(reader.pages)!=1: raise ValueError('Expected single-page proposal')\n writer.append(reader)\nwriter.write(job['output'])\nwriter.close()\ncheck=PdfReader(job['output'])\nassert len(check.pages)==len(job['files'])\nassert all(abs(float(p.mediabox.width)/float(p.mediabox.height)-16/9)<0.0001 for p in check.pages)`,JSON.stringify({files,output:temp})],{maxBuffer:1024*1024});
  await fs.rename(temp,target);
 }finally{await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}

export async function buildExpandedProposals({config,configPath=path.join(ROOT,'data/season-proposals.json'),publicRoot=path.join(ROOT,'public'),outputPath,cacheDir=path.join(ROOT,'.cache/expanded-proposals'),reports,render=false,now=new Date(),python='python',onProgress=console.log}={}){
 config??=JSON.parse(await fs.readFile(configPath,'utf8'));reports??=JSON.parse(await fs.readFile(path.join(publicRoot,'data/forecast.json'),'utf8')).reports;const plan=validateExpandedConfig(config,reports);
 if(!render){onProgress('Schema 3 validated; rendering withheld. After the audit, run build-expanded-proposals.mjs --config <finalized.json> --render.');return {rendered:false,...plan};}
 // Verify the only season-PDF dependency before producing any artifacts.
 await run(python,['-c','import pypdf']);
 publicRoot=path.resolve(publicRoot);outputPath??=path.join(publicRoot,'data/season-proposals.json');
 const renderer=await createExpandedRenderer({publicRoot,cacheDir}),built=[];
 const output={schemaVersion:3,asOf:config.asOf||now.toISOString().slice(0,10),brand:config.brand||'MLB',boardSize:BOARD_SIZE,coverage:config.coverage||{},sourceDates:config.sourceDates||{},method:config.method||'',seasons:SEASONS,ideas:[],seasonBoards:{}};
 try{
  for(const idea of config.ideas){
   const result=await renderer.renderIdea(idea);built.push(result);output.ideas.push({...idea,download:result.download,preview:result.preview,pdf:result.pdf});
   onProgress(`${built.length}/105 ${idea.id} ${result.cached?'cached':'rendered'} at 6000×3375`);
  }
  for(const season of SEASONS){
   const rows=output.ideas.map((idea,i)=>({idea,result:built[i]})).filter(r=>r.idea.season===season),digest=hash(JSON.stringify(rows.map(r=>r.result.digest))),name=`expanded-season-${season.toLowerCase()}-${digest.slice(0,16)}`,dir=path.join(publicRoot,'proposals',name);
   const files=['board.png','preview.webp','season.pdf'].map(f=>path.join(dir,f)),stamp=path.join(cacheDir,name+'.json');
   if(!await cached(stamp,digest,files)){
    await renderer.renderOverview(season,rows,files);
    await writeExpandedSeasonPdf(rows.map(r=>r.result),files[2],{python});await stampArtifacts(stamp,digest,files);
   }
   const pdfBytes=(await fs.stat(files[2])).size;assertProposalAssetSize(pdfBytes,'Season PDF');
   output.seasonBoards[season]={download:`/proposals/${name}/board.png`,preview:`/proposals/${name}/preview.webp`,pdf:`/proposals/${name}/season.pdf`,pdfBytes,pages:35,total:35,overview:'contact-sheet',previewNote:'35개 기획안 전체 보기 · 상세 보드는 시즌 전체 PDF에 수록',categoryCounts:{...QUOTAS}};
   onProgress(`${season}: 35-page PDF ready`);
  }
  // Publish the snapshot last; hashed asset directories preserve every previous release.
  await atomic(outputPath,JSON.stringify(output)+'\n');return output;
 }finally{await renderer.close();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),value=flag=>{const i=args.indexOf(flag);if(i<0)return undefined;if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing '+flag+' value');return path.resolve(args[i+1]);};
 const known=new Set(['--render','--config','--public-root','--output','--cache-dir']);for(let i=0;i<args.length;i++){if(!known.has(args[i]))throw Error('Unknown argument: '+args[i]);if(args[i]!=='--render')i++;}
 await buildExpandedProposals({configPath:value('--config'),publicRoot:value('--public-root'),outputPath:value('--output'),cacheDir:value('--cache-dir'),render:args.includes('--render')});
}
