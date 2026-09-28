# 공식 상품·SNS 수치·출시 범위

## 공식 상품과 이미지

`officialProductEvidence`는 verified, url, verifiedAt, brand, style을, `officialImageEvidence`는 같은 필드와 sourceUrl을 가진다. 상품 url·image·품번이 정확히 연결되고 공식 도메인을 통과해야 한다. 이미지 sourceUrl은 실제 상품 url과 같아야 한다. 공식 페이지의 대표 URL이 선택 품번을 생략하는 경우에도 현재 품번과 실제 메인 이미지의 연결을 별도로 검증한다.

Palmes는 자체 판매 품번과 외부 Converse 품번을 다르게 쓴다. 공식 상품명·색상·이미지는 공식 ProductGroup에서 확인하고, 외부 품번 근거는 externalStyleEvidence로 따로 보존한다. 자체 페이지에 외부 품번이 적혀 있다고 주장하지 않는다.

브랜드 탭은 공식 상품·이미지 증빙이 있는 출시 완료 상품만 표시한다. 필수 럭셔리 브랜드의 공식 스니커즈는 MLB 디자인 참고로 허용하며, 소재·활동성 같은 미확인 기능을 추가하지 않는다. Gucci Drip A00A2SFAGMQ9656만 승인된 footwearReview에 따라 설명의 'slip-on ease of a loafer' 비유를 실제 로퍼 분류와 구분한다.

## SNS 수치

`socialMetrics`는 검색 수(search-count/searches), 해시태그 게시물 수(hashtag-post-count/posts), 조회 수(view-count/views)를 구분한다. 값은 원문에서 확인한 정수 또는 null이다. 조회 수는 검색 수를 대신하지 않는다. SNS 목록은 공식 상품·이미지를 확인하고 양수 검색 수 또는 게시물 수가 있는 아이템을 표시한다. 단일 아이템도 수치는 표시할 수 있으며 임의 순위는 만들지 않는다.

각 행에는 platform, metric, value, unit, scope, periodStart, periodEnd, capturedAt, sourceUrl, query, country, verified, identity를 보존한다. scope=period는 실제 측정 시작/종료일을, cumulative는 시작/종료일을 null로 두어 누적 값임을 표시한다. 확인 당시 3개월 안의 기간만 인정하고, 현재 확인시각·측정 종료일이 달력상 3개월을 지나면 제외한다. 확인 실패로 capturedAt을 갱신하지 않는다.

identity.level=variant는 정확한 brand/style을 요구한다. model은 공식 상품 증빙의 modelIdentity(id/name/verified)와 metric의 modelId/modelName이 일치해야 한다. 일반 시리즈 수치를 협업 모델·색상별 수치로 확장하지 않는다. 같은 모델을 여러 색상으로 표시해도 비교 표본은 한 모델이다.

동일 플랫폼·지표·단위·scope·국가·측정기간 안에서만 수치가 큰 순으로 비교한다. 누적 수치는 같은 한국 날짜에 관측한 값만 비교한다. 두 아이템 이상이면 comparison.coverage=observed-sample의 '수집 상품 내 순위'를 계산하며 동률은 같은 순위다. 실제 공개 순위는 published-ranking으로 표시하고 출처·원순위를 보존한다. 플랫폼별 수치나 조회·검색·게시물량을 합산하지 않는다.

기존 SNS 게시물·계정 개수 판정은 폐지했다. 개별 게시물은 보존 원문이며 SNS 인기의 수치 근거가 아니다. 로그인 필요 출처의 세션·쿠키를 서버 수집에 옮기지 않는다. 공개 수치 수집기가 없거나 원문이 차단되면 미확보 상태를 유지한다.

## 출시월

공유 모듈은 public/assets/release-window.mjs다. 정확한 일자는 기존 규칙을 따른다. 월은 releaseDate=YYYY-MM과 dateEvidence.precision=month, verified=true를 요구하며 verifiedReleaseWindow에 그 달의 첫날/마지막 날을 기록한다. 상품의 실제 출시일을 임의로 첫날로 바꾸지 않는다.

월 전체가 최근 3개월 범위 안이고 오늘 이전일 때 공개한다. 경계와 일부만 겹치거나 미래/진행 중인 월이면 보류한다. 월 전체가 만료된 경우만 아카이브 대기열에 넣는다. 다운로드는 원래 YYYY-MM을 유지한다.
