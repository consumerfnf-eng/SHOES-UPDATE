const fold=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^a-z0-9가-힣]/g,'');
const generic=new Set(['mlb','shoes','shoe','sneaker','sneakers','project','프로젝트','스니커즈','슈즈','신상','공식']);
const words=s=>String(s||'').normalize('NFKC').toLowerCase().split(/[^a-z0-9가-힣]+/).filter(w=>w.length>=2&&!generic.has(w)&&!/^\d{2,4}(?:ss|fw|aw)?$/.test(w));
export function suggestBoardTags(project,{keywords=[],ideas=[],products=[]}={}){
 const query=fold(project),tokens=words(project),out=[];if(!tokens.length)return [];
 const add=t=>{const clean=String(t||'').replace(/^#+/,'').replace(/[^a-zA-Z0-9가-힣]/g,'');if(clean&&!generic.has(clean.toLowerCase())&&!out.some(v=>fold(v)===fold(clean)))out.push('#'+clean);};
 const matching=(phrases)=>phrases.some(text=>{const clean=words(text).join('');return clean&&query.includes(clean)||words(text).some(w=>tokens.includes(w));});
 for(const k of keywords)if(matching([k.label,k.englishLabel,...(k.aliases||[])]))add(k.label);
 const ranked=ideas.map(i=>{let score=0;try{if(i.pattern&&new RegExp(i.pattern,'iu').test(project))score+=3;}catch{}for(const t of words(i.title))if(tokens.includes(t))score+=2;for(const t of i.tags||[])if(fold(t).length>=4&&query.includes(fold(t)))score+=4;return{i,score};}).filter(r=>r.score>=3).sort((a,b)=>b.score-a.score);
 for(const {i} of ranked.slice(0,2))for(const tag of i.tags||[])add(tag);
 if(out.length<3){const counts=new Map(),seen=new Set();for(const p of products){const key=fold(p.brand+' '+p.name);if(seen.has(key)||!tokens.some(t=>fold([p.brand,p.name,p.style].join(' ')).includes(t)))continue;seen.add(key);for(const tag of p.keywords||[])if(typeof tag==='string'&&!generic.has(tag.toLowerCase()))counts.set(tag,(counts.get(tag)||0)+1);}for(const [tag] of [...counts].sort((a,b)=>b[1]-a[1]).slice(0,4))add(tag);}
 return out.slice(0,6);
}
