// User-requested exclusions also guard older cached supplements.
const fold=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').normalize('NFC').toLowerCase().replace(/[^a-z0-9가-힣]/g,'');
const excluded=new Set(['Zegna','Ermenegildo Zegna','제냐','에르메네질도 제냐','Goyard','고야드',"Arc'teryx",'Arc’teryx','Arcteryx','아크테릭스','ROA','ROA Hiking','로아','National Geographic','National Geographic Apparel','내셔널지오그래픽','내셔널 지오그래픽','내셔널지오그래픽어패럴','Oakley','Oakley Factory Team','오클리','오클리 팩토리 팀'].map(fold));
for(const brand of ['Common Projects','CommonProjects','커먼프로젝트','커먼 프로젝트','코몬프로젝트','Bally','발리','Martine Rose','MartineRose','마틴 로즈','마틴로즈','Vivienne Westwood','VivienneWestwood','비비안 웨스트우드','비비안웨스트우드','Marc Jacobs','MarcJacobs','마크 제이콥스','마크제이콥스'])excluded.add(fold(brand));
export const isExcludedBrand=brand=>excluded.has(fold(brand));
