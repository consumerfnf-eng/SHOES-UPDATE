import {boardPages,safeSourceUrl} from './board-store.mjs';
const encoder=new TextEncoder();
export const BOARD_WIDTH=4800,BOARD_HEIGHT=2700;
export function sourceCredit(entry){let host='';try{host=new URL(entry.sourceUrl).hostname.replace(/^www\./,'');}catch{}return [entry.brand,entry.kind==='show'?entry.sourceSeason:entry.color,host].filter(Boolean).join(' · ');}
const lineText=(ctx,text,width)=>{const lines=[];for(const paragraph of String(text||'').split('\n')){let line='';for(const char of paragraph){if(line&&ctx.measureText(line+char).width>width){lines.push(line);line=char;}else line+=char;}lines.push(line);}return lines;};
function wrap(ctx,text,x,y,width,size,maxLines=99,color='#34445a'){ctx.font=`400 ${size}px Pretendard`;ctx.fillStyle=color;const lines=lineText(ctx,text,width);if(lines.length>maxLines)throw Error('글이 배치 영역보다 깁니다. 제목·메모를 조금 줄여주세요.');for(const [i,line] of lines.entries())ctx.fillText(line,x,y+i*size*1.45);return lines.length*size*1.45;}
function caption(ctx,text,x,y,width,size,maxLines,color){ctx.font=`400 ${size}px Pretendard`;const lines=lineText(ctx,text,width);if(lines.length<=maxLines)return wrap(ctx,text,x,y,width,size,maxLines,color);let shortened=String(text);while(shortened&&lineText(ctx,shortened+'…',width).length>maxLines)shortened=shortened.slice(0,-1);return wrap(ctx,shortened+'…',x,y,width,size,maxLines,color);}
export async function drawBoardPage(board,entries,assets,{width=1600,page=1,pages=1}={}){
 await document.fonts.load('400 20px Pretendard');if(!document.fonts.check('400 20px Pretendard'))throw Error('Pretendard 글꼴을 불러오지 못했습니다.');
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=width*9/16;const ctx=canvas.getContext('2d');ctx.scale(width/1600,width/1600);ctx.fillStyle='#fff';ctx.fillRect(0,0,1600,900);ctx.textBaseline='top';
 wrap(ctx,`MLB · ${board.season} · ${board.project}`,48,33,1450,15,1,'#5b7182');let titleSize=32;while(titleSize>22){ctx.font=`400 ${titleSize}px Pretendard`;if(ctx.measureText(board.title||board.project).width<=1480)break;titleSize--;}wrap(ctx,board.title||board.project,48,66,1480,titleSize,1,'#152c40');
 const tags=String(board.tags||'').split(/[\s,]+/).filter(Boolean).map(t=>t.startsWith('#')?t:'#'+t).join(' ');wrap(ctx,tags,48,119,1460,15,2,'#376b69');
 for(let i=0;i<6;i++){const x=48+(i%3)*344,y=165+Math.floor(i/3)*340,e=entries[i];ctx.fillStyle='#f6f8fa';ctx.fillRect(x,y,328,215);if(!e){wrap(ctx,'REFERENCE '+(i+1),x+18,y+95,280,15,1,'#a7b2be');continue;}const asset=assets.get(e.assetId);if(!asset)throw Error('저장된 사진이 없습니다. 백업을 가져오거나 사진을 다시 담아주세요.');const bitmap=await createImageBitmap(asset.blob);const scale=Math.min(312/bitmap.width,199/bitmap.height);ctx.drawImage(bitmap,x+164-bitmap.width*scale/2,y+107.5-bitmap.height*scale/2,bitmap.width*scale,bitmap.height*scale);bitmap.close();caption(ctx,sourceCredit(e),x,y+224,328,10,3,'#738092');caption(ctx,e.name,x,y+272,328,11,2,'#33475c');if(e.memo)wrap(ctx,e.memo,x,y+307,328,10,2,'#657c7c');}
 const x=1115,w=435;let size=23,layout;
 for(;size>=14;size--){ctx.font=`400 ${size}px Pretendard`;layout=[['INSIGHT',board.insight],['MLB 적용 아이템',board.application],['기획 메모',board.memo]].filter(([,t])=>t);const height=layout.reduce((n,[,t])=>n+47+lineText(ctx,t,w).length*size*1.5,0);if(height<=635)break;}
 if(size<14)throw Error('본문이 한 페이지보다 깁니다. 인사이트·적용안·기획 메모를 줄여주세요.');
 let y=172;for(const [label,text] of layout){wrap(ctx,label,x,y,w,14,1,'#406a7b');y+=29;y+=wrap(ctx,text,x,y,w,size,99,'#263c50')+25;}
 if(!layout.length)wrap(ctx,'인사이트와 MLB 적용안을 입력하면\n여기에 표시됩니다.',x,y,w,21,5,'#9aa8b5');
 ctx.strokeStyle='#e1e7ec';ctx.beginPath();ctx.moveTo(48,850);ctx.lineTo(1552,850);ctx.stroke();wrap(ctx,`SHOES RESEARCH · ${board.season} · 사진·출처는 담은 시점 기준`,48,865,1300,11,1,'#718194');wrap(ctx,`${page} / ${pages}`,1490,865,70,11,1,'#718194');return canvas;
}
export function jpegPdf(pages){
 const chunks=[],offsets=[0];let length=0;const add=data=>{const bytes=typeof data==='string'?encoder.encode(data):data;chunks.push(bytes);length+=bytes.length;};
 add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');const total=2+pages.length*3+pages.reduce((n,p)=>n+p.links.length,0);let next=3+pages.length*3;
 const object=(id,body)=>{offsets[id]=length;add(`${id} 0 obj\n`);add(body);add('\nendobj\n');};
 object(1,'<< /Type /Catalog /Pages 2 0 R >>');object(2,`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_,i)=>`${3+i*3} 0 R`).join(' ')}] >>`);
 for(const [i,p] of pages.entries()){const id=3+i*3,annotations=p.links.map(()=>next++);object(id,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Resources << /XObject << /Image ${id+1} 0 R >> >> /Contents ${id+2} 0 R /Annots [${annotations.map(a=>a+' 0 R').join(' ')}] >>`);
 offsets[id+1]=length;add(`${id+1} 0 obj\n<< /Type /XObject /Subtype /Image /Width 4800 /Height 2700 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>\nstream\n`);add(p.bytes);add('\nendstream\nendobj\n');const content='q 960 0 0 540 0 0 cm /Image Do Q\n';object(id+2,`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);
 for(const [j,link] of p.links.entries()){const url=safeSourceUrl(link.url).replace(/([\\()])/g,'\\$1');const [x,y,w,h]=link.rect;object(annotations[j],`<< /Type /Annot /Subtype /Link /Rect [${x*.6} ${(900-y-h)*.6} ${(x+w)*.6} ${(900-y)*.6}] /Border [0 0 0] /A << /S /URI /URI (${url}) >> >>`);}}
 const xref=length;add(`xref\n0 ${total+1}\n0000000000 65535 f \n`);for(let i=1;i<=total;i++)add(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);add(`trailer\n<< /Size ${total+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);return new Blob(chunks,{type:'application/pdf'});
}
export async function exportBoardPages(board,assets,type,onProgress=()=>{}){
 const groups=boardPages(board),output=[],pdf=[];for(const [i,entries] of groups.entries()){onProgress(i+1,groups.length);const canvas=await drawBoardPage(board,entries,assets,{width:4800,page:i+1,pages:groups.length});if(type==='pdf'){const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.98));pdf.push({bytes:new Uint8Array(await blob.arrayBuffer()),links:entries.map((e,j)=>({url:e.sourceUrl,rect:[48+(j%3)*344,165+Math.floor(j/3)*340,328,335]})).filter(l=>safeSourceUrl(l.url))});}else output.push(await new Promise(r=>canvas.toBlob(r,'image/png')));canvas.width=1;canvas.height=1;}
 return type==='pdf'?jpegPdf(pdf):output;
}
