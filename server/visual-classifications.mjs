export const VISUAL_CATEGORY_IDS=Object.freeze(['low-profile','chunky','retro-tech-runner','ballet-mary-jane','mule-slipper','court-other','boot','sandal','performance']);
export const IMAGE_HASH=/^[a-f0-9]{64}$/;
export const THUMBNAIL=/^\/images\/[a-f0-9]{64}\.(jpg|png|webp)$/;
const statuses=['auto','review-needed','approved','excluded'];
const fail=message=>{throw new TypeError(message);};
const text=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f]/.test(v)?v:fail('Invalid text');
const score=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1?v:fail('Invalid score');
const category=v=>VISUAL_CATEGORY_IDS.includes(v)?v:fail('Invalid category');
export function validateVisualCandidate(row,version){
 if(!row||typeof row.imageHash!=='string'||!IMAGE_HASH.test(row.imageHash)||row.modelVersion!==version||typeof row.thumbnail!=='string'||!THUMBNAIL.test(row.thumbnail)||!['auto','review-needed','excluded'].includes(row.status))fail('Invalid candidate');
 if(!Array.isArray(row.alternatives)||row.alternatives.length>9||!Array.isArray(row.products)||row.products.length<1||row.products.length>200)fail('Invalid candidate lists');
 const unresolved=row.category===null&&row.status==='review-needed'&&row.confidence===0&&row.margin===0&&row.alternatives.length===0;
 const result={imageHash:row.imageHash,modelVersion:text(version,200),category:unresolved?null:category(row.category),confidence:score(row.confidence),margin:score(row.margin),status:row.status,thumbnail:row.thumbnail,
  alternatives:row.alternatives.map(a=>({category:category(a.category),score:score(a.score)})),products:row.products.map(p=>{
   const url=new URL(text(p.url,2048));if(url.protocol!=='https:'||url.username||url.password)fail('Invalid product URL');
   return {id:text(p.id,200),brand:text(p.brand,160),name:text(p.name,500),url:url.href,modelKey:text(p.modelKey,300)};
  })};
 if(new TextEncoder().encode(JSON.stringify(result)).length>65536)fail('Candidate too large');
 return result;
}
const joined=`FROM visual_classification_candidates c LEFT JOIN visual_classification_reviews r ON r.image_hash=c.image_hash`;
const effective=`COALESCE(r.status,json_extract(c.data,'$.status'))`;
export async function visualQueue(db,url){
 const pageText=url.searchParams.get('page')||'1',status=url.searchParams.get('status')||'',brand=url.searchParams.get('brand')||'';
 if(!/^[1-9]\d{0,3}$/.test(pageText)||Number(pageText)>1000||status&&!statuses.includes(status)||brand.length>160)throw new TypeError('Invalid queue filter');
 const args=[],where=[];
 if(status){where.push(`${effective}=?`);args.push(status);}
 if(brand){where.push(`EXISTS (SELECT 1 FROM json_each(c.data,'$.products') p WHERE json_extract(p.value,'$.brand')=?)`);args.push(brand);}
 const filter=where.length?' WHERE '+where.join(' AND '):'';
 const total=(await db.prepare(`SELECT COUNT(*) AS count ${joined}${filter}`).bind(...args).first()).count;
 const rows=(await db.prepare(`SELECT c.data,c.model_version,r.category AS review_category,r.status AS review_status,r.reviewed_at,COALESCE(r.revision,0) AS revision ${joined}${filter} ORDER BY c.image_hash LIMIT 20 OFFSET ?`).bind(...args,(Number(pageText)-1)*20).all()).results;
 const stats=(await db.prepare(`SELECT ${effective} AS status,COUNT(*) AS count ${joined} GROUP BY ${effective}`).all()).results;
 const metadata=await db.prepare('SELECT data,updated_at FROM visual_classification_metadata WHERE id=1').first();
 return {schemaVersion:1,page:Number(pageText),pageSize:20,total,model:metadata?JSON.parse(metadata.data):null,updatedAt:metadata?.updated_at||null,stats:Object.fromEntries(stats.map(r=>[r.status,r.count])),records:rows.map(r=>({...JSON.parse(r.data),modelVersion:r.model_version,review:r.review_status?{category:r.review_category,status:r.review_status,reviewedAt:r.reviewed_at,revision:r.revision}:null,revision:r.revision}))};
}
export async function reviewVisualCandidate(db,input){
 if(!input||typeof input.imageHash!=='string'||!IMAGE_HASH.test(input.imageHash)||!['approved','excluded'].includes(input.status)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||input.expectedRevision>=2147483647)throw new TypeError('Invalid review');
 text(input.expectedModelVersion,200);
 const chosen=input.status==='approved'?category(input.category):input.category==null?null:fail('Excluded review category must be null');
 // Candidate version and review revision are checked inside the same SQLite write.
 const row=await db.prepare(`INSERT INTO visual_classification_reviews (image_hash,category,status,reviewed_at,revision)
 SELECT image_hash,?,?,?,1 FROM visual_classification_candidates WHERE image_hash=? AND model_version=? AND (?=0 OR EXISTS (SELECT 1 FROM visual_classification_reviews WHERE image_hash=? AND revision=?))
 ON CONFLICT(image_hash) DO UPDATE SET category=excluded.category,status=excluded.status,reviewed_at=excluded.reviewed_at,revision=visual_classification_reviews.revision+1
 WHERE visual_classification_reviews.revision=? RETURNING image_hash,category,status,reviewed_at,revision`).bind(chosen,input.status,new Date().toISOString(),input.imageHash,input.expectedModelVersion,input.expectedRevision,input.imageHash,input.expectedRevision,input.expectedRevision).first();
 return row?{imageHash:row.image_hash,category:row.category,status:row.status,reviewedAt:row.reviewed_at,revision:row.revision}:null;
}
export async function visualImage(context,hash,privateHeaders){
 if(!IMAGE_HASH.test(hash))return new Response(null,{status:404,headers:privateHeaders});
 const row=await context.env.ADMIN_DB.prepare('SELECT data FROM visual_classification_candidates WHERE image_hash=?').bind(hash).first();
 const thumbnail=row&&JSON.parse(row.data).thumbnail;
 if(typeof thumbnail!=='string'||!THUMBNAIL.test(thumbnail))return new Response(null,{status:404,headers:privateHeaders});
 const response=await context.env.ASSETS.fetch(new Request(new URL(thumbnail,context.request.url),{method:'GET',redirect:'manual'}));
 const type=response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
 if(!response.ok||!['image/jpeg','image/png','image/webp'].includes(type)){await response.body?.cancel();return new Response(null,{status:404,headers:privateHeaders});}
 if(context.request.method==='HEAD')await response.body?.cancel();
 return new Response(context.request.method==='HEAD'?null:response.body,{headers:{...privateHeaders,'Content-Type':type}});
}
export async function visualReviewOverlay(db){
 const rows=(await db.prepare('SELECT image_hash,category,status,reviewed_at FROM visual_classification_reviews ORDER BY image_hash').all()).results;
 return {schemaVersion:1,records:rows.map(r=>({imageHash:r.image_hash,category:r.category,status:r.status})),updatedAt:rows.reduce((at,r)=>!at||r.reviewed_at>at?r.reviewed_at:at,null)};
}
