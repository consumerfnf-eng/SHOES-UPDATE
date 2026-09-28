import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {backupKey,encryptArchive,decryptArchive,createArchiveStore} from '../scripts/archive-store.mjs';
const key=Buffer.alloc(32,19),baseSha='a'.repeat(40);
const blobSha=bytes=>createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
function github({unknownBranch=false,corruptReadback=false}={}) {
  let exists=unknownBranch,puts=0;const files=new Map(),calls=[];
  const response=(status,body)=>new Response(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body),{status});
  return {files,calls,get puts(){return puts;},fetch:async(url,options)=>{
    const path=new URL(url).pathname.replace('/repos/example/shoes','');calls.push([options.method,path,options.headers.Accept]);
    if(path==='/git/ref/heads/archive-audit')return response(exists?200:404,{object:{sha:baseSha}});
    if(path==='/git/refs'){exists=true;return response(201,{ref:'refs/heads/archive-audit'});}
    const file=decodeURIComponent(path.replace('/contents/',''));
    if(options.method==='GET') {
      if(!files.has(file))return response(404,{});
      const bytes=files.get(file);return response(200,corruptReadback&&file.startsWith('audit/')?Buffer.from('corrupted'):bytes);
    }
    const body=JSON.parse(options.body),old=files.get(file);
    if((old && body.sha!==blobSha(old))||(!old&&body.sha))return response(409,{});
    const data=Buffer.from(body.content,'base64');files.set(file,data);puts++;return response(old?200:201,{content:{sha:blobSha(data)}});
  }};
}
const storeFor=backend=>createArchiveStore({repository:'example/shoes',token:'test-token',baseSha,key,fetchImpl:backend.fetch});
test('AES-256-GCM gzip snapshot roundtrips; randomized ciphertext does not expose data and rejects tampering',()=>{
  const data={rows:[{brand:'confidential example',formula:'=IMAGE(J2)'}]},first=encryptArchive(data,key),second=encryptArchive(data,key);
  assert.deepEqual(decryptArchive(first,key),data);assert.notDeepEqual(first,second);assert.equal(first.includes(Buffer.from('confidential example')),false);
  const corrupt=Buffer.from(first);corrupt[corrupt.length-1]^=1;assert.throws(()=>decryptArchive(corrupt,key));assert.throws(()=>decryptArchive(first,Buffer.alloc(32,20)));
  assert.throws(()=>backupKey('too-short'),/32-byte/);
});
test('new store marker + encrypted immutable audit verified by raw read; no plaintext fields remotely',async()=>{
  const backend=github(),store=storeFor(backend);assert.deepEqual(await store.loadLedger(),{schemaVersion:1,entries:{}});
  const id='11111111-1111-4111-8111-111111111111';await store.audit(id,{nativeRows:'secret rows'});
  assert.equal(backend.files.get('audit/'+id+'.enc').includes(Buffer.from('secret rows')),false);
  assert.deepEqual(decryptArchive(backend.files.get('audit/'+id+'.enc'),key),{nativeRows:'secret rows'});
  await assert.rejects(store.audit(id,{changed:true}),/409/);assert.equal(backend.puts,2);
  assert.ok(backend.calls.filter(([method,p])=>method==='GET'&&p.includes('/contents/')).every(([, , accept])=>accept==='application/vnd.github.raw+json'));
});
test('unknown existing archive branch stays untouched',async()=>{
  const backend=github({unknownBranch:true}),store=storeFor(backend);
  await assert.rejects(store.loadLedger(),/not a recognized/);assert.equal(backend.puts,0);
});
test('encrypted ledger reload survives process loss; stale CAS writer is rejected',async()=>{
  const backend=github(),first=storeFor(backend);await first.loadLedger();const ledger={schemaVersion:1,entries:{a:{state:'pending',transaction:'example'}}};await first.saveLedger(ledger);
  const second=storeFor(backend);assert.deepEqual(await second.loadLedger(),ledger);
  ledger.entries.a.state='verified';await first.saveLedger(ledger);
  await assert.rejects(second.saveLedger({schemaVersion:1,entries:{b:{state:'pending'}}}),/409/);
  assert.deepEqual(decryptArchive(backend.files.get('state/ledger.enc'),key),ledger);
});
test('remote read-back failure blocks durable backup confirmation',async()=>{
  const backend=github({corruptReadback:true}),store=storeFor(backend);await store.loadLedger();
  await assert.rejects(store.audit('22222222-2222-4222-8222-222222222222',{rows:'private'}),/read-back mismatch/);
});
test('encrypted backup above 1 MB uses raw API reads rather than empty JSON content',async()=>{
  const backend=github(),store=storeFor(backend);await store.loadLedger();
  const payload={random:randomBytes(1200_000).toString('base64')};await store.audit('33333333-3333-4333-8333-333333333333',payload);
  const stored=backend.files.get('audit/33333333-3333-4333-8333-333333333333.enc');assert.ok(stored.length>1024*1024);assert.deepEqual(decryptArchive(stored,key),payload);
});
