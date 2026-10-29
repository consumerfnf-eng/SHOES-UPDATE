// A strict duplicate audit over everything the page publishes.
// Three questions, each answered by listing the actual offenders:
//   1. Do two cards of one brand carry names that differ only by a colour?
//   2. Does one card carry the same colour twice?
//   3. Does one card carry two products that are not the same model?
import fs from 'node:fs/promises';
const V = await import('file:///C:/Users/AC0950/Documents/GitHub/SHOES-UPDATE/public/assets/catalog-view.mjs');
const cat = JSON.parse(await fs.readFile('public/data/catalog.json', 'utf8'));
const mon = JSON.parse(await fs.readFile('public/data/monthly-catalog.json', 'utf8'));

const COLOUR = /블랙|화이트|그레이|브라운|베이지|네이비|블루|레드|그린|핑크|퍼플|옐로우|오렌지|실버|골드|아이보리|크림|카키|올리브|차콜|버건디|와인|민트|탄|샌드|스톤|토프|라벤더|코랄|피치|머스타드|카멜|초콜릿|모카|밤|black|white|grey|gray|brown|beige|navy|blue|red|green|pink|purple|yellow|orange|silver|gold|ivory|cream|khaki|olive|charcoal|burgundy|wine|mint|tan|sand|stone|taupe|lavender|coral|peach|mustard|camel|chocolate|mocha|blk|brn|wht|nvy|gry|grn|blu|pnk|bge|crm|ivy/gi;
const MODIFIER = /라이트|다크|미드|딥|소프트|페일|비비드|메탈릭|매트|올|웜|쿨|light|dark|mid|deep|soft|pale|vivid|metallic|matte|warm|cool|all|triple/gi;
const CODE = /(?=[A-Za-z0-9-]*[A-Za-z])(?=[A-Za-z0-9-]*\d)[A-Za-z0-9][A-Za-z0-9\-_/]{4,}/g;

// What a name says once colours, shade words, codes and brackets are gone.
const skeleton = p => String(V.variantGroupName(p) || p.name || '')
  .normalize('NFKC').toLowerCase()
  .replace(/[([][^)\]]*[)\]]/g, ' ')
  .replace(CODE, ' ').replace(COLOUR, ' ').replace(MODIFIER, ' ')
  .replace(/\b(?:running|sneakers?|shoes?|트레이너|스니커즈|운동화|슬립온)\b/g, ' ')
  .replace(/[^\p{L}\p{N}]+/gu, '');

const report = [];
for (const [label, items] of [['공식', cat.products], ['리테일', mon.retail]]) {
  const groups = V.groupProductVariants(items);
  report.push(`\n=== ${label}: ${items.length} → ${groups.length} 카드 ===`);

  // 1. two cards whose names reduce to the same thing
  const bySkeleton = new Map();
  for (const g of groups) {
    const k = (g[0].brand || '') + '|' + skeleton(g[0]);
    if (skeleton(g[0]).length < 4) continue;
    (bySkeleton.get(k) || bySkeleton.set(k, []).get(k)).push(g);
  }
  const split = [...bySkeleton.entries()].filter(([, gs]) => gs.length > 1);
  report.push(`1) 이름이 색만 빼면 같은데 카드가 갈린 경우: ${split.length}건`);
  for (const [k, gs] of split.slice(0, 14))
    report.push(`    ${k}  →  ` + gs.map(g => `"${V.variantGroupName(g[0]).slice(0, 34)}"(${g.length})`).join('  |  '));

  // 2. one card, the same colour twice
  let dup = 0;
  for (const g of groups) {
    const seen = new Set();
    for (const p of V.uniqueColorVariants(g, g[0].id)) {
      const k = V.canonicalColorKey(V.variantColorLabel(p));
      if (k && seen.has(k)) { dup++; report.push(`    같은 색 두 번: "${V.variantGroupName(g[0]).slice(0,34)}" ${V.variantColorLabel(p)}`); }
      seen.add(k);
    }
  }
  report.push(`2) 한 카드에 같은 색이 두 번: ${dup}건`);

  // 3. one card holding two different models
  const mixed = groups.filter(g => new Set(g.map(skeleton)).size > 1);
  report.push(`3) 한 카드에 다른 모델이 섞임: ${mixed.length}건`);
  for (const g of mixed.slice(0, 10))
    report.push(`    "${V.variantGroupName(g[0]).slice(0,30)}" ← ` + [...new Set(g.map(p => (p.name||'').slice(0, 34)))].slice(0, 3).join(' | '));
}
await fs.writeFile('C:/Users/AC0950/AppData/Local/Temp/claude/audit.txt', report.join('\n'));
console.log(report.join('\n').slice(0, 3000));
