# LUX official sneaker assortment audit — 2026-11-02 KST

This is a read-only first-page diagnostic of all 34 brands currently in the site LUX list. It is not a full catalogue reconciliation, and no collected products from this diagnostic were published. Every brand remains incomplete.

| Brand | Pages read | Candidate links | Accepted sneaker records | Limitation |
|---|---:|---:|---:|---|
| Louis Vuitton | 1 | 23 | 7 | Only first page inspected; pagination, genders, regions and product checks remain |
| Miu Miu | 1 | 18 | 1 | Only first page inspected; pagination, genders, regions and product checks remain |
| Gucci | 1 | 33 | 0 | Only first page inspected; pagination, genders, regions and product checks remain |
| Dior | 1 | 22 | 21 | Only first page inspected; pagination, genders, regions and product checks remain |
| Prada | 1 | 75 | 7 | Only first page inspected; pagination, genders, regions and product checks remain |
| Celine | 1 | 5 | 0 | Only first page inspected; pagination, genders, regions and product checks remain |
| Balenciaga | 1 | 13 | 0 | Only first page inspected; pagination, genders, regions and product checks remain |
| Saint Laurent | 1 | 5 | 0 | Only first page inspected; pagination, genders, regions and product checks remain |
| Hermès | 1 | 0 | 0 | No product cards parsed; category discovery required |
| Moncler | 1 | 19 | 0 | Only first page inspected; pagination, genders, regions and product checks remain |
| Loewe | 1 | 35 | 0 | Only first page inspected; pagination, genders, regions and product checks remain |
| Bottega Veneta | 1 | 37 | 0 | Only first page inspected; pagination, genders, regions and product checks remain |
| Axel Arigato | 1 | 8 | 8 | Only first page inspected; pagination, genders, regions and product checks remain |
| Autry | 1 | 43 | 4 | Only first page inspected; pagination, genders, regions and product checks remain |
| ALOHAS | 1 | 31 | 24 | Only first page inspected; pagination, genders, regions and product checks remain |
| Maison Mihara Yasuhiro | 1 | 90 | 0 | Only first page inspected; pagination, genders, regions and product checks remain |
| Golden Goose | 1 | 62 | 1 | Only first page inspected; pagination, genders, regions and product checks remain |
| Maison Margiela | 1 | 57 | 5 | Only first page inspected; pagination, genders, regions and product checks remain |
| Jil Sander | 1 | 16 | 0 | Only first page inspected; pagination, genders, regions and product checks remain |
| PANE | 0 | 0 | 0 | Official source could not be read: Source returned no usable page; official HTML: fetch failed; rendered-public-official: No rendered reader configured |
| Fendi | 1 | 1 | 0 | Only first page inspected; pagination, genders, regions and product checks remain |
| Rick Owens | 1 | 29 | 0 | Only first page inspected; pagination, genders, regions and product checks remain |
| Givenchy | 1 | 20 | 20 | Only first page inspected; pagination, genders, regions and product checks remain |
| Valentino Garavani | 1 | 0 | 0 | No product cards parsed; category discovery required |
| Alexander McQueen | 1 | 20 | 0 | Only first page inspected; pagination, genders, regions and product checks remain |
| Chanel | 1 | 15 | 1 | Only first page inspected; pagination, genders, regions and product checks remain |
| AMIRI | 1 | 14 | 1 | Only first page inspected; pagination, genders, regions and product checks remain |
| Lanvin | 1 | 24 | 24 | Only first page inspected; pagination, genders, regions and product checks remain |
| Off-White | 1 | 24 | 24 | Only first page inspected; pagination, genders, regions and product checks remain |
| Common Projects | 0 | 0 | 0 | Official source could not be read: Source HTTP 422; official HTML: PUBLIC_SOURCE_HTTP_503; rendered-public-official: No rendered reader configured |
| Brunello Cucinelli | 1 | 0 | 0 | No product cards parsed; category discovery required |
| The Row | 1 | 7 | 7 | Only first page inspected; pagination, genders, regions and product checks remain |
| Zegna | 1 | 0 | 0 | No product cards parsed; category discovery required |
| Loro Piana | 0 | 0 | 0 | Official source could not be read: Source returned no usable page; official HTML: fetch failed; rendered-public-official: No rendered reader configured |

## Observed failures

- PANE: Reader returned no usable page; direct official HTML fetch failed.
- Common Projects: Reader HTTP 422; direct official site HTTP 503.
- Loro Piana: Reader returned no usable page; direct official HTML fetch failed.
- Hermès, Valentino Garavani, Brunello Cucinelli, Zegna: a response was obtained but no candidate cards were parsed. This does not establish an empty assortment.

## Required improvements

1. Configure explicit men/women sneaker category URLs per brand, not general New or home pages.
2. Record official advertised totals and reconcile every page/SKU before claiming completeness.
3. Use rendered readers for JS grids and retain a durable per-brand/page checkpoint to resume work.
4. Collect each product variant URL and bind code, model, material and image before grouping.
5. Separate full LUX assortment refresh from weekly new-arrival collection; failure or empty pages must preserve existing products.
6. Treat image-download failure as a separate published-vs-collected gap and report it by brand.

## Approval blocker

Automatic approval review rejected creating a manual GitHub workflow using existing API secret bindings and pushing validated catalogue updates to main. A review-only file is at /tmp/lux-assortment-workflow.yml. The user explicitly approved saving this manual workflow and running it once. No schedule is configured. Full run results will be recorded in the workflow artifact and public coverage report after successful validation.
