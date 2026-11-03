# SPORTS/CASUAL official sneakers

The official tab offers all three group buttons. Existing LUX product records,
photos and model/colour groups are frozen for this update. The scoped publisher
asserts equal SHA-256 digests over the full ordered LUX object arrays in both
the published catalogue and raw source before writing anything. Never run the
full curation/build/photo/identity pipeline as part of this scoped update.

SPORTS/CASUAL products need verified official product and image provenance,
sneaker classification, and either current official New/New Arrivals evidence
or an official sale/launch date entirely within the previous three calendar
months. Catalogue/latest sorting, collection time, creation time and modification
time do not establish a release date. Exclude slides, bags, socks, boots and work
shoes. Failed source reads are unresolved checks, not evidence of an empty range.

The owner's Alo exception includes Sneakers, platform Boots, Slippers and the
official Slides department (including Malibu Loafer) from the supplied Korea
New collection. The adapter retains literal KRW feed prices, color SKU prefixes
and original platform construction through re-curation; it never dates a shoe
from Shopify creation/modification timestamps. The full paginated New product
feed is also checked for permitted SPORTS/CASUAL Shopify brands, since the
initial HTML can contain only clothing while the rendered shoe filter has
products. Non-footwear/Sandal departments and exact asset refusals still win.

FILA China is an independent SPORTS brand. The adapter traverses the official
desktop women's and men's New-sort shoe pages, validates pagination, and reads
each product's public JSON. `market_time` means **official sale start**, not an
original global launch. Colour SKU and gallery images are bound by `id_pa`.
Size runs do not produce new variants. Reviewed code/name/photo design families
unite gender and A/F material editions; different designs with repeated names
remain separate. Family 642177 is deliberately separate by gender because the
official names and silhouettes differ. Exact duplicate photos/codes are removed.

Update workflow:

1. `npm run sports:collect` — official sources only; writes scoped raw files.
2. Review source coverage, new FILA code families and variant gallery photos.
   Preserve exact asset refusals in `data/sports-casual-photo-reviews.json` and
   verified FILA bindings in `data/fila-china-*-reviews.json`.
3. `npm run sports:prepare` — scoped curation, original photo caching, small
   WebP card renditions and missing colour inference from the shoe photograph.
4. `npm run sports:publish` — validate assets, deduplicate against the existing
   catalogue, append eligible records and raw evidence, rebuild lossless chunks,
   and record LUX invariance in `reports/sports-casual-update.json`.
5. Run tests/UI checks; compare the LUX hashes with the pre-task baseline.
   Commit explicit changed files and referenced assets only. Build the ignored
   three-page guide with `npm run guide` before deploying the internal site.

Do not publish pending/held records or a review queue on the site. Report brands
with unavailable or unresolved New sources separately to the owner. A successful
partial collection must not be described as exhaustive brand coverage.
