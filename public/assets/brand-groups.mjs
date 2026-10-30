// Display categories only. Archive destinations continue to use the existing
// sheet routing rules, independently of this two-group browsing layout.
export const BRAND_GROUPS = [
  // The LUX list is the 32 houses named for the group, in the order they
  // were named. Everything in it sits above every SPORTS brand on the page.
  {name:'LUX', priority:[
    'Louis Vuitton','Dior','Balenciaga','Prada','Gucci','Celine','Saint Laurent','Hermès',
    'Chanel','Miu Miu','Alexander McQueen','Fendi','Valentino Garavani','Givenchy',
    'Maison Margiela','Bottega Veneta','Loewe','Lanvin','Rick Owens','Jil Sander',
    'Off-White','AMIRI','Loro Piana','Brunello Cucinelli','Zegna','Moncler','The Row',
    'Golden Goose','Maison Mihara Yasuhiro','Common Projects','Axel Arigato','Autry'
  ]},
  {name:'SPORTS', priority:['Rockfish Weatherwear','On','Cecilie Bahnsen','ASICS','FILA',
    'Mizuno','New Balance','Salomon','adidas','Nike','PUMA','PANE','Onitsuka Tiger']}
];
const key = name => String(name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
// Valentino's shoe line is registered under its own name; both spellings
// reach the same house.
const luxury = new Set([...BRAND_GROUPS[0].priority,'Valentino'].map(key));
export function displayBrandGroup(brand) {
  // The named list is asked first, so a house that also appears in a sports
  // ordering still reads as LUX. A luxury brand nobody named - Ferragamo,
  // Tod's, Khaite - follows from its policy group rather than dropping into
  // SPORTS, which is where an unnamed house used to land.
  if(luxury.has(key(brand.name)) || brand.group === 'luxury') return 'LUX';
  return 'SPORTS';
}
export function groupedBrands(brands) {
  return BRAND_GROUPS.map(group => {
    const priority = new Map(group.priority.map((name,i)=>[key(name),i]));
    return {...group, brands:brands.filter(b=>displayBrandGroup(b)===group.name).sort((a,b)=>(priority.get(key(a.name))??Infinity)-(priority.get(key(b.name))??Infinity)||a.name.localeCompare(b.name,'en'))};
  });
}

/** Where a product sits when the grid is ordered by brand group: every LUX
 *  brand before any SPORTS brand, and inside SPORTS, Rockfish first.
 *
 *  Brands named in a group's priority list keep that order; the rest follow
 *  alphabetically, so a new brand lands somewhere predictable rather than
 *  wherever the catalogue happens to list it.
 */
export function brandGroupRank(brand) {
  const group = displayBrandGroup(brand);
  const index = BRAND_GROUPS.findIndex(g => g.name === group);
  const priority = BRAND_GROUPS[index]?.priority.map(key).indexOf(key(brand.name)) ?? -1;
  return {
    group: index < 0 ? BRAND_GROUPS.length : index,
    priority: priority < 0 ? Number.MAX_SAFE_INTEGER : priority,
    name: String(brand.name || ''),
  };
}

export function compareByBrandGroup(a, b) {
  const x = brandGroupRank(a), y = brandGroupRank(b);
  return x.group - y.group || x.priority - y.priority || x.name.localeCompare(y.name, 'en');
}
