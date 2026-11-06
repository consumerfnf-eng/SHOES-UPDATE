import {visualReviewOverlay} from '../../server/visual-classifications.mjs';
// Normal Pages middleware supplies the existing team Basic authentication.
export async function onRequest({request,env}){
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff'};
 if(request.method!=='GET')return new Response(JSON.stringify({error:'Method not allowed'}),{status:405,headers});
 try{
  if(!env.ADMIN_DB)throw Error('Unavailable');
  return new Response(JSON.stringify(await visualReviewOverlay(env.ADMIN_DB)),{headers});
 }catch{return new Response(JSON.stringify({error:'Review overlay unavailable'}),{status:503,headers});}
}
