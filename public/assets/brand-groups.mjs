// MONTHLY_SNEAKERS_V1
// Display categories only. Archive destinations continue to use the existing
// sheet routing rules, independently of this two-group browsing layout.
export const BRAND_GROUPS = [
  {name:'LUX', priority:['Louis Vuitton','Miu Miu','Prada','Gucci','Dior','Balenciaga','Celine','Saint Laurent','Hermès','Moncler','Bottega Veneta','Loewe']},
  {name:'RETAIL', priority:[]},
  {name:'SPORTS', priority:['On','Cecilie Bahnsen','ASICS','FILA','Mizuno','New Balance','Salomon','adidas','Nike','PUMA','Axel Arigato','PANE','Onitsuka Tiger']}
];
const key = name => String(name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const luxury = new Set([...BRAND_GROUPS[0].priority,'Common Projects','Golden Goose','Maison Mihara Yasuhiro'].map(key));
const sports = new Set(BRAND_GROUPS.find(g=>g.name==='SPORTS').priority.map(key));
export function displayBrandGroup(brand) {
  if(brand.group==='retailer'&&!sports.has(key(brand.name))&&!luxury.has(key(brand.name)))return 'RETAIL';
  if(sports.has(key(brand.name))) return 'SPORTS';
  return luxury.has(key(brand.name)) || brand.group === 'luxury' ? 'LUX' : 'SPORTS';
}
export function groupedBrands(brands) {
  return [...BRAND_GROUPS].sort((a,b)=>['LUX','SPORTS','RETAIL'].indexOf(a.name)-['LUX','SPORTS','RETAIL'].indexOf(b.name)).map(group => {
    const priority = new Map(group.priority.map((name,i)=>[key(name),i]));
    return {...group, brands:brands.filter(b=>displayBrandGroup(b)===group.name).sort((a,b)=>(priority.get(key(a.name))??Infinity)-(priority.get(key(b.name))??Infinity)||a.name.localeCompare(b.name,'en'))};
  });
}
