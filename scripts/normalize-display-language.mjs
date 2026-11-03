// Product names remain linked to their original source records and codes.
const foreign=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Thai}]/u;
const lv=[['スニーカーズ','Sneakers'],['スニーカー','Sneaker'],['トレイナーディストレスト','Trainer Distressed'],['トレイナー アウトドア','Trainer Outdoor'],['タティック ランナー','Tatic Runner'],['タティック ニット','Tatic Knit'],['ドロップ','Drop'],['バターソフト','Buttersoft'],['ビバリーヒルズ','Beverly Hills'],['ランアウェイ','Run Away'],['トレイナー','Trainer'],['クラシック','Classic'],['ティルテッド','Tilted'],['フラッシュ','Flash'],['ソフト','Soft']];
export const hasForeignDisplayScript=value=>foreign.test(String(value||''));
export function normalizeDisplayLanguage(product){
 const p={...product};
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
