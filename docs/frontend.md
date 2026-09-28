# SHOES frontend

## Behavior

- `public/index.html` is a small static shell. `assets/app.mjs` reads one completed `data/catalog.json` snapshot. Visitors never start collection, mutate a sheet, classify old records, calculate image colours or persist the entire catalog in browser storage.
- `sourceStatus.lastSuccessfulCollectionAt` is the last successful collection time. `publishedAt` is only a publication fallback, labelled as publication. A failed fetch or invalid snapshot produces an explicit retry state, never a fabricated catalog.
- Mandatory 25 brands remain selectable with a zero count. Brand filters, search, MLB / DISCOVERY / common fit, product type, release state and source popularity combine. Source tabs require the pipeline's `popularity[type] === true`; a single mention alone does not qualify.
- Calendar-month expiry uses Korean local date and clamps month ends. Released and upcoming are evaluated by date. Unknown/expired/distant-future dates are hidden, even if a prior snapshot is cached. An open tab checks again each minute and on visibility changes.
- Forty cards are rendered per page. Images have fixed aspect ratio, lazy loading, async decode and an error fallback. Images and the fonts service are the only external frontend requests. Image hosts may affect load time; the catalog has no blocking full image download.
- Checkboxes keep selection across filters and pages. Cards open a native dialog drawer with official product link, release region/evidence, verified date, fit reasons and source evidence. Native dialogs provide keyboard focus containment and Escape dismissal.
- Sidebar collapses behind a button on narrow screens. All controls are labelled, active states use `aria-pressed`, and `prefers-reduced-motion` disables animation.

## Download contract

The header names and order follow [Retail Archive productRows](https://consumerfnf-eng.github.io/retail-archive-/js/csv.js). Only the following 17 keys may be exported:

`season,country,brand_group,court,brand,gender,category,subcategory,fabric,fabric_group,product_name,colorway_count,variant_names,colors,hex_colors,top_hex,image_url`

`exportData` can supply archive-normalized values, but it cannot add keys. Brand group English identifiers are translated to the reference's Korean labels. Unknown country and season remain blank. Category is `shoe`. A card is a single verified product/colourway; no fuzzy name-based variant merging occurs. An explicit archive-normalized variant group must supply its count/names itself.

Source URLs/check dates, popularity reasons, verification dates, MLB/DISCOVERY fit/reasons never enter downloaded rows. CSV has UTF-8 BOM and escaped quoted cells. Dangerous spreadsheet formula prefixes are neutralized. XLSX is a true OOXML ZIP workbook with inline text cells, no formula execution/macros, no external dependency/CDN scripts. Its columns follow the same whitelist. XLSX contains image URLs as the reference export does; it does not embed product image binaries.

## Fonts and source references

- Google Sans: official [googlefonts/googlesans](https://github.com/googlefonts/googlesans), [OFL license](https://github.com/googlefonts/googlesans/blob/main/OFL.txt). The official repository states SIL Open Font License without reserved font names.
- Noto Sans KR: [Google Fonts](https://fonts.google.com/noto/specimen/Noto+Sans+KR), [official font/license files](https://github.com/google/fonts/tree/main/ofl/notosanskr).
- Fonts are requested using Google Fonts CSS with `display=swap` and browser-specific subset delivery. No large font binary bundle is committed. When unavailable, Korean/English system fonts render immediately.
- Reference grouping labels: [Retail Archive config.js](https://consumerfnf-eng.github.io/retail-archive-/js/config.js).

## Verification

Run from the repository root:

```powershell
node --test tests/ui.test.mjs
node tests/ui-browser.mjs
$env:UI_BROWSER_CHANNEL='msedge'
node tests/ui-browser.mjs
```

The unit tests cover KST rollover, month-end/leap-year boundaries, date states, qualified source filters, safe external URLs, the exact export whitelist, distinct colourway preservation, Unicode/formula escaping and XLSX structure.

The browser test starts its own ephemeral local server and uses an explicitly synthetic 48-product fixture (never published). It verifies desktop/mobile filtering, 40-card pagination, mandatory zero-count brands, upcoming/unknown/expired treatment, detail region and official link, selection across pages, selectable CSV/XLSX columns, failure recovery, no horizontal overflow, one catalog GET and no mutation requests. Screenshots and real downloaded files are saved under the printed OS temporary directory. Browser fonts are stubbed for deterministic fixture tests; live font availability needs production verification.

2026-09-28 results: unit tests 5/5; installed Chrome and Edge browser scenarios passed, zero page errors. Initial local fixture render was approximately 0.26–0.30 seconds. This is not a claim about external production/network latency. Downloaded XLSX also opened using Python openpyxl with 3 rows, 17 columns and correct Korean text/group labels. Desktop (1440 px) and mobile (390 px) screenshots were visually inspected. `node tests/ui-preview.mjs` also verified the actual staged catalog with external product images and real Google Sans / Noto Sans KR: 4 released products rendered, all 4 images decoded, zero page/network errors in that run. Safari/iOS was not executed in this Windows environment.
