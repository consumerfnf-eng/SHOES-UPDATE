# 원본 인기 키워드와 미래예측 출처

현재 공개 화면의 스타일 종합 목록은 [키워드 표시 정책](keyword-ranking.md)의 `verified-style-board-v1`을 따릅니다. 아래는 별도로 보존하는 원본 검색·예측 데이터의 수집 기준입니다.

## 구분 원칙

검색어·해시태그·브랜드 복합 인기는 서로 다른 지표다. 원문의 종류, 표기, 순위, 지역, 집계 기간을 각 근거에 보존한다. 제품 BEST 순위를 검색어 순위로 바꾸지 않으며, 기사 게재나 브랜드 언급만으로 검색 인기를 주장하지 않는다.

현재 인기는 검증된 원순위의 역수 `1 / rank`를 플랫폼별 최대 한 번 반영한다. 숫자 순위 없는 명시적인 현재 트렌드 키워드는 출처 수에만 반영한다. 미래예측은 별도 목록이며 현재 인기 점수에서 제외한다. 한영 동의어는 상품 검색 범위를 연결하되 표시한 원문을 번역하지 않는다.

모든 현재 근거는 확인 후 7일이 지나면 제외한다. 스타일 기사는 원본 게시 시각 30일 이내, 원문 확인 시각 7일 이내인지 검사한다. 브랜드·모델 순위는 원본에 보존하되 이번 주 스타일 목록에서 제외한다. 기존 상품 근거의 한국시간 날짜 필드는 유지한다. 분기 보고서는 새로 읽은 날짜를 새 분기 발행일로 취급하지 않는다.

## 자동 수집이 확인된 순위 원문

| 출처 | 지표와 원문 필드 | 범위·기간 | 검증 방법 |
| --- | --- | --- | --- |
| [무신사](https://www.musinsa.com/main/musinsa/recommend) | 인기 검색어, `componentList[key=popular].items[].text` | 전체 성별 상위 100개, 집계 기간 미공개 | 공식 페이지가 쓰는 공개 API. UI의 번호 있는 목록 순서. `rankIncrement`는 순위 변동이므로 순위로 쓰지 않음 |
| [29CM](https://www.29cm.co.kr/store/search/start) | 인기 검색어, `popularKeywords.rankings[].title / rank` | 기본 인기 검색어 30개, 집계 기간 미공개 | 공식 검색 시작 페이지의 공개 API에 명시된 순위. 별도 브랜드 검색 목록과 중복 합산하지 않음 |
| [TikTok Creative Center](https://ads.tiktok.com/creative/creativeCenter/trends/hashtag?region=KR&period=7) | 해시태그, `items[].hashtagName / rankIndex` | 한국, 최근 7일, 익명 공개 상위 3개 | 공식 페이지의 읽기 전용 POST. `BaseResp.StatusCode=0`. 게시물량·조회 트래픽·기간 대비 성장 지표이며 검색순위가 아님 |
| [Tagwalk](https://www2.tag-walk.com/es/) | 브랜드 트래픽 순위, `section.brands-ranking` 안의 `rank-number / brand` | 홈페이지에 명시한 시작일–종료일, 5개 | 해당 섹션만 파싱. 존재하지 않는 달력 날짜·순위 변동폭·다른 섹션은 제외. 보고서 종료일 이후 7일까지 유효 |
| [Lyst Index](https://www.lyst.com/the-lyst-index/) | 분기별 브랜드 복합 인기, 현재 차트의 `chart-text-left` | 최신 공개 완료 분기, 20개 | Index 링크에서 최신 분기를 발견하고 반환 본문의 canonical·제목 메타데이터·보이는 분기 표시를 대조한 뒤 1–20위를 검증. 숨은 옛 차트 제외. 분기 종료일 이후 180일 상한 |

무신사와 29CM은 원문 업데이트 시각만 제공한다. 따라서 ‘이번 주 수집한 시점의 순위’이며 ‘최근 일주일 검색량 순위’라고 표시하지 않는다. 익명 요청에는 로그인 정보·쿠키·개인 식별자를 보내지 않는다. 이것만으로 플랫폼 내부 집계 방식의 모든 비개인화 정책을 단정하지 않는다.

### 직접 확인한 공개 API

- 무신사: `https://api.musinsa.com/api2/dp/v1/keyword/search-home?popularCount=100&gf=A`
- 29CM: `https://display-bff-api.29cm.co.kr/api/v1/search-home`
- TikTok: `https://ads.tiktok.com/CreativeOne/KnowledgeAPI/GetHashtagList`, POST 본문 `{timeRange:7,countryCode:"KR",page:1,limit:20}`. 요청 limit 20과 달리 익명 응답이 실제 3개를 허용하므로 3개만 수집한다.

이 API는 각 공식 페이지가 사용하는 엔드포인트다. 장기 지원 계약이 있는 개발자 API라고 주장하지 않으며, 구조·원문 제목·순위 검증이 실패하면 해당 출처의 새 순위는 0개로 처리한다. 구독·로그인·비공개 데이터 접근을 추가하지 않는다.

## 매체와 뉴스레터

`collectEditorialKeywords`는 기존 공식 RSS를 읽는다: Sneaker Bar Detroit, Hypebeast, Highsnobiety, Sneaker News, The Sneaker Newsletter, The Dassler.

수집 조건은 최근 7일의 원문 제목, 명시적인 현재 인기·트렌드 표현, 슈즈 문맥, 검토된 사전에 실제로 존재하는 원문 조각이다. 순위는 `null`, 종류는 `editorial-keyword`다. 일반 신제품 발매 기사, 광고·캠페인·경품·이벤트, 미래예측, 제외 품목은 반영하지 않는다. `On` 같은 일반 단어를 브랜드로 수집하지 않는다. 제목 일부를 `sourceOriginalContext`에 보존하고 전문은 공개 데이터에 넣지 않는다.

뉴스레터의 검색순위 미확보 상태와 RSS 기사 확인 상태는 구분한다. 목록의 등장 순서나 ‘Popular’ 기사 탭을 인기 검색어 순위로 바꾸지 않는다.

## 추가 요청 출처의 상태

- Instagram: 공개 검증 가능한 검색순위를 확보하지 못했다.
- Xiaohongshu: 공개 진입점에서 로그인으로 연결되어 공개 검색·스타일 순위를 확보하지 못했다.
- TrendHunter, Sneaker Freaker: 공개 풋웨어 기사 참고 대상으로 등록했다. 검증된 순위나 조건을 충족하는 현재 키워드가 확보될 때만 수치에 반영한다.
- WGSN, F-Trend, Trendstop: 미래예측 출처로 구분한다. 공개 원문에서 확인된 항목만 별도 미래예측 모듈이 제공하며 구독 자료를 추정하지 않는다.

## 모듈 계약과 원자료

`collectSearchKeywords()`는 `{sourceRanks, searchRankStatus, checkedAt, diagnostics}`를 반환한다. `collectEditorialKeywords()`는 `{sourceRanks, editorialStatus, checkedAt, diagnostics}`를 반환한다.

원시 행은 `platform`, `platformName`, `term`, `rank`, `kind`, `sourceUrl`, `evidenceUrl`, `capturedAt`, `rankingPeriod`, `snapshotId`, `verified`를 가진다. 분기·기간 보고서는 `reportId`, `periodStart`, `periodEnd`, `latestPeriodVerified`, `validUntil`, `validityBasis`, `metric`도 가진다. 수집기는 점수를 계산하지 않는다.

실제 공개 응답은 `logs/research/search-keywords/`와 `logs/research/editorial-keywords/`에 확인 시각·요청 범위·SHA-256 해시와 함께 고유 파일로 보존한다. 기존 파일을 덮어쓰지 않으며 Git에 포함하지 않는다. 공개 데이터에는 필요한 근거 필드만 전달한다. 서버 실행의 해당 로그는 작업 실행 환경에 남으므로 영구 보관이 필요하면 별도 비공개 아티팩트 보존 정책을 적용해야 한다.

## 2026-09-28 확인 결과

14:29 KST 실수집: 무신사 100, 29CM 30, TikTok 3, Tagwalk 5, Lyst 20으로 총 158개 원순위 행. 이것은 슈즈 관련성 검사 전의 출처 행 수이며 화면 키워드 수와 다르다. TikTok 공개 3개는 명절 관련 원문이어서 슈즈 키워드로 쓰이지 않는다.

Tagwalk는 2026-09-20–27, Lyst는 Q2 2026 보고서였다. 14:30 KST RSS 6곳에서 최근 7일 기사 63개를 읽었지만 제목 기준의 명시적인 현재 슈즈 인기·트렌드 키워드는 0개였다. 일반 출시기사로 빈칸을 채우지 않았다.
