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
export const PRIORITY_VISUAL_BATCH='priority-20261106-v1';
export class VisualReviewError extends Error{
 constructor(message,status){super(message);this.status=status;}
}
function batchId(value='priority'){
 if(value==='priority')return PRIORITY_VISUAL_BATCH;
 if(typeof value!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(value))throw new TypeError('Invalid batch id');
 return value;
}
const jobView=row=>{
 if(!row)return null;
 const view={id:row.id,batchId:row.batch_id,status:row.status,requestedAt:row.requested_at,startedAt:row.started_at,finishedAt:row.finished_at};
 try{
  const result=JSON.parse(row.result||'{}'),summary={};
  if(typeof result.message==='string')summary.message=result.message.replace(/(?:[A-Za-z]:[\\/]|\.secrets[\\/]|\/(?:Users|home|tmp|var|etc)\/)\S*/g,'[비공개 경로]').slice(0,500);
  if(Array.isArray(result.releasedCategories))summary.releasedCategories=[...new Set(result.releasedCategories.filter(id=>VISUAL_CATEGORY_IDS.includes(id)))];
  if(Number.isInteger(result.automaticPhotos)&&result.automaticPhotos>=0&&result.automaticPhotos<=20000)summary.automaticPhotos=result.automaticPhotos;
  if(typeof result.modelVersion==='string'&&result.modelVersion.length<=160&&!/[\u0000-\u001f]/.test(result.modelVersion))summary.modelVersion=result.modelVersion;
  const evaluation={};
  const splitCounts=result.evaluation?.ownerSplitCounts;
  if(splitCounts&&['train','calibration','test'].every(role=>Number.isInteger(splitCounts[role])&&splitCounts[role]>=0&&splitCounts[role]<=100000))evaluation.ownerSplitCounts=Object.fromEntries(['train','calibration','test'].map(role=>[role,splitCounts[role]]));
  for(const key of ['calibration','test','baselineTest']){
   const metric=result.evaluation?.[key];
   if(Number.isInteger(metric?.n)&&metric.n>0&&metric.n<=100000&&typeof metric.accuracy==='number'&&Number.isFinite(metric.accuracy)&&metric.accuracy>=0&&metric.accuracy<=1)evaluation[key]={n:metric.n,accuracy:metric.accuracy};
  }
  if(Object.keys(evaluation).length)summary.evaluation=evaluation;
  if(Object.keys(summary).length){view.result=summary;Object.assign(view,summary);}
 }catch{/* Never return worker diagnostics, request labels or private paths. */}
 return view;
};
async function batchDefinition(db,id){
 const row=await db.prepare('SELECT data FROM visual_review_batches WHERE id=?').bind(id).first();
 if(!row)throw new VisualReviewError('검수 묶음을 찾을 수 없습니다.',404);
 return JSON.parse(row.data);
}
export async function visualBatchProgress(db,value='priority'){
 const id=batchId(value),data=await batchDefinition(db,id);
 const stats=await db.prepare(`SELECT COUNT(*) AS total,COUNT(r.image_hash) AS reviewed,
 COALESCE(SUM(r.status='approved'),0) AS approved,COALESCE(SUM(r.status='excluded'),0) AS excluded
 FROM visual_review_batch_members m LEFT JOIN visual_classification_reviews r ON r.image_hash=m.image_hash WHERE m.batch_id=?`).bind(id).first();
 const job=await db.prepare('SELECT id,batch_id,status,requested_at,started_at,finished_at,result FROM visual_training_jobs WHERE batch_id=?').bind(id).first();
 return {id,title:typeof data.title==='string'?data.title.slice(0,300):id,targetCount:data.targetCount,...stats,remaining:Math.max(0,stats.total-stats.reviewed),job:jobView(job)};
}
export async function requestVisualTraining(db,input){
 if(!input||typeof input.batchId!=='string')throw new TypeError('Batch id required');
 const id=batchId(input.batchId),jobId=crypto.randomUUID(),at=new Date().toISOString();
 const retry=await db.prepare(`UPDATE visual_training_jobs SET status='queued',requested_at=?,started_at=NULL,finished_at=NULL
 WHERE batch_id=? AND status='failed' AND json_type(result,'$.request.members')='array' AND json_array_length(result,'$.request.members')=96
 RETURNING id,batch_id,status,requested_at,started_at,finished_at`).bind(at,id).first();
 if(retry)return {created:false,retried:true,job:jobView(retry)};
 // One write checks completion/category diversity and freezes all labels and
 // split roles. Later owner edits cannot change the queued training dataset.
 const inserted=await db.prepare(`INSERT INTO visual_training_jobs (id,batch_id,status,requested_at,result)
 SELECT ?,b.id,'queued',?,json_object('request',json_object('batchId',b.id,'createdAt',?,
 'members',json((SELECT json_group_array(json_object('imageHash',image_hash,'role',role,'category',category,'status',status,'revision',revision,
 'modelKey',model_key,'brand',brand)) FROM (
 SELECT m.image_hash,m.role,r.category,r.status,r.revision,json_extract(c.data,'$.products[0].modelKey') AS model_key,json_extract(c.data,'$.products[0].brand') AS brand
 FROM visual_review_batch_members m JOIN visual_classification_candidates c ON c.image_hash=m.image_hash
 JOIN visual_classification_reviews r ON r.image_hash=m.image_hash WHERE m.batch_id=b.id ORDER BY m.position,m.image_hash)))))
 FROM visual_review_batches b WHERE b.id=? AND json_extract(b.data,'$.targetCount')=96
 AND (SELECT COUNT(*) FROM visual_review_batch_members WHERE batch_id=b.id)=96
 AND (SELECT COUNT(*) FROM visual_review_batch_members m JOIN visual_classification_candidates c ON c.image_hash=m.image_hash JOIN visual_classification_reviews r ON r.image_hash=m.image_hash
 WHERE m.batch_id=b.id AND r.status IN ('approved','excluded') AND json_type(c.data,'$.products[0].modelKey')='text' AND length(json_extract(c.data,'$.products[0].modelKey'))>0
 AND json_type(c.data,'$.products[0].brand')='text' AND length(json_extract(c.data,'$.products[0].brand'))>0)=96
 AND (SELECT COUNT(DISTINCT r.category) FROM visual_review_batch_members m JOIN visual_classification_reviews r ON r.image_hash=m.image_hash
 WHERE m.batch_id=b.id AND m.role='train' AND r.status='approved')>=2
 ON CONFLICT(batch_id) DO NOTHING RETURNING id,batch_id,status,requested_at,started_at,finished_at`).bind(jobId,at,at,id).first();
 const job=inserted||await db.prepare('SELECT id,batch_id,status,requested_at,started_at,finished_at,result FROM visual_training_jobs WHERE batch_id=?').bind(id).first();
 if(job)return {created:!!inserted,retried:false,job:jobView(job)};
 const progress=await visualBatchProgress(db,id);
 if(progress.total!==96||progress.targetCount!==96)throw new VisualReviewError('96장 검수 묶음 구성을 확인해 주세요.',409);
 if(progress.remaining)throw new VisualReviewError(`아직 ${progress.remaining}장 검수가 남았습니다. 96장 모두 승인 또는 제외한 후 완료해 주세요.`,409);
 throw new VisualReviewError('학습용 승인 분류가 최소 2종 필요하며, 모든 검수 사진의 후보 자료가 있어야 합니다.',409);
}
export async function visualQueue(db,url){
 const pageText=url.searchParams.get('page')||'1',status=url.searchParams.get('status')||'',brand=url.searchParams.get('brand')||'';
 if(!/^[1-9]\d{0,3}$/.test(pageText)||Number(pageText)>1000||status&&!statuses.includes(status)||brand.length>160)throw new TypeError('Invalid queue filter');
 const batchValue=url.searchParams.get('batch'),id=batchValue===null?null:batchId(batchValue);
 const definition=id?await batchDefinition(db,id):null;
 const source=id?`${joined} JOIN visual_review_batch_members m ON m.image_hash=c.image_hash`:joined;
 const state=id?`COALESCE(r.status,'review-needed')`:effective;
 const args=[],where=[];
 if(id){where.push('m.batch_id=?');args.push(id);}
 if(status){where.push(`${state}=?`);args.push(status);}
 if(brand){where.push(`EXISTS (SELECT 1 FROM json_each(c.data,'$.products') p WHERE json_extract(p.value,'$.brand')=?)`);args.push(brand);}
 const filter=where.length?' WHERE '+where.join(' AND '):'';
 const total=(await db.prepare(`SELECT COUNT(*) AS count ${source}${filter}`).bind(...args).first()).count;
 const rows=(await db.prepare(`SELECT c.data,c.model_version,r.category AS review_category,r.status AS review_status,r.reviewed_at,COALESCE(r.revision,0) AS revision,
 EXISTS(SELECT 1 FROM visual_review_batch_members bm WHERE bm.image_hash=c.image_hash AND bm.role='test') AS heldout_test${id?',m.role AS review_role':''} ${source}${filter} ORDER BY ${id?'m.position,':''}c.image_hash LIMIT 20 OFFSET ?`).bind(...args,(Number(pageText)-1)*20).all()).results;
 const stats=(await db.prepare(`SELECT ${state} AS status,COUNT(*) AS count ${source}${id?' WHERE m.batch_id=?':''} GROUP BY ${state}`).bind(...(id?[id]:[])).all()).results;
 const metadata=await db.prepare('SELECT data,updated_at FROM visual_classification_metadata WHERE id=1').first();
 return {schemaVersion:1,page:Number(pageText),pageSize:20,total,model:metadata?JSON.parse(metadata.data):null,updatedAt:metadata?.updated_at||null,stats:Object.fromEntries(stats.map(r=>[r.status,r.count])),...(id?{batch:await visualBatchProgress(db,id)}:{}),records:rows.map(r=>{
  const candidate=JSON.parse(r.data),blind=!!r.heldout_test;
  return {...candidate,...(id?{status:r.review_status||'review-needed',reviewRole:r.review_role,
   reason:typeof definition.reasons?.[candidate.imageHash]==='string'?definition.reasons[candidate.imageHash].slice(0,500):null,blindReview:blind}:{}),
   ...(blind?{blindReview:true,reviewRole:'test',category:null,confidence:0,margin:0,alternatives:[]}:{}),modelVersion:r.model_version,
   review:r.review_status?{category:r.review_category,status:r.review_status,reviewedAt:r.reviewed_at,revision:r.revision}:null,revision:r.revision};
 })};
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
 const result={schemaVersion:1,records:rows.map(r=>({imageHash:r.image_hash,category:r.category,status:r.status})),updatedAt:rows.reduce((at,r)=>!at||r.reviewed_at>at?r.reviewed_at:at,null)};
 const metadata=await db.prepare('SELECT data FROM visual_classification_metadata WHERE id=1').first();
 let model;try{model=publicAutomaticModel(metadata?JSON.parse(metadata.data):null);}catch{return result;}
 if(!model)return result;
 const candidates=(await db.prepare("SELECT image_hash,data FROM visual_classification_candidates WHERE model_version=? AND json_extract(data,'$.status')='auto' ORDER BY image_hash").bind(model.version).all()).results;
 const automatic=[];
 for(const row of candidates){
  try{
   const candidate=JSON.parse(row.data);if(!VISUAL_CATEGORY_IDS.includes(candidate.category))continue;
   const gate=model.thresholds[candidate.category];
   if(!gate||!IMAGE_HASH.test(row.image_hash)||candidate.imageHash!==row.image_hash||candidate.modelVersion!==model.version)continue;
   const confidence=score(candidate.confidence),margin=score(candidate.margin);
   if(confidence<gate.minConfidence||margin<gate.minMargin)continue;
   automatic.push({imageHash:row.image_hash,category:candidate.category,confidence,margin,modelVersion:model.version,source:'model'});
  }catch{/* A malformed candidate is never released through the public overlay. */}
 }
 result.automatic={schemaVersion:1,model,records:automatic};return result;
}
function publicAutomaticModel(metadata){
 if(metadata?.validated!==true||typeof metadata.version!=='string'||typeof metadata.sha256!=='string'||!IMAGE_HASH.test(metadata.sha256)||!metadata.thresholds||typeof metadata.thresholds!=='object')return null;
 const version=text(metadata.version,160),encoder=text(metadata.encoder,200),thresholds={};
 for(const id of VISUAL_CATEGORY_IDS){
  const gate=metadata.thresholds[id];if(!gate||typeof gate!=='object')continue;
  try{
   const minConfidence=score(gate.minConfidence),minMargin=score(gate.minMargin),calibrationPrecision=score(gate.calibrationPrecision),testPrecision=score(gate.testPrecision);
   if(calibrationPrecision<.95||testPrecision<.95||!Number.isInteger(gate.calibrationN)||gate.calibrationN<8||gate.calibrationN>100000||!Number.isInteger(gate.testN)||gate.testN<8||gate.testN>100000)continue;
   thresholds[id]={minConfidence,minMargin,calibrationPrecision,testPrecision,calibrationN:gate.calibrationN,testN:gate.testN};
  }catch{/* Fail closed independently for every class. */}
 }
 return Object.keys(thresholds).length?{version,sha256:metadata.sha256,encoder,validated:true,thresholds}:null;
}
