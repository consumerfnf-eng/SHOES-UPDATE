# Expanded MLB reference boards

The internal collection contains 35 concepts for each of 27SS, 27FW and 28SS.
Each season has 10 daily, 10 feminine, 9 active and 6 seasonal concepts. A board
has one independently editable editorial hero and six component references.
Actual image seasons remain separate from the planning season.

## Private inputs and review

Licensed report text, source imagery, the authored concepts and review receipts
remain in ignored local storage. Never stage these files for GitHub. The public
repository contains the tooling, UI and synthetic test fixtures only.

1. `collect-proposal-mlb.py` records observed official comparison products without
   inserting them into the product catalog. `prepare-proposal-inventory.mjs`
   prepares the private catalog/show inventory.
2. Existing image features and `proposal_text_features.py` support candidate
   retrieval. Text causal masks must be materialized after meta-device loading.
   Retrieval scores are not calibrated accuracy, demand or source approval.
3. `match-proposal-references.py` writes candidates and inspection sheets.
   `shortlist-proposal-photo-fixes.py` produces optional replacement shortlists.
   Inspect every selected image and record component-specific notes. New
   mechanisms and performance remain development hypotheses.
4. Save season-specific photo patches and run
   `python scripts/apply-proposal-photo-patches.py`. Resolve every reported
   duplicate anchor, hero or within-board image. The three canonical private
   audits must each contain 35 approved boards matching the final selections.
5. Run `python scripts/resolve-expanded-proposals.py`, then
   `node scripts/enrich-expanded-proposals.mjs`. Finalization rejects missing
   approvals, wrong report headings, invalid pages and failed report pages.
   `--prepare` writes a private draft instead; it does not authorize publication.

## Rendering and release

Run `node scripts/build-expanded-proposals.mjs --render` only after review.
Without `--render`, the command validates inputs without producing artifacts.
The renderer shares the editor's canvas layout and writes native 6000×3375 PNGs,
individual linked PDFs, small WebP previews, 35-tile season overviews and
35-page season PDFs below the deployment file-size limit. Old hashed assets
remain available. The public snapshot is written last.

The interface initially loads 12 small previews. The large viewer requests its
native PNG on explicit zoom. Template imports use the same automatic crop as
the static board; the hero keeps its full composition. Existing manual boards
and version-1 backups remain supported.

Run the unit suite and the focused `proposal-hero-ui.mjs`,
`reference-boards-ui.mjs` and `build-expanded-proposals-ui.mjs` browser checks.
Commit and push only the implementation and tests, stamp `public/deployment.json`
with that commit, and deploy using `npm run internal`. Avoid the broad catalog
build during a proposal-only release. Verify the authenticated canonical site,
all three season counts, template editing, source credits and actual exports.

The proposal process never trains or publishes the owner's shoe classifier.
Its separately gated owner-review/training workflow remains independent.
