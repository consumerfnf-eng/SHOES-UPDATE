// Product names remain linked to their original source records and codes.
const foreign=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Thai}]/u;
const lv=[['スニーカーズ','Sneakers'],['スニーカー','Sneaker'],['トレイナーディストレスト','Trainer Distressed'],['トレイナー アウトドア','Trainer Outdoor'],['タティック ランナー','Tatic Runner'],['タティック ニット','Tatic Knit'],['ドロップ','Drop'],['バターソフト','Buttersoft'],['ビバリーヒルズ','Beverly Hills'],['ランアウェイ','Run Away'],['トレイナー','Trainer'],['クラシック','Classic'],['ティルテッド','Tilted'],['フラッシュ','Flash'],['ソフト','Soft']];
export const hasForeignDisplayScript=value=>foreign.test(String(value||''));
export function normalizeDisplayLanguage(product){
 const p={...product};
 // A source colour line can be mistaken for a heading. Recover only from
 // verified, brand-owned product URL structures that carry a readable name.
 if(/^\//.test(p.name||'')&&p.officialProductEvidence?.verified===true&&p.officialProductEvidence.brand===p.brand&&p.officialProductEvidence.url===p.url){
  try{
   const u=new URL(p.url);let slug='';
   if(p.brand==='Nike'&&/(?:^|\.)nike\.com$/.test(u.hostname))slug=u.pathname.match(/\/t\/([^/]+)\//)?.[1]?.replace(/-[a-z0-9]{6,10}$/i,'')||'';
   if(p.brand==='Merrell'&&/(?:^|\.)merrell\.com$/.test(u.hostname))slug=u.pathname.match(/\/en\/([^/]+)\//)?.[1]||'';
   if(p.brand==='Melissa'&&u.hostname==='www.shopmelissa.com')slug=u.pathname.match(/\/products\/([^/]+)/)?.[1]?.replace(/-\d{5}-[a-z0-9]+$/i,'')||'';
   if(slug){p.sourceName??=p.name;p.name=slug.replaceAll('-',' ').replace(/\b(?:mens|womens|unisex)\b/gi,'').replace(/\s+/g,' ').trim().replace(/\b[a-z]/g,c=>c.toUpperCase());}
  }catch{}
 }
 if(p.brand==='Louis Vuitton')for(const field of ['name','modelName','fullName'])if(typeof p[field]==='string'){
   for(const [from,to]of lv)p[field]=p[field].replaceAll(from,to);
   p[field]=p[field].replace(/LV(?=Trainer)/g,'LV ').replace(/\s+/g,' ').trim();
 }
 if(p.brand==='Golden Goose'&&hasForeignDisplayScript(p.name)&&/Ball Star LTD/.test(p.name))p.name='Ball Star LTD Sneakers in Grey Suede with Blue Star and Cream Crochet Inserts';
 // Do not fabricate a translation of unknown marketing prose. Original text
 // and evidence stay in data/catalog-source.json, outside the displayed fields.
 for(const field of ['description','material','colorway','officialCategory','fullName'])if(hasForeignDisplayScript(p[field]))p[field]='';
 return p;
}
