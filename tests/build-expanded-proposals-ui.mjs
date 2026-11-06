// Explicit, isolated fixture render only. Never reads or renders the private 105 config.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createExpandedRenderer,mergeExpandedPdfs,writeExpandedSeasonPdf,MAX_PROPOSAL_ASSET_BYTES} from '../scripts/build-expanded-proposals.mjs';
import {proposalFixture} from './proposal-hero-fixture.mjs';

const temp=await fs.mkdtemp(path.join(os.tmpdir(),'expanded-proposal-test-')),publicRoot=path.join(temp,'public');
await fs.mkdir(publicRoot,{recursive:true});await fs.cp(path.resolve('public/assets'),path.join(publicRoot,'assets'),{recursive:true});
execFileSync('python',['-c',`from PIL import Image,ImageDraw\nfrom pathlib import Path\nroot=Path(__import__('sys').argv[1])\nfor i in range(7):\n im=Image.new('RGB',(200,400),'#e00020'); ImageDraw.Draw(im).rectangle((0,200,200,400),fill='#0044cc'); im.save(root/f'fixture-{i}.png')`,publicRoot]);
const legacy=path.join(publicRoot,'proposals/legacy/board.png');await fs.mkdir(path.dirname(legacy),{recursive:true});await fs.writeFile(legacy,'previous released asset');
let renderer;
try{
 renderer=await createExpandedRenderer({publicRoot,cacheDir:path.join(temp,'cache')});const idea=proposalFixture().ideas[0];idea.boardCopy={insight:'짧은 인사이트',application:'갑피와 밑창 적용',memo:''};
 await assert.rejects(()=>renderer.renderIdea(idea),/visually reviewed/);for(const r of [idea.hero,...idea.references])r.reviewStatus='reviewed';
 const first=await renderer.renderIdea(idea);assert.equal(first.cached,false);assert.match(first.download,/\/expanded-/);assert.equal((await fs.readFile(first.files[0])).readUInt32BE(16),6000);assert.equal((await fs.readFile(first.files[0])).readUInt32BE(20),3375);
 const second=await renderer.renderIdea(idea);assert.equal(second.cached,true);assert.equal(second.digest,first.digest);
 const season=path.join(temp,'season.pdf');await mergeExpandedPdfs([first.files[2],first.files[2]],season);
 const lightweight=path.join(temp,'season-35.pdf');const seasonBytes=await writeExpandedSeasonPdf(Array(35).fill(first),lightweight);assert(seasonBytes<MAX_PROPOSAL_ASSET_BYTES);
 const overview=[path.join(temp,'overview.png'),path.join(temp,'overview.webp')];await renderer.renderOverview('27SS',proposalFixture().ideas.slice(0,35).map(idea=>({idea,result:first})),overview);
 const seasonInfo=JSON.parse(execFileSync('python',['-c',`import json,sys\nfrom PIL import Image\nfrom pypdf import PdfReader\nr=PdfReader(sys.argv[1]); p=r.pages[0]; im=next(iter(p['/Resources']['/XObject'].values())).get_object(); overview=Image.open(sys.argv[2]); pixels=[overview.getpixel((int((32+c*310+39)*3.75),int((110+row*104+20)*3.75)))[:3] for row in range(7) for c in range(5)]\nprint(json.dumps({'pages':len(r.pages),'image':[im['/Width'],im['/Height']],'overview':list(overview.size),'tiles':len(pixels),'redTiles':sum(1 for v in pixels if v[0]>180 and v[1]<30),'jpegPreserved':im.get_data()==__import__('pathlib').Path(sys.argv[3]).read_bytes()}))`,lightweight,overview[0],first.seasonPage],{encoding:'utf8'}));
 assert.equal(seasonInfo.pages,35);assert.deepEqual(seasonInfo.image,[3000,1687]);assert.deepEqual(seasonInfo.overview,[6000,3375]);assert.equal(seasonInfo.tiles,35);assert.equal(seasonInfo.redTiles,35);assert.equal(seasonInfo.jpegPreserved,true,'PDF cleanup must preserve encoded JPEG bytes');
 const inspection=JSON.parse(execFileSync('python',['-c',`import json,sys\nfrom PIL import Image\nfrom pypdf import PdfReader\nroot=sys.argv[1]; png=Image.open(sys.argv[2]); preview=Image.open(sys.argv[3]); pdf=PdfReader(sys.argv[4]); season=PdfReader(sys.argv[5]); pixel=png.getpixel((990,862))\nprint(json.dumps({'preview':list(preview.size),'singlePages':len(pdf.pages),'seasonPages':len(season.pages),'box':[float(x) for x in pdf.pages[0].mediabox],'links':len(pdf.pages[0]['/Annots']),'heroTop':list(pixel[:3])}))`,publicRoot,first.files[0],first.files[1],first.files[2],season],{encoding:'utf8'}));
 assert.deepEqual(inspection.preview,[1600,900]);assert.equal(inspection.singlePages,1);assert.equal(inspection.seasonPages,2);assert.deepEqual(inspection.box,[0,0,960,540]);assert.equal(inspection.links,7);assert(inspection.heroTop.every((v,i)=>Math.abs(v-[224,0,32][i])<=3),'JPEG-preserved editorial hero keeps full upper-body context, without shoe auto-cropping');
 await fs.writeFile(first.files[0],'damaged');const repaired=await renderer.renderIdea(idea);assert.equal(repaired.cached,false);assert.equal((await fs.readFile(first.files[0])).readUInt32BE(16),6000);
 await fs.appendFile(path.join(publicRoot,'fixture-0.png'),Buffer.from('fixture-byte-change'));const changed=await renderer.renderIdea(idea);assert.notEqual(changed.digest,first.digest);assert.notEqual(changed.download,first.download);assert.equal(await fs.readFile(legacy,'utf8'),'previous released asset');assert((await fs.stat(first.files[2])).size>0);
 console.log('PASS: 35-page lightweight PDF below 24 MiB, actual 35-tile overview; isolated native 6000×3375 canvas, hero FULL_CROP, 7 PDF links, WebP, multipage PDF merge, artifact-byte cache validation, source-byte invalidation, previous assets preserved.');
}finally{await renderer?.close();}
