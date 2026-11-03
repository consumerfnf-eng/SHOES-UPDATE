# Reference boards

The internal dashboard's Reference Board tab stores projects and image snapshots in IndexedDB (`shoes-reference-boards-v1`). Data belongs to the current browser and origin, survives catalogue removal and deployment, and is not synchronised between browsers. Photo-inclusive JSON backups restore as new projects without overwriting existing work.

Cards and bulk selections capture the active product variant or selected runway photographs, original source URL, colour/style, and actual show season. Project season is independent of source season. Reviewed product framing is applied before an image is stored. Repeated source keys are skipped within a project.

Board and new image assets commit atomically. A serial save queue preserves edit order; revisions reject overwriting a newer version from another tab. Save errors remain visible, with in-memory image data available to the backup command. Removed entries retain their assets for undo; archived projects can be restored.

The same canvas renderer produces the preview and six-reference pages. PNG is 4800×2700; multiple pages download as a ZIP. PDF embeds the 4800×2700 JPEG pages on a 960×540 pt page (360 dpi) and includes clickable original-source annotations. Long captions are abbreviated visually while full metadata stays in the board and backup. Oversized body text is reported rather than silently clipped.

The interface and new board exports use self-hosted Pretendard Regular 400. The font is from [Pretendard v1.3.9](https://github.com/orioncactus/pretendard/tree/v1.3.9); its SIL Open Font License is included beside the WOFF2 file.

Validation: `node tests/reference-boards-ui.mjs`, `node --test tests/board-store.test.mjs`, the existing UI suites, and rendering the downloaded PDF with PyMuPDF. Browser tests cover the selected colour, duplicate capture, product/show bulk actions, photo/project notes, reorder/undo, reload after source removal, backup/import, archive/recovery, concurrent-tab conflicts, real PNG/PDF downloads, responsive layouts, and Regular font loading.
