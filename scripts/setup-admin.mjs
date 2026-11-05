// Secrets travel through stdin only. Nothing secret belongs in public/ or git.
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {spawnSync,execFileSync} from 'node:child_process';
import {hashPassword,randomToken} from '../server/admin-auth.mjs';
const project='shoes-update-internal',local='.secrets/admin-bootstrap.json';
await fs.mkdir('.secrets',{recursive:true});
let state;try{state=JSON.parse(await fs.readFile(local,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(!state){
 const password=randomToken(),passwordHash=await hashPassword(password),runnerKey=randomToken();
 const file=path.join(os.homedir(),'Documents','ChatGPT','shoes internal site','SHOES 관리자 로그인 정보.txt');
 await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'',{mode:0o600});
 if(process.platform==='win32')execFileSync('icacls.exe',[file,'/inheritance:r','/grant:r',`${process.env.USERDOMAIN}\\${process.env.USERNAME}:(R,W)`],{stdio:'pipe'});
 await fs.writeFile(file,`SHOES 관리자 전용 로그인\n\n주소: https://shoes-update-internal.pages.dev/admin/\n초기 관리자 비밀번호: ${password}\n\n위 관리자 전용 주소에서 초기 관리자 비밀번호로 로그인\n상단 '비밀번호 설정'에서 본인의 새 관리자 비밀번호 지정\n새 비밀번호 설정 후 초기 비밀번호 사용 불가\n관리자 세션: 최대 8시간, 로그아웃 시 서버에서 즉시 폐기\n이 파일은 본인 PC에서 보관하고 다른 사용자에게 공유하지 마세요.\n`);
 state={passwordHash,runnerKey,credentialsFile:file};await fs.writeFile(local,JSON.stringify(state),{mode:0o600});
}
function run(command,args,input){const result=spawnSync(command,args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],shell:process.platform==='win32'&&command==='npx'});if(result.status!==0)throw Error('Administrator provisioning command failed: '+command+' '+args.slice(0,4).join(' '));}
run('npx',['wrangler','d1','execute','shoes-admin-monitor','--remote','--file','server/admin-schema.sql']);
for(const [name,value] of [['ADMIN_PASSWORD_HASH',state.passwordHash],['ADMIN_RUNNER_KEY',state.runnerKey]])run('npx',['wrangler','pages','secret','put',name,'--project-name',project],value+'\n');
run('gh',['secret','set','ADMIN_RUNNER_KEY','--repo','consumerfnf-eng/SHOES-UPDATE'],state.runnerKey);
console.log('Administrator credentials saved locally: '+state.credentialsFile);
console.log('Separate administrator hash and scoped automation key configured.');
