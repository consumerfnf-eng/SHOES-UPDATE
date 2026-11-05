import fs from 'node:fs/promises';import path from 'node:path';
import {auditBrand} from './admin-monitor-runner.mjs';
const [brand,jobId]=process.argv.slice(2),directory=process.env.ADMIN_AUDIT_OUTPUT_DIR;
const save=async(name,value)=>{if(!directory)return;await fs.mkdir(directory,{recursive:true});const file=path.join(directory,jobId+'-'+name+'.json');await fs.writeFile(file,JSON.stringify(value));};
console.log=()=>{};console.warn=()=>{};
let report;try{report=await auditBrand(brand,{onCollected:r=>save('products',{brand,...r}),onProgress:r=>save('progress',{brand,...r})});}catch(error){report={status:'failed',checkedAt:new Date().toISOString(),listingPages:0,verified:0,discovered:0,exhaustive:false,candidates:[],errors:[String(error.message).slice(0,240)]};}
await save('report',{brand,...report});if(process.send)process.send(report);else process.stdout.write(JSON.stringify(report));
