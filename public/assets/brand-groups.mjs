// Display categories only. Archive destinations continue to use the existing
// sheet routing rules, independently of this two-group browsing layout.
export const BRAND_GROUPS = [
  {name:'LUX', priority:['Louis Vuitton','Miu Miu','Prada','Gucci','Dior','Balenciaga','Celine','Saint Laurent','Hermès','Moncler','Bottega Veneta','Loewe']},
  {name:'SPORTS', priority:['On','Cecilie Bahnsen','ASICS','FILA','Mizuno','New Balance','Salomon','adidas','Nike','PUMA','Axel Arigato','PANE','Onitsuka Tiger']}
];
const key = name => String(name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const luxury = new Set([...BRAND_GROUPS[0].priority,'Common Projects','Golden Goose','Maison Mihara Yasuhiro'].map(key));
const sports = new Set(BRAND_GROUPS[1].priority.map(key));
export function displayBrandGroup(brand) {
  if(sports.has(key(brand.name))) return 'SPORTS';
  return luxury.has(key(brand.name)) || brand.group === 'luxury' ? 'LUX' : 'SPORTS';
}
export function groupedBrands(brands) {
  return BRAND_GROUPS.map(group => {
    const priority = new Map(group.priority.map((name,i)=>[key(name),i]));
    return {...group, brands:brands.filter(b=>displayBrandGroup(b)===group.name).sort((a,b)=>(priority.get(key(a.name))??Infinity)-(priority.get(key(b.name))??Infinity)||a.name.localeCompare(b.name,'en'))};
  });
}
