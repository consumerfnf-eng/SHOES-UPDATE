# LUX sneaker expansion — 2026-11-02

Target: https://shoes-update-internal.pages.dev/

The 22 requested houses were reconciled against the existing LUX list. The existing nine houses and all 5,444 previously published official variants were preserved. Thirteen missing houses were registered once, with collection enabled. This snapshot adds 404 verified official assortment variants and 77 available Bally UAE regional-store variants. Together these form 137 design cards and 473 physical colour/material chips; eight reviewed Kenzo gender duplicates share chips while retaining both source records.

| Added house | Official variants | Regional retail variants | Design cards |
|---|---:|---:|---:|
| Goyard | 0 | 0 | 0 |
| Burberry | 37 | 0 | 11 |
| Versace | 60 | 0 | 9 |
| Balmain | 28 | 0 | 6 |
| Ferragamo | 35 | 0 | 15 |
| Jimmy Choo | 73 | 0 | 12 |
| Christian Louboutin | 57 | 0 | 23 |
| MCM | 20 | 0 | 7 |
| Coach | 25 | 0 | 7 |
| Tory Burch | 22 | 0 | 11 |
| Bally | 0 | 77 | 27 |
| Stella McCartney | 16 | 0 | 5 |
| Kenzo | 31 | 0 | 4 |

Counts refer to this expansion only. Existing retail-only colours may add cards or chips in the combined view. Three additional exact retail duplicates (Versace Icaro and two Stella McCartney variants) were removed in favour of their official products, with exact asset/URL-bound decisions preserved in `data/reviewed-retail-duplicates.json`.

Official shelves, observed pagination, linked PDPs and the rendered Ferragamo/Louboutin listings supplied the evidence. The [Bally UAE public catalogue](https://www.bally.ae/products.json?limit=250&page=1) was exhausted across nine pages containing 2,166 products; sold-out and non-sneaker products were excluded. Stock observation is not a release date. These regional Bally products are explicitly labelled Bally UAE retail, distinct from the empty bally.com global sneaker shelves.

No official Goyard sneaker was verified on the [inspected official catalogue](https://www.goyard.com/kr_ko/). The brand remains registered with zero products. Unverified customs and lookalike stores were excluded. Stella McCartney wedge heels and a clog, Ferragamo ballet flats/derby footwear, perfume and a Jimmy Choo slipper were reviewed and excluded from this sneaker expansion.

Photos were reviewed in contact sheets. Current-colour Tory Burch large side assets replace tiny thumbnails; exact Ferragamo gallery stills replace worn/rear shots; Bally Flick uses an exact factory-reference retailer side photograph while keeping Bally UAE availability provenance. Versace's shaded studio backgrounds required reviewed upper-body crops for colour inference. All 481 new records have a cached photo and a colour label.

Regression checks: Node 383 passed (including the concurrent CATWALK/collection changes); Python 233 passed; catalogue/build validation passed. The machine-readable evidence summary is in `data/lux-expansion-report.json`, also served inside the authenticated site. Coverage is limited to the inspected regional sources and their observed pagination; this does not assert worldwide catalogue completeness.

The existing weekly collection workflow now refreshes Bally UAE independently of Common Projects. Internal hosting continues to use the existing protected Direct Upload deployment; no password or access policy was changed.
