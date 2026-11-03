# Reference boards

The internal dashboard's Reference Board tab stores projects and image snapshots in IndexedDB (`shoes-reference-boards-v1`). Data belongs to the current browser and origin, survives catalogue removal and deployment, and is not synchronised between browsers. Photo-inclusive JSON backups restore as new projects without overwriting existing work.

Cards and bulk selections capture the active product variant or selected runway photographs, original source URL, colour/style, and actual show season. Project season is independent of source season. New snapshots preserve the full image (up to 2400 px); reviewed framing or foreground detection supplies non-destructive crop metadata. The crop editor supports rectangle selection, zoom and position, automatic close-up, and full-image reset. Complex runway scenes use conservative lower-frame cropping and may need manual adjustment. Repeated source keys are skipped within a project.

Board and new image assets commit atomically. A serial save queue preserves edit order; revisions reject overwriting a newer version from another tab. Save errors remain visible, with in-memory image data available to the backup command. Removed entries retain their assets for undo; archived projects can be restored.

The same canvas renderer produces the preview and six-reference pages. PNG is 4800×2700; multiple pages download as a ZIP. PDF embeds the 4800×2700 JPEG pages on a 960×540 pt page (360 dpi) and includes clickable original-source annotations. Long captions are abbreviated visually while full metadata stays in the board and backup. Oversized body text is reported rather than silently clipped.

The interface and body copy use self-hosted Pretendard Regular 400. Exported titles and slightly larger style hashtags use Pretendard Bold 700. Photo notes appear above product names; captions show brand and colour/source season without homepage addresses. Original URLs remain in the board, backup and PDF link annotations. Both weights are from [Pretendard v1.3.9](https://github.com/orioncactus/pretendard/tree/v1.3.9); the SIL Open Font License is included beside the WOFF2 files.

Project names can populate hashtags from the current style keyword, product, and seasonal proposal vocabulary. Manual edits switch the board to manual mode; renaming then preserves those tags. “추천 다시 적용” explicitly returns to automatic suggestions. Existing nonempty tags are preserved. All 18 seasonal proposals are available through the template picker and their Brief edit buttons; importing creates an independent editable project with all six photos, source seasons, insight, strategies and clearly labelled target-price hypotheses. It leaves original proposals unchanged.

Archive contents are visible without expansion. Project checkboxes support selected deletion into a recoverable trash; restore retains photos and notes. Assets are deliberately retained for undo and recovery.

Validation: `node tests/reference-boards-ui.mjs`, `node --test tests/board-store.test.mjs`, the existing UI suites, and rendering the downloaded PDF with PyMuPDF. Browser tests cover the selected colour, duplicate capture, product/show bulk actions, photo/project notes, reorder/undo, reload after source removal, backup/import, archive/recovery, concurrent-tab conflicts, real PNG/PDF downloads, responsive layouts, and Regular font loading.
