# Internal research updates

The internal deployment includes licensed CATWALK and Forecast assets that are
deliberately absent from Git. A normal public checkout must never deploy over
the internal project with an empty research library. `deploy-internal.mjs`
checks both collections before uploading; the old public project remains a
redirect to the internal site.

Forecast uses three consecutive half-year seasons. Before July 2027 the window
is 27SS, 27AW and 28SS; it advances every January and July in Asia/Seoul.
Only titles containing the word Sneaker or Sneakers qualify. The first year
of A/W 27/28 maps to 27AW. Key Silhouettes keyword chips are extracted only
from Fashion silhouette and Core updates headings.

`scripts/build-research-assets.py <private-inventory-folder>` renders the
reviewed report PDF inventory into 2200-pixel pages and small covers. Install
the separate `requirements-research.txt` for this local build. Source PDFs,
inventory metadata, the rendered pages and the Forecast index remain ignored.

The same command with `--feed` builds a reviewed feed inventory. A private
`feed-source.json` supplies `season` and `expectedCount`; its absence selects
the initial Spring/Summer 2027 collection with exactly 112 unique sources.
An incomplete inventory aborts. Each new season must use its observed count
and label. Original image availability and actual dimensions are retained;
an unavailable original may use the observed feed rendition without claiming
that it is a high-resolution original. Cards use small thumbnails; opening a
card and saving use the largest retained rendition.

CATWALK fragments replace only the same collection within the same season.
Runway and Fashion Feed therefore coexist. Three seasons are retained by
calendar order. The composer validates referenced assets before writing.

`scripts/import-rank-observations.mjs <reviewed-dom-inventory.json>` accepts
exactly fifteen distinct native ranks per retailer. Rankings are market
references independent of the catalogue's brand filter. Preserve the page's
scope, URL, observation time and actual ranking basis: popularity, sales
quantity and an editorial Trending order are different measures. Never fill
missing positions with invented products or silently retain a failed read
as a fresh observation.

The local Codex weekly research automation checks WGSN and the retailer pages,
retains previous successful snapshots when a source fails, commits only
unlicensed code/catalogue changes, builds and deploys the complete internal
library, and verifies the live commit. It depends on the local PC and a valid
WGSN session. The old Windows CATWALK-only deployment task was disabled when
this consolidated automation was enabled to prevent an older checkout from
replacing the new site.
