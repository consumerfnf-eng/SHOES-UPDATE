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
