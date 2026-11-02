// User-requested exclusions also guard older cached supplements.
const fold=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9가-힣]/g,'');
const excluded=new Set(['Zegna','Ermenegildo Zegna','제냐','에르메네질도 제냐','Goyard','고야드',"Arc'teryx",'Arc’teryx','Arcteryx','아크테릭스','ROA','ROA Hiking','로아','National Geographic','National Geographic Apparel','내셔널지오그래픽','내셔널 지오그래픽','내셔널지오그래픽어패럴','Oakley','Oakley Factory Team','오클리','오클리 팩토리 팀'].map(fold));
export const isExcludedBrand=brand=>excluded.has(fold(brand));
