# 품목 확대·해외 공식몰·SNS 점검

## 적용 범위

최근 달력상 3개월에 출시된 기존 브랜드의 다음 품목을 공개한다.

| 품목 | 포함 기준 |
|---|---|
| 스니커즈 | 공식 제품명·카테고리·구조에서 운동화 확인 |
| 발레리나 스니커즈 | 발레형 디자인 + 검토한 스니커즈 밑창 |
| 메리제인 스니커즈 | 스트랩 디자인 + 검토한 스니커즈 밑창 |
| 뮬 스니커즈 | 뒤축이 열린 디자인 + 검토한 스니커즈 밑창 |
| 젤리 슈즈 | 젤리 소재/구조 확인 + 평평한 밑창. Jellyfish 같은 모델명만으로 젤리 분류하지 않음 |
| 플랫폼 슈즈 | 캐주얼 통굽·플랫폼 스니커즈/샌들. 힐·구두는 제외 |

구두, 슬링백, 힐, 로퍼, 펌프스, 정장 메리제인, 일반 발레 플랫은 먼저 제외한다. 상품 설명의 발레리나 '영감'만으로 일반 러닝화를 혼합형으로 바꾸지 않는다. 출시일·공식 상품·공식 측면/45도 사진 검증은 기존대로 유지한다. 발표일, 크롤링일, NEW 표시, 재입고일을 출시일로 대체하지 않는다.

최종 공개 필터와 브라우저 필터에 남아 있던 일반 스니커즈 전용 제한을 제거하고 동일한 품목 범위를 적용했다. 품목 선택 메뉴도 여섯 유형으로 확대했다. SHOES TREND KEYWORD의 신호 숫자와 막대는 제거하고 내부 근거와 정렬 계산은 보존했다.

## 이번에 추가한 상품

| 브랜드·모델 | 출시 | 색상 수 | 근거 |
|---|---|---:|---|
| adidas JENNIE Superstar SQ Ballet | 2026-09-01 | 2 | [브랜드 공식 발표](https://news.adidas.com/originals/adidas-originals-by-jennie--the-first-collaboration-with-global-icon-jennie-unveiled/s/22b50af4-2b86-4722-bd7e-114b67949b58), LB3786/LB3787 공식 상품 |
| adidas Simone Rocha Taekwondo Ballerina | 2026-09-10 | 2 | [브랜드 공식 발표](https://news.adidas.com/originals/adidas-originals-and-simone-rocha-introduce-their-fall-winter-2026-collection/s/2f9928fa-e59e-4da9-9735-2979c41b4de3), KJ5248/KJ5249 공식 상품 |
| adidas Simone Rocha Climacool Mary Jane | 2026-09-10 | 1 | 위 공식 발표의 메리제인 구조 설명, KH7452 공식 상품 |
| Saucony ProGrid V2 Mule | 2026-08-01 | 2 | [브랜드 공식 발표](https://www.saucony.com/en/blog-progrid-v2-mule-press-release/), S101074-1002/1004 공식 상품 및 색상 이미지 응답 |
| Nike Rejuven8 Run Jelly Camo | 2026-08-26 미국 | 1 | [SKU별 미국 발매 캘린더](https://sneakernews.com/2026/07/30/nike-air-rejuven8-gel-camo-pack/), IU3167-002 공식 상품·이미지 |

5개 모델, 8개 색상이다. 기존 60개 색상에 추가해 총 68개 색상을 44개 카드로 표시한다. 플랫폼 필터에는 기존 검증 상품인 Miu Miu Bubble 1개 모델이 포함된다. 발레리나 2개, 메리제인 1개, 뮬 1개, 젤리 1개 모델도 각각 표시된다. 한 모델이 여러 품목 조건을 충족할 수 있어 품목별 수를 합산하지 않는다. 해외 전체 발매를 빠짐없이 확보했다는 뜻은 아니다.

PUMA Speedcat Ballet Jelly는 베트남 공식몰에서 확인했지만, 이전 시즌 출시/최근 입고 정보가 섞여 3개월 이내 신규 출시로 확정하지 않았다. Mowalola Jordan 14 Mule은 홍콩 공식 상품을 읽었지만 여러 지역의 발매일이 달라 추가 검증 대상으로 보존했다. LV Drop 300은 일본 공식 목록을 읽었지만 컬러별 최초 출시 근거가 부족하다.

## 막힌 브랜드 재시도

Reader 요청은 공유 간격을 유지하고, 직접 공식 HTML 요청에도 도메인별 2.5초 간격을 추가했다. 일시적인 429·5xx·네트워크 오류는 한 번 더 시도하며 Retry-After를 따른다. 403·보안 인증 화면은 반복 요청하지 않는다. 새 지역 주소를 주간 수집 설정에 넣었다.

| 브랜드 | 시도한 공식 경로 | 결과 |
|---|---|---|
| Celine | 일본 | 주간 Reader 경로에서 상품 링크 22개 확인 |
| Saint Laurent | 일본 | 주간 Reader 경로에서 상품 링크 6개 확인 |
| Louis Vuitton | 일본 | 별도 렌더링 수집에서는 목록 확인. 주간 Reader/직접 HTML은 실패·403 |
| Dior | 일본 | 지역 선택 화면만 반환. 상품 목록 미확보 |
| Crocs | 한국, 기존 미국·일본 | 보안 안내·429. 추가 재시도 후에도 미확보 |
| Common Projects | 기존 공식 사이트 | Reader 422·네트워크 실패. 별도 공식 국가몰은 확인하지 못함 |

이전 28개 미확인 경로 중 공개 페이지를 읽은 브랜드는 24개로 늘었다. 페이지를 읽어도 출시일이 없으면 상품을 공개하지 않는다. 최신 접속 근거는 `data/discovery-checks.json`에 보존한다.

## SNS 인기 신상품 칸을 만드는 방법

권장 명칭은 **SNS 주목 신상**이다. 우선 실제 출시 검증을 통과한 모델만 대상으로 삼고, 공식 상품 사진을 사용한다. 상품 카드에는 플랫폼·지표·기간을 표시한다. 예: `TikTok · 최근 30일 게시물 1.2만 · 검색량 미공개`. 이는 예시 형식이며 실제 상품 수치가 아니다.

1. **TikTok Creative Center**: 브랜드명이 아닌 정확한 모델의 해시태그를 조회한다. 국가와 제공 기간을 고정하고 게시물 수, 조회 수, 플랫폼 원순위를 각각 기록한다. 120일 합계를 3개월 합계로 바꾸지 않는다. 제공되는 30일 자료를 사용할 때는 그대로 30일로 표시한다. [현재 공식 화면](https://ads.tiktok.com/creative/creativeCenter/trends/hashtag?region=KR&period=30)에서 확인한 3개 공개 태그는 신발과 무관했다. 이 브라우저는 현재 로그아웃 상태다.
2. **TikTok Creator Search Insights**: 많이 검색되는 주제와 인기 점수를 후보 발굴에 사용할 수 있다. 인기 점수를 실제 검색 건수로 표시하지 않는다. 기능은 일부 지역에 제공되며 현재 브라우저의 일반 로그인만으로 서버 무인 수집이 연결되는 것은 아니다. [TikTok 공식 설명](https://newsroom.tiktok.com/en-us/creator-search-insights)
3. **Instagram**: 승인받은 앱과 Business/Creator 계정으로 Hashtag Search의 공개 게시물 표본을 모을 수 있다. 계정당 최근 7일 최대 30개 고유 해시태그 제한과 App Review가 있다. API가 돌려준 표본 수를 플랫폼 전체 게시물 수나 검색량으로 표시하지 않는다. [Meta 공식 문서](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/hashtag-search)

정렬은 같은 플랫폼·국가·기간·지표끼리 비교한다. 모델 전체 해시태그 수치를 특정 신상 색상의 인기로 확대하지 않는다. 기존 시리즈의 오래된 인기만 확인되면 신상 인기 칸에 넣지 않는다. 서로 다른 플랫폼의 수치도 단순 합산하지 않는다.

매주 자동 게시하려면 승인된 API 또는 허가된 데이터 제공 연결이 필요하다. 현재 사용할 수 있는 대안은 로그인 화면에서 확인한 수치를 원문 URL·확인 시각과 함께 검토용 파일로 입력한 뒤 주간 게시 과정에서 검증하는 방식이다. 기존 `data/social-metric-evidence.json` 연결을 사용할 수 있다. 사용자 세션 쿠키를 서버에 복사하지 않는다.

현재 검증된 SNS 인기 신상품은 0개다. 빈 출처 카테고리를 만들 때 사전 확인을 요청한 사용자의 조건에 따라 이번에는 빈 SNS 칸을 추가하지 않았다. 데이터 연결 방법과 실제 적격 모델을 확정한 후 칸을 열 수 있다.

## 보존·예약

기존 원본 2,428개 상품의 모든 필드와 수집 기록을 비교해 보존했다. Google Sheets는 이번 작업에서 쓰지 않았다. 만료 대기 상품 3개의 기록과 기존 아카이브 흐름도 보존했다. 상품·키워드 주간 수집은 일요일 08:00 KST 예약을 유지한다.
