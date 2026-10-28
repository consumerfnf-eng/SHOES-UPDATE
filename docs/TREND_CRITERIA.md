# SHOES — MLB · DISCOVERY Research: 수집·판정 기준

이 문서는 실제로 구현되어 `shoes-update.pages.dev`에 반영 중인 기준을 설명합니다. 희망 사항이 아니라 코드와 일치하는 현재 상태입니다.

## 1. 브랜드 공식 신상품 (매주 일요일 08:00 KST, `scripts/weekly-update.mjs`)

**대상**: `config/daily_sources.json`에 등록된 60개 브랜드(LUX 15 + SPORTS 45) 전체. 브랜드 추가/URL 수정은 이 파일을 편집합니다.

**포함 카테고리**: 스니커즈, 발레리나 스니커즈, 메리제인 스니커즈, 뮬 스니커즈, 젤리 슈즈, 플랫폼 슈즈, 스니커즈 아웃솔 하이브리드(`scripts/curation.mjs`의 `classifyFootwear`).
**제외**: 구두, 옥스포드, 더비, 로퍼(일반), 슬링백, 힐/펌프스/스틸레토, 포멀 부츠·드레스 샌들.
**키즈 제외**: 월간 리테일 수집기(`scripts/monthly/common.py`의 `is_kids_item`)에 구현. 공식 브랜드 수집기는 브랜드 공식몰의 성인 카테고리 URL만 대상으로 하므로 별도 필터 없이 구조적으로 배제됩니다.

**수집 방식**: 브랜드 공식 New/New Arrivals 페이지 → 개별 상품 상세 페이지 진입 → SKU·이미지·컬러웨이 확인. 1차 Jina Reader, 실패 시 2차 공식 사이트 직접 HTML, 3차 Firecrawl 렌더링, 4차 ScrapingBee 렌더링(사용자 키 등록 시, `scripts/scrapingbee-reader.mjs`) 순으로 폴백합니다.

**대표 이미지 규칙**: 신발 단독 측면(side) 또는 45도 각도 확대샷만 채택. 착용샷·룩북(사람 전신 포함)은 이미지 URL 패턴(`_SLS.`, `_PM1_Side` 등)과 `alt` 텍스트 검증으로 배제됩니다(`scripts/new-arrivals.mjs`).

**컬러 그룹핑**: 동일 모델·다른 컬러는 1개 카드로 묶고 원형 컬러칩으로 전환, 상세 페이지에서도 동일하게 동작(`public/assets/catalog-view.mjs`의 `groupProductVariants`/`colorChipsMarkup`). 이미 구현되어 있습니다.

**게시 기간**: 최초 게시일로부터 3개월. 경과 시 공개 목록에서 제외(내부 기록은 보존).

## 2. 리테일 신상 (매달 1일 08:00 KST, `scripts/monthly/update.py`)

| 소스 | 상태 | 비고 |
|---|---|---|
| SSENSE | 자동, curl_cffi | "신상" 필터가 사이트에 없어 월별 스냅샷 비교(델타)로 신규 판정 |
| Lyst | 자동, ScrapingBee(키 필요) | `view=newest` 사용, 실제 날짜 노출 없어 동일하게 델타 판정 |
| Farfetch | 미구현 | 실제 페이지 구조를 한 번도 확인하지 못해 파서를 추측으로 작성하지 않음 |
| Mytheresa | 미구현 | 위와 동일 |

**"신상" 판정**: 이번 실행에서 처음 발견된 상품만 게시. 최초 실행(베이스라인)은 0건 게시 — 그 시점엔 "원래 있던 것"과 "새로 나온 것"을 구분할 근거가 없기 때문입니다. 두 번째 실행부터 실제 월간 변동분만 게시되고, 게시 후 3개월간 유지됩니다.

## 3. 뉴스레터·미디어 (리테일과 같은 실행, 최근 3개월)

Hypebeast, Hypebeast Korea, Sneaker News(WordPress REST API), Footwear News(실제 기사는 wwd.com, WWD "Sneaker News" 카테고리로 필터), Allure Korea(사이트 검색 + 헤드라인 키워드 재검증, 스니커즈 관련 없으면 제외).

**판정**: 기사 헤드라인에서 브랜드+모델 토큰이 겹치거나, `data/monthly-model-aliases.json`에 등록된 별칭과 일치하면 해당 리테일 상품에 "언급"으로 매칭. 일치하는 리테일 상품이 없으면 `data/monthly-unmatched-mentions.json`에 보류(모델명 자동 상품화 금지).

## 4. SNS 인기 (월간)

**Instagram**: 비로그인 해시태그 볼륨(총 게시물 수 + 연관 키워드, `collect_instagram_hashtags.py`) — 항상 작동. 개별 게시물 캡션·좋아요 수는 로그인 세션 등록 시(`collect_instagram.py`) 추가로 매칭.
**TikTok**: 비로그인 접근 시 캡차 차단 확인(`#sneakers`, `#sneakerhead` 모두 차단). 로그인 세션 기반 자동화는 아직 미구현.

## 5. "가장 인기 있는 최신 아이템" 판정 기준

단일 출처만으로 "인기"를 주장하지 않습니다. 아래 **독립 확인 신호의 개수**로 판단합니다 — 가중치 점수가 아니라 투명한 카운트입니다:

1. **리테일 교차 등재**: 동일 모델이 SSENSE와 Lyst 양쪽에 등재되어 있으면 1점.
2. **미디어 언급**: 최근 3개월 내 서로 다른 매체 2곳 이상이 독립적으로 다루면 1점(기존 공식 카탈로그의 `popularity.media` 기준과 동일한 "독립 출처 2곳" 원칙을 재사용).
3. **SNS 신호**: 등록된 모델 별칭으로 실측 게시물이 매칭되면 1점(현재는 로그인 세션 등록 전이라 비어 있음).

신호 개수가 많을수록 상단에 노출됩니다(현재 UI는 "미디어 언급 N건"/"SNS 인기 · 평균 좋아요" 배지로 표시, 수치 정렬은 추후 구현 가능). 실제 사례: PUMA x Jil Sander Speedcat — Lyst(리테일) + Footwear News 기사 4건(미디어) = 2개 독립 신호로 현재 게시 중.

## 6. 외부 요청 중 보류한 항목과 이유

- **Musinsa·KREAM 1~50위 랭킹**: 미구현. 두 사이트 모두 비로그인 자동화 가능 여부를 아직 검증하지 못했습니다.
- **Farfetch·Mytheresa 자동 수집**: 실제 페이지 구조를 한 번도 확인하지 못해 보류. ScrapingBee 키로 최초 응답을 받은 뒤 그 구조를 보고 파서를 작성해야 합니다.
- **TikTok**: 비로그인 차단 확인, 로그인 기반 자동화 미구현.
- **pipeline_master.py 완성**: 중단 — 설정값만 있고 실제 수집·Google Sheets 연동 로직이 없었고, 출력 경로(`shoes_data.json`)도 실제 사이트가 읽지 않는 파일이라 완성해도 사이트에 반영되지 않았을 것입니다. 대신 이 문서에 설명된 파이프라인에 그 요구사항(키즈 제외 등)을 반영했습니다.
