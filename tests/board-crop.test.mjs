import test from 'node:test';import assert from 'node:assert/strict';import {detectShoeCrop,normalizeCrop,zoomedCrop,validCrop} from '../public/assets/board-crop.mjs';
function image(bg,boxes=[]){const width=200,height=300,data=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const box=boxes.find(b=>x>=b.x&&x<b.x+b.w&&y>=b.y&&y<b.y+b.h),c=box?.color||bg,i=(y*width+x)*4;data.set([...c,255],i);}return {data,width,height};}
test('automatic crop removes warm studio margins and keeps both shoes and light uppers',()=>{
 const result=detectShoeCrop(image([232,225,211],[{x:25,y:215,w:145,h:38,color:[90,50,40]}]));assert(result.y>.6);assert(result.width<.9);assert(result.x<=25/200&&result.x+result.width>=170/200);assert(result.y<=215/300&&result.y+result.height>=253/300);
 const pair=detectShoeCrop(image([255,255,255],[{x:15,y:170,w:80,h:35,color:[244,244,244]},{x:100,y:220,w:80,h:40,color:[80,70,50]}]));assert(pair.x<=.075&&pair.x+pair.width>=.9);assert(pair.y<=170/300&&pair.y+pair.height>=260/300);
 assert.deepEqual(detectShoeCrop(image([255,255,255])),{x:0,y:0,width:1,height:1});
});
test('manual zoom and positions remain within the preserved source',()=>{for(const z of [1,2,6])for(const x of [0,.5,1])for(const y of [0,.5,1])assert(validCrop(zoomedCrop({x:.1,y:.6,width:.8,height:.3},z,x,y)));assert.deepEqual(normalizeCrop({x:-1,y:1,width:0,height:9}),{x:0,y:0,width:1,height:1});});
