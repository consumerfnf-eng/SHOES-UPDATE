// Keep this whitelist in the same order as Retail Archive's productRows().
// https://consumerfnf-eng.github.io/retail-archive-/js/csv.js
export const EXPORT_COLUMNS = [
  ['season', '시즌'], ['country', '국가'], ['brand_group', '브랜드 그룹'], ['court', '코트'],
  ['brand', '브랜드'], ['gender', '성별'], ['category', '카테고리'], ['subcategory', '세부 품목'],
  ['fabric', '소재'], ['fabric_group', '소재 그룹'], ['product_name', '상품명'],
  ['colorway_count', '컬러웨이 수'], ['variant_names', '변형 상품명'], ['colors', '색상'],
  ['hex_colors', '색상 코드'], ['top_hex', '대표 색상 코드'], ['image_url', '이미지 URL'],
];

export function productRecord(product) {
  // A card represents one verified product/colourway. Never merge by similar names.
  // Archive-shaped export data is optional, but its fields still pass this whitelist.
  const p = product.exportData || {};
  const colors = (product.colors || []).map(c => typeof c === 'string' ? c : c.name).filter(Boolean);
  const hexes = (product.colors || []).map(c => c?.hex).filter(h => /^#[\da-f]{6}$/i.test(h || ''));
  const rawGroup = p.brand_group ?? product.brandGroup ?? product.archiveGroup ?? '';
  const group = {luxury:'럭셔리',contemporary:'컨템포러리',athleisure:'애슬레저',outdoor:'아웃도어·스포츠'}[rawGroup] || rawGroup;
  return {
    season: p.season ?? product.season ?? '', country: p.country ?? product.country ?? '',
    brand_group: group, court: p.court ?? (group === '코트' ? 'Y' : ''),
    brand: p.brand ?? product.brand ?? '', gender: p.gender ?? product.gender ?? '',
    category: 'shoe', subcategory: p.subcategory ?? product.productType ?? product.category ?? '',
    fabric: p.fabric ?? product.material ?? '', fabric_group: p.fabric_group ?? product.fabricGroup ?? '',
    product_name: p.product_name ?? product.name ?? '', colorway_count: p.colorway_count ?? 1,
    variant_names: p.variant_names ?? '', colors: p.colors ?? colors.join(' | '),
    hex_colors: p.hex_colors ?? hexes.join(' | '), top_hex: p.top_hex ?? hexes[0] ?? '',
    image_url: p.image_url ?? product.image ?? '',
  };
}

export function exportRows(products, selected = EXPORT_COLUMNS.map(([key]) => key)) {
  const keys = EXPORT_COLUMNS.map(([key]) => key).filter(key => selected.includes(key));
  if (!keys.length) throw new Error('내려받을 정보 항목을 하나 이상 선택해 주세요.');
  return [keys, ...products.map(p => { const row = productRecord(p); return keys.map(key => row[key]); })];
}

export function safeCell(value) {
  const text = String(value ?? '').replace(/\u0000/g, '');
  // Quoting CSV cells does not stop spreadsheet formula execution.
  return /^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? "'" + text : text;
}

export function csvBytes(rows) {
  return new TextEncoder().encode('\uFEFF' + rows.map(row => row.map(v => '"' + safeCell(v).replace(/"/g, '""') + '"').join(',')).join('\r\n'));
}

const xml = value => safeCell(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function columnName(n) { let name = ''; for (++n; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name; return name; }
const crcTable = Array.from({length:256}, (_, n) => { for (let i=0;i<8;i++) n = n & 1 ? 0xEDB88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(bytes) { let c = 0xFFFFFFFF; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStored(files) {
  const encoder = new TextEncoder(), chunks = [], directory = []; let offset = 0;
  for (const [filename, content] of Object.entries(files)) {
    const name = encoder.encode(filename), data = encoder.encode(content), crc = crc32(data);
    const local = new Uint8Array(30 + name.length), l = new DataView(local.buffer);
    l.setUint32(0, 0x04034B50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true);
    l.setUint16(12, 33, true); l.setUint32(14, crc, true); l.setUint32(18, data.length, true);
    l.setUint32(22, data.length, true); l.setUint16(26, name.length, true); local.set(name, 30);
    const central = new Uint8Array(46 + name.length), c = new DataView(central.buffer);
    c.setUint32(0, 0x02014B50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true);
    c.setUint16(14, 33, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true); central.set(name, 46);
    chunks.push(local, data); directory.push(central); offset += local.length + data.length;
  }
  const directorySize = directory.reduce((n, part) => n + part.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054B50, true); e.setUint16(8, directory.length, true); e.setUint16(10, directory.length, true);
  e.setUint32(12, directorySize, true); e.setUint32(16, offset, true);
  const all = [...chunks, ...directory, end], result = new Uint8Array(all.reduce((n, part) => n + part.length, 0));
  let at = 0; for (const part of all) { result.set(part, at); at += part.length; } return result;
}

// Small dependency-free OOXML workbook: actual .xlsx, UTF-8, text cells, no macros/formulas.
export function xlsxBytes(rows) {
  const sheet = rows.map((row, r) => `<row r="${r+1}">${row.map((v, c) => `<c r="${columnName(c)}${r+1}" t="inlineStr"${r === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(v)}</t></is></c>`).join('')}</row>`).join('');
  const range = `A1:${columnName(rows[0].length-1)}${rows.length}`;
  return zipStored({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="SHOES" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${range}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="${rows[0].length}" width="22" customWidth="1"/></cols><sheetData>${sheet}</sheetData><autoFilter ref="${range}"/></worksheet>`,
  });
}
