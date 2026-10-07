# Firecrawl API 키 설정 가이드 — 2026-10-07

## 왜 필요한가

2026-09-28 자동 수집에서 Louis Vuitton, Dior, Gucci, Saint Laurent, ASICS, New Balance 등 필수 브랜드 다수가 `NO_RESPONSE`로 실패했습니다. 원인은 `run_daily_update.mjs`/`weekly-update.mjs`가 기본적으로 익명(무료) Jina Reader만 사용하는데, 이 브랜드들의 공식 사이트가 Akamai 등 봇 차단으로 익명 Reader 요청을 403/빈 응답으로 막기 때문입니다.

이 저장소의 수집 코드는 이미 Firecrawl을 **대체 수단(fallback)**으로 쓰도록 작성되어 있습니다.

- `scripts/rendered-official-reader.mjs` → `createRenderedOfficialReader()`가 `https://api.firecrawl.dev/v2/scrape`를 직접 호출합니다 (`proxy:'auto'`, `formats:['markdown']`).
- `scripts/official-reader.mjs` → 직접 요청과 익명 Reader가 모두 실패하면 이 Firecrawl 경로로 한 번 더 시도합니다.
- `.github/workflows/weekly-update.yml` 36–37번째 줄에 이미 아래처럼 두 키가 모두 선언되어 있습니다.

  ```yaml
  env:
    JINA_API_KEY: ${{ secrets.JINA_API_KEY }}
    FIRECRAWL_API_KEY: ${{ secrets.FIRECRAWL_API_KEY }}
  ```

즉 **코드 수정은 필요 없고, GitHub 저장소에 `FIRECRAWL_API_KEY` 시크릿 값만 등록하면** 매주 일요일 자동 수집(weekly-update.yml)이 이 대체 경로를 사용하게 됩니다. 키가 없으면 `apiKey` 파라미터가 빈 문자열로 전달되어 `mode:'keyless'`로 동작하며(`rendered-official-reader.mjs` 9번째 줄), 무료/비로그인 한도 때문에 지금처럼 금방 막힙니다.

## 1단계 — Firecrawl API 키 발급

1. https://www.firecrawl.dev 에서 계정을 만듭니다 (GitHub/Google 로그인 또는 이메일 가입).
2. 로그인 후 대시보드의 **API Keys** 메뉴로 이동합니다.
3. `fc-`로 시작하는 키를 생성하고 복사해 둡니다. (키는 생성 직후 한 번만 전체가 표시되는 서비스가 많으니 바로 복사하세요.)
4. 요금제: 무료 플랜은 월 크레딧이 제한적입니다. 이 프로젝트는 주 1회(일요일) 전체 브랜드 재수집 + 실패 브랜드 재시도 구조라 호출량이 꾸준히 발생하므로, 무료 한도로 부족하면 유료 플랜(Starter 등)으로 전환을 검토하세요.

## 2단계 — GitHub Actions 시크릿 등록

1. GitHub에서 이 저장소로 이동합니다.
2. **Settings → Secrets and variables → Actions**로 이동합니다.
3. **New repository secret**을 클릭합니다.
4. Name에 정확히 `FIRECRAWL_API_KEY`를 입력합니다 (대소문자/철자가 코드와 정확히 일치해야 함 — `weekly-update.yml`의 `secrets.FIRECRAWL_API_KEY`와 매칭).
5. Value에 1단계에서 복사한 키(`fc-...`)를 붙여넣고 **Add secret**을 클릭합니다.
6. 이미 등록돼 있어야 하는 `JINA_API_KEY`도 같은 화면에서 존재 여부를 확인하세요. 없다면 함께 등록합니다.

이 작업만으로 다음 예약 실행(`cron: '0 23 * * 6'`, 매주 일요일 08:00 KST)부터 Firecrawl 대체 경로가 활성화됩니다.

## 3단계 — 수동으로 즉시 확인하고 싶다면

1. GitHub 저장소 **Actions** 탭 → **Weekly Curated Shoes Update** 워크플로 선택.
2. **Run workflow** → `force: true`로 즉시 1회 실행.
3. 실행 로그에서 `Jina key configured` / Firecrawl 관련 에러 메시지가 줄었는지 확인합니다. 완료 후 `data/last_update.json`(또는 `logs/weekly-diagnostics.json`)의 브랜드별 `status`가 `NO_RESPONSE`에서 `CHECKED`로 바뀌었는지 확인하세요.

로컬 PC에서 직접 테스트하려면 (node_modules/playwright 설치 필요):

```bash
# PowerShell
$env:FIRECRAWL_API_KEY = "fc-..."
$env:JINA_API_KEY = "..."
npm run weekly
```

## 이 키로 해결되는 것 / 안 되는 것

**해결되는 것**: 브랜드 공식 사이트의 상품 목록/상세 페이지 **본문(markdown) 읽기** 실패. 이번 세션에서 Firecrawl을 직접 사용해 Louis Vuitton(미국/일본), Dior, Gucci, New Balance, Saint Laurent, ASICS(영국 도메인) 페이지를 모두 정상적으로 읽어왔습니다 — 즉 이 키만 연결되면 자동화도 같은 결과를 얻을 수 있습니다.

**해결되지 않는 것**: `scripts/cache-product-photos.mjs`는 Firecrawl을 거치지 않고 Node `fetch()`로 이미지 원본 바이트를 **직접** 내려받습니다. Louis Vuitton의 이미지 CDN(`us.louisvuitton.com/images/...`)은 이 직접 요청을 403으로 차단합니다 (curl, PowerShell `Invoke-WebRequest`, Firecrawl 직접 이미지 요청 모두 동일하게 403 — 실제 브라우저 컨텍스트에서만 허용되는 것으로 보임). 이번 세션에서 LV 신상품 3건(Time Out Sneaker, Frontrow Sneaker 2개 컬러)은 공식 페이지 검증까지는 마쳤지만 사진 캐시 실패로 게시를 보류했습니다 (`data/catalog-source.json`에는 남아 있어 사진 경로만 해결되면 바로 게시 가능). 이 부분은 별도로, 예를 들어 `cache-product-photos.mjs`가 이미지도 Firecrawl `/v2/scrape`(또는 스크린샷) 경로를 거치도록 바꾸는 작업이 필요합니다 — 이번 작업 범위 밖이라 코드는 건드리지 않았습니다.

## 참고 — 이번 세션에서 직접 추가한 신상품

Firecrawl로 직접 확인 후 "New/New Arrivals" 배지와 공식 상품 증빙(이미지 옆면/45도 확인 포함)을 근거로 게시한 항목 (게시일 추정월: 2026-09, 정확한 일자 비공개로 보수적 기록):

- Dior: DiorAlps Walk'n'Dior Platform Sneaker, DiorAlps Dior Ribbon Sneaker, DiorAlps Dior Saltwind Sneaker (3건, Jonathan Anderson DiorAlps 캡슐)
- Gucci: Women's Drip sneaker 화이트 스웨이드 / 샌드&브라운 GG 캔버스 (2건, 기존 검증된 Drip 스니커즈 모델의 여성용 컬러웨이 — Straits Times 2026년 8월 출시 보도를 그대로 재사용)
- ASICS: GEL-KAYANO 14 Illusion Blue/Pure Silver (1건, 공식 Sportstyle New Arrivals)
- Louis Vuitton: Time Out Sneaker, Frontrow Sneaker ×2 색상 — 공식 증빙까지는 완료, 사진 캐시 실패로 게시 보류 (위 참고)

`npm run build` / `node --test tests/*.test.mjs` 모두 정상 통과를 확인했습니다 (playwright 미설치로 인한 `daily.test.mjs` 1건 실패는 이 환경의 기존 결함이며 이번 변경과 무관).
