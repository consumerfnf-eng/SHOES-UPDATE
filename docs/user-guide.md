# Internal user guide

The top bar opens `/guides/shoes-user-guide.html` in a separate tab so editing state remains available in the dashboard. The guide provides an explicit download of the adjacent PDF, image enlargement and print controls. The HTML and PDF are both protected by the internal site's existing authentication middleware.

`npm run guide` builds an A4 portrait, three-page guide from the six actual UI screenshots in `reports/guide-a4-captures/`. Each explanation identifies the relevant tab. The prose uses Korean nominal endings and highlights the workflow's benefits without inventing measured savings. It uses self-hosted Pretendard Medium embedded in the standalone HTML.

The renderer checks page bounds, PDF page count and size, screenshot loading, tab paths, mobile width, enlargement and PDF link. It writes both review copies in `reports/` and deployment copies in `public/guides/`. These folders remain ignored because screenshots include internal subscription research imagery. Do not commit generated guides or screenshots to the public repository.

Internal deployment refuses to proceed if the linked guide HTML or PDF is absent or incomplete. Refresh the screenshots when the UI or workflow changes, then rebuild and inspect all three rendered pages. Run `node tests/user-guide-ui.mjs` to verify the header link, separate-tab opening, actual PDF download and responsive header layout.
