import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';

const PREFIX=Buffer.from('SHOESARCHIVE1\0');
const MARKER=Buffer.from('{"format":"shoes-encrypted-archive-store","version":1}\n');
const MARKER_PATH='archive-store.json';
const LEDGER_PATH='state/ledger.enc';
export function backupKey(encoded) {
  const key=Buffer.from(encoded||'','base64');
  if(key.length!==32 || key.toString('base64')!==encoded) throw new Error('ARCHIVE_BACKUP_KEY must be a 32-byte base64 key');
  return key;
}
export function encryptArchive(value,key) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(PREFIX);
  const ciphertext=Buffer.concat([cipher.update(gzipSync(JSON.stringify(value))),cipher.final()]);
  return Buffer.concat([PREFIX,iv,cipher.getAuthTag(),ciphertext]);
}
export function decryptArchive(bytes,key) {
  const raw=Buffer.from(bytes);
  if(!raw.subarray(0,PREFIX.length).equals(PREFIX)) throw new Error('Unknown encrypted archive format');
  const iv=raw.subarray(PREFIX.length,PREFIX.length+12),tag=raw.subarray(PREFIX.length+12,PREFIX.length+28);
  const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(PREFIX);decipher.setAuthTag(tag);
  return JSON.parse(gunzipSync(Buffer.concat([decipher.update(raw.subarray(PREFIX.length+28)),decipher.final()])).toString('utf8'));
}
const blobSha=bytes=>createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');

// GitHub branch storage is deliberately separate from the site's main branch and build files.
// Public GitHub can hold this store because only authenticated ciphertext is written.
export function createArchiveStore({repository,token,baseSha,key,branch='archive-audit',fetchImpl=fetch,localDirectory}) {
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository||'')||!token||!/^[0-9a-f]{40}$/i.test(baseSha||'')) throw new Error('GITHUB_REPOSITORY, GITHUB_TOKEN and GITHUB_SHA are required for durable archive backup');
  if(branch!=='archive-audit') throw new Error('Unexpected archive branch');
  let initialized=false,ledgerSha;
  const api=`https://api.github.com/repos/${repository}`;
  async function request(suffix,options={}) {
    const response=await fetchImpl(api+suffix,{method:options.method||'GET',headers:{Authorization:`Bearer ${token}`,Accept:options.raw?'application/vnd.github.raw+json':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},...(options.body?{body:JSON.stringify(options.body)}:{}),signal:AbortSignal.timeout(60000)});
    if(options.optional&&response.status===404)return null;
    if(!response.ok)throw new Error(`Encrypted backup GitHub ${options.method||'GET'} failed (HTTP ${response.status}); no Sheet append permitted`);
    return options.raw?Buffer.from(await response.arrayBuffer()):response.json();
  }
  const contentUrl=(file,ref=true)=>'/contents/'+file.split('/').map(encodeURIComponent).join('/')+(ref?'?ref='+encodeURIComponent(branch):'');
  async function readBytes(file,optional=false) {
    // Raw media handles encrypted files above 1 MB; default JSON content is empty at that size.
    return request(contentUrl(file),{raw:true,optional});
  }
  async function writeBytes(file,bytes,{sha,message}={}) {
    if(bytes.length>25*1024*1024)throw new Error('Encrypted backup exceeds 25 MB safety limit; review storage before any Sheet write');
    const result=await request(contentUrl(file,false),{method:'PUT',body:{message:message||'Persist encrypted archive state',branch,content:bytes.toString('base64'),...(sha?{sha}:{})}});
    if(result.content?.sha!==blobSha(bytes))throw new Error('Remote encrypted backup SHA mismatch; no Sheet append permitted');
    const readback=await readBytes(file);
    if(!bytes.equals(readback))throw new Error('Remote encrypted backup read-back mismatch; no Sheet append permitted');
    return result.content.sha;
  }
  async function initialize() {
    if(initialized)return;
    const ref=await request('/git/ref/heads/'+branch,{optional:true});
    if(!ref) {
      await request('/git/refs',{method:'POST',body:{ref:'refs/heads/'+branch,sha:baseSha}});
      await writeBytes(MARKER_PATH,MARKER,{message:'Initialize encrypted shoes archive store'});
    } else {
      const marker=await readBytes(MARKER_PATH,true);
      if(!marker?.equals(MARKER))throw new Error('Existing archive-audit branch is not a recognized archive store; left unchanged');
    }
    initialized=true;
  }
  return {
    async loadLedger() {
      await initialize();
      const data=await readBytes(LEDGER_PATH,true);
      ledgerSha=data?blobSha(data):undefined;
      const ledger=data?decryptArchive(data,key):{schemaVersion:1,entries:{}};
      if(ledger.schemaVersion!==1||!ledger.entries||typeof ledger.entries!=='object')throw new Error('Encrypted ledger schema mismatch');
      return ledger;
    },
    async saveLedger(ledger) {
      await initialize();
      const encrypted=encryptArchive(ledger,key);
      // SHA is the version read at process start / last save. A competing writer fails the PUT.
      ledgerSha=await writeBytes(LEDGER_PATH,encrypted,{sha:ledgerSha,message:'Persist encrypted archive transaction state'});
    },
    async audit(transaction,payload) {
      await initialize();
      if(!/^[0-9a-f-]{36}$/i.test(transaction))throw new Error('Invalid archive transaction id');
      const encrypted=encryptArchive(payload,key),filename=transaction+'.enc';
      if(localDirectory){await fs.mkdir(localDirectory,{recursive:true});await fs.writeFile(path.join(localDirectory,filename),encrypted,{flag:'wx',mode:0o600});}
      // No sha for audit entries: an existing filename must fail instead of being overwritten.
      const sha=await writeBytes('audit/'+filename,encrypted,{message:'Preserve encrypted native sheet snapshot before append'});
      return {branch,path:'audit/'+filename,sha};
    }
  };
}
