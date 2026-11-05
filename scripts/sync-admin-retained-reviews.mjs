import fs from 'node:fs/promises';
const read=async file=>JSON.parse(await fs.readFile(file,'utf8')),catalog=await read('public/data/catalog.json'),request=await read('reports/admin-bulk-recheck-request.json');
const counts={};
for(const [file,field] of [['data/product-colour-reviews.json','colourReview'],['data/product-variant-reviews.json','designReview']]){
 const data=await read(file),byId=new Map(data.products.map(r=>[r.id,r]));let changed=0;
 for(const product of catalog.products){const review=product[field],old=byId.get(product.id),origin=review?.retainedFrom;
  if(!request.targets.includes(product.brand)||!old?.verified||!review?.verified||review.retentionBasis!=='identical-sha256-product-photo'||!origin||origin.cachedPath!==product.presentation?.cachedPath||!/^\/images\/[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(origin.cachedPath))continue;
  if(old.brand!==product.brand||old.url!==origin.url||old.image!==origin.image)continue;
  const next={...old,...review,id:product.id,style:product.style,url:product.url,image:product.image};
  if(JSON.stringify(old)!==JSON.stringify(next)){byId.set(product.id,next);changed++;}
 }
 data.products=data.products.map(r=>byId.get(r.id));if(changed)await fs.writeFile(file,JSON.stringify(data,null,2)+'\n');counts[field]=changed;
}
console.log(JSON.stringify(counts));
