# SNS 인기 신상품: 로그인과 주간 자동화 연결 방법

확인일: 2026-10-06. 공식 문서와 현재 저장소를 읽기만 했으며 계정·권한·비밀키·쿠키를 변경하거나 수집하지 않았다.

## 결론

사용자가 직접 로그인하면 같은 브라우저에서 상세 통계를 확인하는 첫 단계는 진행할 수 있다. 그러나 브라우저 로그인만으로 GitHub Actions가 그 계정을 사용하는 것은 아니다. 매주 사이트 접속 없이 갱신하려면 **서버에서 허용된 API/데이터 연결**, **로그인 상태를 보관하는 클라우드 브라우저**, 또는 **항상 켜진 PC에서 유지되는 브라우저 작업**을 따로 구성해야 한다. 브라우저 세션의 무기한 유지는 보장할 수 없다.

권장 순서는 **로그인 화면에서 실제 상품별 수치 확인 → 자료를 검증해 SNS 주목 신상에 연결 → 승인된 API/데이터 연결로 주간 자동화**다. 상품별 자료가 없는 해시태그는 제품 인기도로 꾸며 넣지 않는다.

## 플랫폼별 실제 가능 범위

| 경로 | 로그인 후 확인 가능한 것 | 주간 무인 수집 조건 | 중요한 한계 |
|---|---|---|---|
| TikTok Creative Center Trends | 국가·기간·업종별 해시태그, 추이, 관련 영상·지역·관련 태그 | 브라우저에서 조회 가능한 범위를 먼저 검증. 공개 수치 또는 명시적으로 허용된 데이터 연결이 있으면 서버 수집 | 웹 로그인은 API 사용 권한이 아니다. 공식 안내에서 전역 상품 검색량 API를 확인하지 못했다. 해시태그 수치는 상품/색상 수치와 다르다. |
| TikTok Creator Search Insights | 개인화된 인기 검색 주제와 주제별 search popularity | 현재 공식 안내는 TikTok 앱에서 이용하는 방식. 자동 수집 API는 확인하지 못함 | popularity를 검색 횟수로 바꾸지 않는다. ‘팔로워 검색’ 필터는 1,000명 초과 팔로워가 필요하지만 전체 기능에 1,000명이 필요하다는 뜻은 아니다. |
| TikTok Display API | 연결에 동의한 크리에이터 자신의 프로필·영상 | 개발자 앱과 해당 사용자 OAuth 권한 | 다른 사람들의 전역 상품 검색/해시태그 인기 수집용이 아니다. |
| TikTok Research API | 승인된 연구 프로젝트의 공개 데이터 연구 | 연구 자격 심사·프로젝트 승인 | 공식 FAQ가 creator/advertiser/commercial user는 지원 대상이 아니라고 명시. 이 상업적 슈즈 기획 사이트의 기본 연결 방안으로 권하지 않는다. |
| Instagram Hashtag Search API | 특정 태그의 공개 top/recent media | Business/Creator 계정, Facebook Login 계열 API 연결, App Review, instagram_basic 및 Instagram Public Content Access 승인 | rolling 7일 동안 계정당 30개 고유 태그. 일반 SNS 검색어 전체 순위나 전체 상품 검색량을 주는 API가 아니다. 가져온 게시물 수는 확인 표본이다. |

근거: [TikTok Trends 사용법](https://ads.tiktok.com/resources/help/article/how-to-use-trends?lang=en), [Creative Center 소개](https://ads.tiktok.com/help/article/creative-center?lang=en), [Creator Search Insights](https://support.tiktok.com/en/using-tiktok/growing-your-audience/creator-search-insights), [Display API](https://developers.tiktok.com/docs/en/display-api-overview), [Research API 자격 FAQ](https://developers.tiktok.com/docs/en/research-api-faq), [Instagram Hashtag Search](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/hashtag-search).

## 사용자가 직접 해야 하는 단계

### 1. TikTok 화면 확인을 먼저 시작할 때

1. 작업에 사용할 브라우저에서 [Creative Center](https://ads.tiktok.com/creative/creativeCenter/trends/hashtag)에 직접 로그인한다. 비밀번호·2단계 인증은 사용자가 입력한다.
2. Trends → Hashtags에서 신상품의 정확한 모델명과 한영 별칭을 조회한다. 예를 들어 일반적인 `#sneakers` 대신 해당 모델만 식별 가능한 태그를 사용한다.
3. 사용할 국가와 화면이 제공하는 기간을 확인한다. 30일/120일만 제공되면 이를 3개월로 바꾸어 쓰지 않는다. 상품 출시 기준은 최근 달력상 3개월이고, SNS 측정기간은 별도로 적는다.
4. 모델별 수치와 관련 영상의 제품이 일치하는지 확인한다. 화면의 수치·기간·국가·조회일·원문 링크를 저장한다.
5. 이 자료로 첫 SNS 카드들을 만든다. 로그인 화면에 수치가 없다면 ‘미공개’로 적고 임의 계산하지 않는다.

로그인되어 있다는 말만으로 다른 Chrome/Edge/Codex 브라우저의 세션이 공유되지는 않는다. 실제 작업 브라우저에서 로그인 표시와 필요한 상세 화면을 확인해야 한다.

### 2. Instagram을 PC가 꺼져도 갱신하려면

1. 사용할 Instagram 계정이 Business/Creator인지 확인한다. 개인 계정이면 사용자가 전환 여부를 결정한다.
2. Meta 개발자 앱을 만들고 Instagram API with Facebook Login의 연결 요건에 맞춰 계정·Page 연결을 완료한다.
3. 공개 해시태그 수집을 위한 App Review 및 필요한 기능/권한 승인을 신청한다. 로그인만으로 이 승인이 완료되는 것은 아니다.
4. 사용자가 공식 OAuth 화면에서 요청 권한을 확인하고 동의한다. 애플리케이션 서버가 허용된 토큰을 받아 비공개 저장소에 보관한다. 비밀번호나 브라우저 쿠키를 Git 저장소에 올리지 않는다.
5. 모델별 한영 별칭 중 중복을 줄여 최대 30개 태그 묶음을 계획한다. 같은 7일 동안 언어별 태그도 각각 한 개로 계산한다.
6. 승인 범위와 반환 가능한 기간/필드를 실제 호출로 검증하고 주간 수집에 연결한다. 최근 3개월 전체 게시물 이력을 처음부터 소급해서 얻는다고 약속하지 않는다.

근거: [Instagram Hashtag Search 요구 사항](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/hashtag-search), [IG Hashtag Search 참조](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-hashtag-search).

### 3. 로그인 유지의 현실적인 선택

**서버 API 방식 — 권장**

- 일요일 오전 8시 기존 GitHub Actions에서 토큰의 유효성을 확인하고 수집한다. 사용자의 PC가 켜져 있을 필요가 없다.
- 만료 또는 철회된 권한만 재연결하도록 안내한다. 자동 갱신 가능한 토큰은 서버에서 갱신하고 바뀐 refresh token도 저장한다.
- TikTok 일반 OAuth의 access token은 최초 발급 후 24시간, refresh token은 365일이다. 이 토큰이 있다고 Creative Center의 전역 인기 통계를 호출할 권한이 생기지는 않는다.
- Meta의 Facebook Login 장기 User token은 대체로 약 60일이다. 어떤 토큰이 필요한지는 승인된 API 연결 방식에 따라 정하고, ‘영구 토큰’으로 설명하지 않는다. 브라우저 로그인과 OAuth 토큰의 수명은 별개다.

근거: [TikTok User Access Token Management](https://developers.tiktok.com/docs/en/oauth-user-access-token-management), [Meta 장기 액세스 토큰](https://developers.facebook.com/documentation/facebook-login/guides/access-tokens/get-long-lived).

**사용자 PC의 같은 브라우저로 정기 확인 — 시작용 대안**

- 사용자가 직접 로그인한 전용 프로필을 같은 PC에서 재사용하는 방식으로 설계할 수 있다. 지원되는 브라우저 자동화 경로를 먼저 확인해야 한다.
- 정해진 시각에 PC·네트워크·작업 프로그램이 실행 가능해야 한다. 현재 GitHub 서버 작업과는 별도다.
- 로그인 만료, 보안 확인, 2단계 인증 또는 CAPTCHA가 뜨면 그 플랫폼 수집만 보류하고 재로그인을 요청한다. 이를 자동 우회하지 않는다.
- 영구적인 로그인 유지 또는 한 번 로그인 후 모든 주간 작업이 영원히 무인 실행된다고 보장할 수 없다.
- 로컬 세션을 그대로 GitHub로 옮기지 않는다. 일반 GitHub-hosted runner는 매 작업마다 새 실행 환경을 사용한다.

근거: [GitHub-hosted runners](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners).

### 4. PC를 꺼도 로그인 상태를 재사용하는 대안: Firecrawl Cloud 프로필

Firecrawl은 이름이 있는 프로필에 쿠키·localStorage 등 브라우저 상태를 저장하고 다음 세션에서 재사용하는 기능을 문서화하고 있다. 이는 현재 Codex 브라우저와 별개인 **외부 서비스의 브라우저**다. 사용할 경우 로그인 상태를 Firecrawl에 보관한다는 점과 요금을 사용자에게 알리고 동의받아야 한다. 이번에는 프로필을 만들거나 계정을 옮기지 않았다. [공식 capabilities](https://docs.firecrawl.dev/capabilities)

사용 절차:

1. 사용자가 선택한 Firecrawl 계정에서 API 키·사용 한도를 마련한다. 구독 구매나 결제는 별도 확인한다.
2. 플랫폼마다 전용 프로필을 만들고 `interactiveLiveViewUrl`을 사용자에게 연다. 일반 `liveViewUrl`은 보기 전용이므로 로그인 입력에는 대화형 뷰가 필요하다.
3. 사용자가 그 원격 브라우저에서 SNS 로그인·2단계 인증을 직접 완료한다. 현재 로컬 브라우저의 쿠키를 추출해 옮기지 않는다.
4. 프로필을 저장하며 세션을 닫고, 새 세션에서 같은 프로필로 재접속해 로그인 유지와 상품별 통계를 실제 검증한다.
5. GitHub의 `FIRECRAWL_API_KEY`와 비밀을 포함하지 않는 프로필 이름으로 매주 필요한 시간에만 새 세션을 연다. 결과만 저장하고 종료한다. API 키와 원격 제어 URL은 로그에 출력하지 않는다.
6. 재로그인이 뜨면 사용자에게 새 대화형 뷰를 제공한다. 프로필 저장 기능이 SNS의 로그인 만료나 차단을 없애지는 않는다.

Firecrawl 문서상 프로필은 세션이 닫힐 때 저장되며, 동시에 쓸 수 있는 세션은 하나다. HTTP/Node 옵션은 `saveChanges`, Python 옵션은 `save_changes`다. 매번 새 세션 ID를 받아 같은 프로필 이름으로 연결해야 한다. [브라우저 프로필 동작](https://docs.firecrawl.dev/features/browser#persistent-sessions)

확인일 기준 Interact 비용은 코드만 사용하면 분당 2크레딧, AI 프롬프트를 쓰면 분당 7크레딧이고 최소 1분부터 부과된다. Scrape는 별도 과금이다. 사용량 실측 전 월 비용을 확정하지 않는다. 원격 브라우저 직접 로그인의 지원과 비용은 확인했으나 **TikTok/Instagram에서 이 방식이 실제로 성공하는지는 아직 시험하지 않았다.** [대화형 뷰·프로필·과금 문서](https://docs.firecrawl.dev/features/interact)

| 방식 | 사용자 PC | 로그인 자료 위치 | 시작 조건 |
|---|---|---|---|
| 공식 API | 꺼도 됨 | 서버의 승인된 토큰 저장소 | 계정·앱 심사·권한 승인 |
| Firecrawl Cloud 프로필 | 꺼도 됨 | Firecrawl의 전용 프로필 | 외부 세션 보관·비용 동의, API 키, 실제 로그인 검증 |
| 로컬 브라우저 | 예약 시 실행 가능해야 함 | 사용자 PC의 브라우저 | 지원되는 로컬 자동화·실행 예약 |

**이번 요구에는 클라우드 프로필 시범 연결이 가장 직접적인 대안이다.** 단, 화면에 모델별 통계가 있어야 하며, 플랫폼이 허용한 접근 범위에서 동작해야 한다. 국가/IP를 바꾸어도 숨겨진 검색량이나 존재하지 않는 공개 지표를 만들 수는 없다. 장기적으로 승인된 API를 함께 쓰면 화면 변경·세션 만료에 대한 의존을 줄일 수 있다.

## SNS 카드와 인기 선정 기준 제안

1. **대상 상품:** 현재 허용된 브랜드, 최근 달력상 3개월 출시, 스니커즈/검증된 스니커즈 혼합형, 공식 제품 URL·옆면/45도 사진 확인.
2. **일치 기준:** 모델명 또는 품번이 정확히 일치해야 한다. 오래된 `Samba`, `Speedcat` 전체 태그 수를 새 협업이나 새 색상의 인기 숫자로 붙이지 않는다.
3. **표시 숫자:** 실제 검색 횟수 / 해시태그 게시물 수 / 영상 조회 수를 각각 구분한다. 검색 인기도 점수만 보이면 단위를 ‘점수’로 보존한다.
4. **표본 구분:** 플랫폼이 제공한 전체 태그 수와 우리가 확인한 게시물 개수를 구분한다. API 표본 개수를 전체 게시물 수라고 표시하지 않는다.
5. **정렬:** 플랫폼·국가·기간·지표가 같은 표본에서 많은 순으로 정렬. 공식 순위가 없으면 ‘확인된 상품 내 순위’로 표시한다. 조회수와 검색수를 합산하지 않는다.
6. **화면:** `SNS 주목 신상` + 공식 상품 사진·모델명·색상칩. 카드의 작은 문구는 `TikTok · [실제 기간] 게시물 [실제 수치] · 검색량 미공개` 형식. 상세정보에서 원문과 확인일을 제공한다.
7. **완료본 공개:** 수집·검증·중복 제거·사진 확인이 모두 끝난 스냅샷만 한 번에 공개한다. 일부 플랫폼 실패 시 완료된 기존 자료를 유지하되 마지막 확인일을 그대로 남긴다. 최근 3개월을 지난 상품은 기존 아카이브 절차로 이동한다.

위 기준은 구현 제안이다. 실제 수치가 없는 예시 상품·예시 랭킹은 사이트에 넣지 않는다.

## 현재 저장소에서 확인한 준비 상태

- `scripts/social-metrics.mjs`는 검색 수, 해시태그 게시물 수, 조회 수 검증, 모델/품번 일치, 달력상 3개월, 같은 기간·국가끼리 비교를 지원한다.
- 현재 SNS 표시 자격은 검증된 양수 검색 수 또는 게시물 수다. 조회 수만으로 자격을 확대하려면 사용자 기준에 맞춘 별도 변경이 필요하다.
- `config/social-metric-sources.json`은 TikTok을 `reviewed-evidence-import`, `automatedAdapter: null`, `unavailable`로 기록하고 있다. **주간 SNS 실수집 어댑터가 연결된 상태가 아니다.**
- 해당 설정은 `data/social-metric-evidence.json` 입력 계약을 명시하지만, 현재 파일은 없다. 즉 실제 가져올 검증 수치 자료가 아직 없다.
- 기존 `.github/workflows/weekly-update.yml`은 일요일 08시 KST와 실패 시 보완 실행을 예약하고 있다. SNS API 연결이 완료되면 이 흐름에 붙일 수 있다.
- SNS 계정·로그인 프로필·권한은 아직 연결하지 않았다. 일반 상품 수집 경로는 별도 변경했으며, 확인된 SNS 상품 수는 여전히 0개다.

## 실행 순서

1. 작업 브라우저에서 사용자 직접 TikTok 로그인 → 정확한 신상품 5~10개에 대해 제공되는 수치·기간을 확인.
2. 검증된 첫 자료로 SNS 카드와 데이터 계약 연결. 빈 목록을 가짜 상품으로 채우지 않음.
3. Instagram 계정 유형/Meta 승인 진행 여부를 확인하고 API 연결 구성.
4. TikTok은 실제 허용된 서버 데이터 연결 여부를 확인. 로그인 브라우저가 필요하면 선택한 클라우드 프로필 또는 같은 PC의 전용 프로필로 재접속을 시험한다. 화면 수집이 불가능하면 사용자가 제공하는 공식 내보내기 자료로 운영 범위를 명시.
5. 일요일08시 수집 → 검증 → 성공본 게시 → 인증 만료/수집 실패만 알림. 공개 키워드·일반 상품 업데이트는 SNS 인증 실패와 별개로 계속 동작.

상업용 소셜 리스닝 공급자를 이용하면 서버 자동화 범위가 넓어질 수 있으나, 계약 전 TikTok/Instagram 수집 권한·국가/기간별 제공 범위·모델별 수치·재게시 권한·가격을 확인해야 한다. 아직 특정 유료 서비스를 선택하거나 가입하지 않았다.
