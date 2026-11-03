export const FULL_CROP={x:0,y:0,width:1,height:1};
export function validCrop(value){return value&&['x','y','width','height'].every(k=>Number.isFinite(value[k]))&&value.x>=0&&value.y>=0&&value.width>.015&&value.height>.015&&value.x+value.width<=1.001&&value.y+value.height<=1.001;}
export function normalizeCrop(value){if(!validCrop(value))return {...FULL_CROP};const x=Math.max(0,value.x),y=Math.max(0,value.y);return {x,y,width:Math.min(1-x,value.width),height:Math.min(1-y,value.height)};}
export function zoomedCrop(base,zoom=1,positionX=.5,positionY=.5){base=normalizeCrop(base);const z=Math.max(1,Math.min(6,Number(zoom)||1)),width=base.width/z,height=base.height/z;return {x:Math.max(0,Math.min(1-width,base.x+base.width/2-width/2+(positionX-.5)*(1-width))),y:Math.max(0,Math.min(1-height,base.y+base.height/2-height/2+(positionY-.5)*(1-height))),width,height};}
// A border-colour foreground mask trims uniform studio backgrounds, including
// warm beige and vertical lighting gradients. Separate shoes are kept together.
export function detectShoeCrop({data,width:w,height:h},kind='product'){
 const samples=[];for(const [x,y] of [[0,0],[w-1,0],[0,h-1],[w-1,h-1]]){const i=(y*w+x)*4;samples.push([data[i],data[i+1],data[i+2]]);}
 const light=samples.every(c=>Math.min(...c)>145&&Math.max(...c)-Math.min(...c)<80);
 const spread=Math.max(...[0,1,2].map(k=>Math.max(...samples.map(c=>c[k]))-Math.min(...samples.map(c=>c[k]))));
 const lower=kind==='show'&&h>w*1.12?Math.floor(h*.40):0;
 if(!light||spread>85)return lower?{x:.025,y:.4,width:.95,height:.58}:{...FULL_CROP};
 const mask=new Uint8Array(w*h),edges=Math.max(2,Math.round(w*.015));let area=0;
 for(let y=0;y<h;y++){const bg=[0,0,0];for(let x=0;x<edges;x++)for(let c=0;c<3;c++)bg[c]+=(data[(y*w+x)*4+c]+data[(y*w+w-1-x)*4+c])/(edges*2);
  for(let x=0;x<w;x++){const i=(y*w+x)*4,delta=Math.abs(data[i]-bg[0])*.3+Math.abs(data[i+1]-bg[1])*.59+Math.abs(data[i+2]-bg[2])*.11;if(delta>8&&y>=lower){mask[y*w+x]=1;area++;}}
 }
 if(area<w*h*.008||area>w*h*.8)return lower?{x:.025,y:.4,width:.95,height:.58}:{...FULL_CROP};
 const seen=new Uint8Array(w*h),components=[];
 for(let at=0;at<mask.length;at++){if(!mask[at]||seen[at])continue;const stack=[at];seen[at]=1;let count=0,x0=w,y0=h,x1=0,y1=0;
  while(stack.length){const p=stack.pop(),x=p%w,y=Math.floor(p/w);count++;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);for(const q of [x>0?p-1:-1,x<w-1?p+1:-1,y>0?p-w:-1,y<h-1?p+w:-1])if(q>=0&&mask[q]&&!seen[q]){seen[q]=1;stack.push(q);}}
  components.push({count,x0,y0,x1,y1});
 }
 const largest=Math.max(0,...components.map(c=>c.count)),kept=components.filter(c=>c.count>=Math.max(12,largest*.035));if(!kept.length)return {...FULL_CROP};
 let x0=Math.min(...kept.map(c=>c.x0)),y0=Math.min(...kept.map(c=>c.y0)),x1=Math.max(...kept.map(c=>c.x1)),y1=Math.max(...kept.map(c=>c.y1));
 const pad=Math.max(4,Math.max(x1-x0,y1-y0)*.10);if((y1-y0)/(x1-x0)<.10)y0=Math.max(0,y0-(x1-x0)*.18);x0=Math.max(0,x0-pad);y0=Math.max(0,y0-pad);x1=Math.min(w,x1+pad);y1=Math.min(h,y1+pad);
 if(x1-x0<w*.14||y1-y0<h*.035)return {...FULL_CROP};return normalizeCrop({x:x0/w,y:y0/h,width:(x1-x0)/w,height:(y1-y0)/h});
}
export async function autoCropAsset(asset,kind='product',frame=null){const bitmap=await createImageBitmap(asset.blob),canvas=document.createElement('canvas'),scale=Math.min(1,480/Math.max(bitmap.width,bitmap.height));canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();return validCrop(frame)?normalizeCrop(frame):detectShoeCrop(ctx.getImageData(0,0,canvas.width,canvas.height),kind);}
export function drawCroppedImage(ctx,bitmap,crop,x,y,width,height){const r=normalizeCrop(crop),sw=r.width*bitmap.width,sh=r.height*bitmap.height,scale=Math.min(width/sw,height/sh);ctx.drawImage(bitmap,r.x*bitmap.width,r.y*bitmap.height,sw,sh,x+(width-sw*scale)/2,y+(height-sh*scale)/2,sw*scale,sh*scale);}
