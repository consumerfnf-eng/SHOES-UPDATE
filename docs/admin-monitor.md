# Administrator collection monitor

Owner entry: `https://shoes-update-internal.pages.dev/admin/`.
The normal site has no administrator navigation link. All administrator HTML,
monitoring data and write APIs are gated on the server by independent owner
authentication. A separate owner password establishes an eight-hour session.
The normal catalog and research library retain their existing team Basic login;
administrator sign-in does not require or reuse the team password.

## Provisioning and deployment

1. Bind the dedicated D1 database as `ADMIN_DB` in the internal Pages project.
2. Run `node scripts/setup-admin.mjs` on the owner's collector PC. The script
   creates the schema and sets `ADMIN_PASSWORD_HASH` and `ADMIN_RUNNER_KEY` via
   stdin. It also sets the latter as a repository Actions secret. Owner password
   text is saved outside the repository in the owner's local Documents folder;
   the script prints its location, never its contents.
   After the first login, use **비밀번호 설정** to choose an owner password
   different from the team password. Only the new salted hash is saved in D1.
3. Run `npm run internal`. Deployment checks the required secrets and synchronizes
   the private monitoring snapshot to D1. No administrative JSON is uploaded as a
   static file, and no source catalog data is modified.

`scripts/setup-admin.mjs` reuses `.secrets/admin-bootstrap.json` on subsequent runs.
Keep that file private. The owner changes the password in the authenticated
settings dialog using the current owner password. A change atomically stores the
new hash and deletes every existing session. Cookies are also bound to the
credential version, so an in-flight old-password login cannot survive rotation.
The original bootstrap password no longer works after setting a custom password.
Do not reuse the existing shared site password as the owner credential.

## Monitoring semantics

- Published models and color/material records come from the deployed official
  catalog under the existing eligibility and identity rules.
- A snapshot is saved on deployment, once per KST day or changed source data.
  Differences compare the two most recent distinct snapshots, not arbitrary
  counts from different feeds. The first observation has no invented difference.
- Collection dates come from recorded source checks. Product verification dates
  are displayed separately and never stand in for a full collection date.
- A check older than seven days, zero published models, a decrease, blocked access
  or partial pagination is flagged for the owner. A collector must explicitly
  confirm pagination completion before the UI labels its scope complete.

## Recollection

The owner can request a brand audit. D1 enforces one queued/running request per
brand. `admin-monitor.yml` polls the queue at minutes 7 and 37; GitHub scheduling
can be delayed. The owner can also open its workflow and run it manually.

**전체 재수집** opens a scope choice for all attention brands or every registered
brand. Search and group filters never narrow that selection. Existing active
requests are retained rather than duplicated. Batch progress distinguishes
complete, partial, failed, running and queued audits; registration is not
successful collection or publication. Four workflow workers drain independent
brand leases in parallel. Diagnostic errors and candidates remain owner-only.

For an explicitly authorized operator review, `admin-audit-one.mjs` writes raw
products and atomic progress files locally. `prepare-admin-rechecked.mjs` rejects
inherited New labels on general sports/casual catalogues. Publication requires
the explicit `--include-lux` flag and the original batch's brand whitelist;
existing IDs and reviewed grouping are retained. Colour/design reviews transfer
between different official image URLs only when cached photo SHA-256 is identical.
Failed image downloads and incomplete source coverage do not become completed
audits. These local reports and rendered source caches are gitignored.

Follow-up batches preserve a separate published baseline. Resume checkpoints
retain unread listing URLs, per-page receipts, unverified product candidates and
whole verified product records. A source configuration change invalidates an old
checkpoint. Smaller resumed runs are unioned by exact identity instead of
replacing the larger previous run; proofs are never assembled from different
captures. Shopify feeds require a real empty terminal page and reject challenges,
wrong URLs and repeated pages. Rendered receipt ingestion is atomic and serialized.

The Nike/Jordan New collector binds adult-sneaker scope, exact merchandise SKU,
product URL and image to the official public JSON response. The same proof
contract is checked by both publication and client image rendering. adidas/Y-3
requires original page hydration, complete root pagination and the explicit adult
sneaker facet; cleats and children are excluded. FILA China and Mihara retain
per-product continuation checkpoints. A successful HTTP response or an editorial
New section alone never establishes brand-wide completeness.

The runner reads the selected brand's permitted official sources, compares
collected URLs and codes with the published catalog, and posts review candidates
back to the private database. These are comparison candidates, not automatically
approved products. It never edits or publishes LUX records or runs a broad catalog
rebuild. No report, candidate list, session token or owner password is uploaded as
a public Actions artifact. The scoped runner key can only claim/complete source
checks; it cannot use owner APIs or edit the
catalog.

## Access protections

Random 256-bit session tokens are stored only as SHA-256 hashes, in Secure,
HttpOnly, SameSite=Strict host-only cookies. Logout deletes the server session;
expired sessions are rejected. Login uses a separately salted PBKDF2 hash,
persistent per-IP attempt limits, same-origin JSON requests and CSRF tokens for
owner write operations. Administrator responses use no-store, noindex, a restrictive
CSP and frame denial. Preview deployments have no production D1 binding.

Tests: `node --test tests/admin-access.test.mjs` and `node tests/admin-ui.mjs`.

## Rendered New receipts and final integrity checks

HOKA and UGG can consume operator-captured, sanitized rendered New grids and
their observed Load More URLs. These receipts retain their real capture time,
URL and extraction contract; browser DOM is not represented as an HTTP 200
response. The ordinary unattended path uses the official HTTP reader and reports
access failures instead of reusing invented response metadata.

UGG optionally accepts matching PDP receipts with expanded own-product Details.
The original New membership and the later product/selected-image evidence remain
separate. Traversing all listing pages does not complete a brand while eligibility
or selected-colour checks remain unresolved. Mixed shoe constructions retain
their additional sneaker-base checks. `prepare-ugg-detail-replay.mjs` replays
these local receipts without fetching or replacing a valid report after an
invalid listing receipt.

After scoped publication, `verify-admin-publication-integrity.mjs` checks the
batch's immutable baseline: no lost catalog/source IDs, duplicate IDs, erased
nonempty price labels, or changes to brands outside the requested batch. The
publisher also runs the full snapshot validator before writing canonical files.
Merged source signals require recomputed popularity and release status.
