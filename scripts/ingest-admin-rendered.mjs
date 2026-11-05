import fs from 'node:fs/promises';import path from 'node:path';import {gzipSync} from 'node:zlib';import {createHash} from 'node:crypto';
const indexFile='reports/admin-rendered-index.json';let index={};try{index=JSON.parse(await fs.readFile(indexFile,'utf8'));}catch{}
await fs.mkdir('logs/admin-rendered',{recursive:true});
for(const input of process.argv.slice(2)){
 const name=path.basename(input);if(!/^admin-rendered-[a-z0-9-]+\.json$/.test(name))throw Error('Unexpected rendered source file');
 const row=JSON.parse(await fs.readFile('logs/'+name,'utf8')),url=row.requestedUrl||row.metadata?.sourceURL;
 if(!url?.startsWith('https://')||row.metadata?.statusCode!==200||!row.html||!row.checkedAt)continue;
 const destination='logs/admin-rendered/'+createHash('sha256').update(url).digest('hex')+'.json.gz';await fs.writeFile(destination,gzipSync(JSON.stringify(row)));
 index[url]={path:destination,checkedAt:row.checkedAt};await fs.unlink('logs/'+name);
}
await fs.mkdir('reports',{recursive:true});await fs.writeFile(indexFile,JSON.stringify(index));console.log('Live rendered sources cached: '+Object.keys(index).length);
