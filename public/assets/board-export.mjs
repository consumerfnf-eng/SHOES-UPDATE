import {boardPages,safeSourceUrl} from './board-store.mjs';
import {drawCroppedImage} from './board-crop.mjs';
const encoder=new TextEncoder();
export const BOARD_WIDTH=6000,BOARD_HEIGHT=3375;
export const BOARD_SIZE=Object.freeze({width:BOARD_WIDTH,height:BOARD_HEIGHT});
export const HERO_RECT=Object.freeze({x:48,y:165,width:432,height:586});
export function referenceRect(board,index){return board.hero?{x:500+index%2*308,y:165+Math.floor(index/2)*220,width:290,height:120}:{x:48+index%3*344,y:165+Math.floor(index/3)*340,width:328,height:215};}
// All positions use a 1600×900 coordinate system; scale uniformly for the output.
export function getBoardLayout({hero=false}={}){return {baseWidth:1600,baseHeight:900,width:BOARD_WIDTH,height:BOARD_HEIGHT,hero:hero?{...HERO_RECT}:null,references:Array.from({length:6},(_,i)=>referenceRect({hero},i)),copy:{x:hero?1120:1115,y:172,width:hero?432:435,maxHeight:650},title:{x:48,y:66,width:1480,size:32,minSize:16,weight:700},tags:{x:48,y:119,width:1460,size:18,weight:700},footerY:850,fontFamily:'Pretendard',fontWeight:500,referenceCaptions:hero?{memoOffset:129,creditOffset:164,nameOffset:181,memoSize:11,creditSize:9,nameSize:10}:{memoOffset:261,creditOffset:224,nameOffset:296,memoSize:11,creditSize:10,nameSize:11}};}
export function sourceCredit(entry){return [entry.credit||entry.brand,entry.sourceSeason||(entry.kind==='show'?'':entry.color)].filter(Boolean).join(' · ');}
export function boardHeaderText(board){
 const prefix=`MLB ${board.season} ·`,stored=String(board.project||''),project=stored.startsWith(prefix)?stored.slice(prefix.length).trimStart():stored;
 return ['MLB',board.season,project].filter(Boolean).join(' · ');
}
export function boardTextLines(ctx,text,width){
 const lines=[];
 for(const paragraph of String(text||'').split('\n')){
  let line='',space='';
  // Hangul can break by character. Other words stay intact unless wider than a line.
  for(const token of paragraph.match(/\s+|\p{Script=Hangul}|[^\s\p{Script=Hangul}]+/gu)||[]){
   if(/^\s+$/u.test(token)){space=line?token:'';continue;}
   if(ctx.measureText(token).width>width){
    if(line){lines.push(line);line='';}
    for(const char of token){if(line&&ctx.measureText(line+char).width>width){lines.push(line);line='';}line+=char;}
   }else if(line&&ctx.measureText(line+space+token).width>width){lines.push(line);line=token;}
   else line+=space+token;
   space='';
  }
  lines.push(line);
 }
 return lines;
}
const lineText=boardTextLines;
function wrap(ctx,text,x,y,width,size,maxLines=99,color='#34445a',weight=500){ctx.font=`${weight} ${size}px Pretendard`;ctx.fillStyle=color;const lines=lineText(ctx,text,width);if(lines.length>maxLines)throw Error('글이 배치 영역보다 깁니다. 제목·메모를 조금 줄여주세요.');for(const [i,line] of lines.entries())ctx.fillText(line,x,y+i*size*1.45);return lines.length*size*1.45;}
function caption(ctx,text,x,y,width,size,maxLines,color,weight=500){ctx.font=`${weight} ${size}px Pretendard`;const lines=lineText(ctx,text,width);if(lines.length<=maxLines)return wrap(ctx,text,x,y,width,size,maxLines,color,weight);let shortened=String(text);while(shortened&&lineText(ctx,shortened+'…',width).length>maxLines)shortened=shortened.slice(0,-1);return wrap(ctx,shortened+'…',x,y,width,size,maxLines,color,weight);}
export async function drawBoardPage(board,entries,assets,{width=1600,page=1,pages=1}={}){
 await Promise.all([document.fonts.load('500 20px Pretendard'),document.fonts.load('700 20px Pretendard')]);if(!document.fonts.check('500 20px Pretendard')||!document.fonts.check('700 20px Pretendard'))throw Error('Pretendard 글꼴을 불러오지 못했습니다.');
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=Math.round(width*9/16);const ctx=canvas.getContext('2d');ctx.scale(width/1600,width/1600);ctx.fillStyle='#fff';ctx.fillRect(0,0,1600,900);ctx.textBaseline='top';
 wrap(ctx,boardHeaderText(board),48,33,1450,15,1,'#5b7182');let titleSize=32;while(titleSize>16){ctx.font=`700 ${titleSize}px Pretendard`;if(ctx.measureText(board.title||board.project).width<=1480)break;titleSize--;}ctx.font=`700 ${titleSize}px Pretendard`;if(ctx.measureText(board.title||board.project).width>1480)throw Error('제목이 너무 깁니다. 제목을 조금 줄여 주세요.');wrap(ctx,board.title||board.project,48,66,1480,titleSize,1,'#152c40',700);
 const tags=String(board.tags||'').split(/[\s,]+/).filter(Boolean).map(t=>t.startsWith('#')?t:'#'+t).join(' ');caption(ctx,tags,48,119,1460,18,2,'#376b69',700);
 if(board.hero){
  const e=board.hero,asset=assets.get(e.assetId);if(!asset)throw Error('저장된 대표 화보가 없습니다.');
  const bitmap=await createImageBitmap(asset.blob);ctx.fillStyle='#f5f7f9';ctx.fillRect(HERO_RECT.x,HERO_RECT.y,HERO_RECT.width,HERO_RECT.height);drawCroppedImage(ctx,bitmap,e.crop,HERO_RECT.x,HERO_RECT.y,HERO_RECT.width,HERO_RECT.height);bitmap.close();
  caption(ctx,'스타일링·화보 레퍼런스 · '+sourceCredit(e),48,765,432,11,2,'#526779');
  const relation=e.seasonRelation==='earlier-season'?'이전 시즌 사진 · 기획 참고':e.seasonRelation==='same-season'?'동일 시즌 출처 사진':'출처 사진';
  caption(ctx,[e.sourceSeason,relation,e.sourceDate,e.name].filter(Boolean).join(' · '),48,805,432,10,2,'#657887');
 }
 for(let i=0;i<6;i++){
  const rect=referenceRect(board,i),{x,y,width:w,height:h}=rect,e=entries[i];ctx.fillStyle='#f6f8fa';ctx.fillRect(x,y,w,h);
  if(!e){wrap(ctx,'REFERENCE '+(i+1),x+12,y+h/2-8,w-24,13,1,'#a7b2be');continue;}
  const asset=assets.get(e.assetId);if(!asset)throw Error('저장된 사진이 없습니다. 백업을 가져오거나 사진을 다시 담아주세요.');
  const bitmap=await createImageBitmap(asset.blob);drawCroppedImage(ctx,bitmap,e.crop,x+8,y+8,w-16,h-16);bitmap.close();
  const memo=[e.roleLabel||e.role,e.memo].filter(Boolean).join(' · ');
  if(board.hero){
   caption(ctx,memo||'디자인 레퍼런스',x,y+129,w,11,2,'#476d70');caption(ctx,sourceCredit(e),x,y+164,w,9,1,'#738092');caption(ctx,e.name,x,y+181,w,10,2,'#33475c');
  }else{
   caption(ctx,sourceCredit(e),x,y+224,w,10,2,'#738092');if(memo)caption(ctx,memo,x,y+261,w,11,2,'#657c7c');caption(ctx,e.name,x,y+(memo?296:272),w,11,2,'#33475c');
  }
 }
 const x=board.hero?1120:1115,w=board.hero?432:435;let size=23,layout;
 for(;size>=12;size--){ctx.font=`500 ${size}px Pretendard`;layout=[['INSIGHT',board.insight],['MLB 적용 아이템',board.application],['기획 메모',board.memo]].filter(([,t])=>t);const height=layout.reduce((n,[,t])=>n+54+lineText(ctx,t,w).length*size*1.45,0);if(height<=650)break;}
 if(size<12)throw Error('본문이 한 페이지보다 깁니다. 인사이트·적용안·기획 메모를 줄여주세요.');
 let y=172;for(const [label,text] of layout){wrap(ctx,label,x,y,w,14,1,'#406a7b');y+=29;y+=wrap(ctx,text,x,y,w,size,99,'#263c50')+25;}
 if(!layout.length)wrap(ctx,'인사이트와 MLB 적용안을 입력하면\n여기에 표시됩니다.',x,y,w,21,5,'#9aa8b5');
 ctx.strokeStyle='#e1e7ec';ctx.beginPath();ctx.moveTo(48,850);ctx.lineTo(1552,850);ctx.stroke();wrap(ctx,`SHOES RESEARCH · ${board.season} · 사진·출처는 담은 시점 기준`,48,865,1300,11,1,'#718194');wrap(ctx,`${page} / ${pages}`,1490,865,70,11,1,'#718194');return canvas;
}
export function jpegPdf(pages){
 const chunks=[],offsets=[0];let length=0;const add=data=>{const bytes=typeof data==='string'?encoder.encode(data):data;chunks.push(bytes);length+=bytes.length;};
 add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');const total=2+pages.length*3+pages.reduce((n,p)=>n+(p.links||[]).length,0);let next=3+pages.length*3;
 const object=(id,body)=>{offsets[id]=length;add(`${id} 0 obj\n`);add(body);add('\nendobj\n');};
 object(1,'<< /Type /Catalog /Pages 2 0 R >>');object(2,`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_,i)=>`${3+i*3} 0 R`).join(' ')}] >>`);
 for(const [i,p] of pages.entries()){const id=3+i*3,links=p.links||[],annotations=links.map(()=>next++),pixelWidth=p.width||BOARD_WIDTH,pixelHeight=p.height||BOARD_HEIGHT,pdfHeight=960*pixelHeight/pixelWidth;object(id,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 ${pdfHeight}] /Resources << /XObject << /Image ${id+1} 0 R >> >> /Contents ${id+2} 0 R /Annots [${annotations.map(a=>a+' 0 R').join(' ')}] >>`);
 offsets[id+1]=length;add(`${id+1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>\nstream\n`);add(p.bytes);add('\nendstream\nendobj\n');const content=`q 960 0 0 ${pdfHeight} 0 0 cm /Image Do Q\n`;object(id+2,`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);
 for(const [j,link] of links.entries()){const url=safeSourceUrl(link.url).replace(/([\\()])/g,'\\$1');const [x,y,w,h]=link.rect;object(annotations[j],`<< /Type /Annot /Subtype /Link /Rect [${x*.6} ${(900-y-h)*pdfHeight/900} ${(x+w)*.6} ${(900-y)*pdfHeight/900}] /Border [0 0 0] /A << /S /URI /URI (${url}) >> >>`);}}
 const xref=length;add(`xref\n0 ${total+1}\n0000000000 65535 f \n`);for(let i=1;i<=total;i++)add(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);add(`trailer\n<< /Size ${total+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);return new Blob(chunks,{type:'application/pdf'});
}
export async function exportBoardPages(board,assets,type,onProgress=()=>{}){
 const groups=boardPages(board),output=[],pdf=[];for(const [i,entries] of groups.entries()){onProgress(i+1,groups.length);const canvas=await drawBoardPage(board,entries,assets,{width:BOARD_WIDTH,page:i+1,pages:groups.length});if(type==='pdf'){const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.98));pdf.push({bytes:new Uint8Array(await blob.arrayBuffer()),width:canvas.width,height:canvas.height,links:[...entries.map((e,j)=>{const r=referenceRect(board,j);return {url:e.sourceUrl,rect:[r.x,r.y,r.width,board.hero?215:335]};}),...(board.hero?[{url:board.hero.sourceUrl,rect:[HERO_RECT.x,HERO_RECT.y,HERO_RECT.width,660]}]:[])].filter(l=>safeSourceUrl(l.url))});}else output.push(await new Promise(r=>canvas.toBlob(r,'image/png')));canvas.width=1;canvas.height=1;}
 return type==='pdf'?jpegPdf(pdf):output;
}
