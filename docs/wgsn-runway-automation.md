# WGSN 런웨이 수집 자동화

S/S27 캣워크 자료를 shoes-update에 올리는 경로와, 그 중 자동화할 수 있는 부분과 할 수 없는 부분을 적는다.

## 결론부터

| 단계 | 자동화 | 이유 |
|---|---|---|
| 필터 조합 생성 | 가능 (전부) | 검색 상태가 URL 파라미터 하나에 들어 있다 |
| 목록·메타데이터 수집 | 가능 (로그인 세션 안에서) | 구독 세션 쿠키가 있는 브라우저에서만 응답한다 |
| 원본 이미지 다운로드 | 가능 (로그인 세션 안에서) | 같은 세션 필요. 원본 1장당 1.5MB 내외 |
| 레포 반영·사이트 게시 | 가능 (전부) | `npm run wgsn` 한 줄 |
| GitHub Actions 주간 실행 | **불가** | 구독 자격증명을 CI 시크릿에 넣는 것은 WGSN 약관 위반 위험. 주간 워크플로에 넣지 않았다 |

즉 **수집은 사람의 로그인된 PC에서, 반영은 자동으로**가 이 소스의 한계선이다.

## 1. 필터가 URL 하나에 다 들어 있다

WGSN 캣워크 검색은 화면 상태 전체를 `filters` 파라미터 하나에 URL-encoded JSON으로 담는다.

```
https://www.wgsn.com/fashion/catwalks/search?filters={"seasons":["2913181"],"market":["49153"],"view":["19087"],"brands":["6508"]}
```

쓰이는 숫자 ID는 2026-10 수집 기록의 `source` URL에서 역으로 읽은 값이다. 추정이 아니라 WGSN이 실제로 응답한 ID이고, `config/wgsn-runway.json`에 들어 있다.

| 필드 | ID | 뜻 |
|---|---|---|
| `seasons` | `2913181` | Spring/Summer 2027 |
| `market` | `49153` | 여성 |
| `market` | `49154` | 남성 |
| `view` | `19087` | 전신 (Full Length) |
| `image_type` | `873591` | 디테일 (Details) |
| `brands` | 브랜드별 | 예: `6508` = AGNES B |

**신발을 보려면 `image_type: 873591` 선반을 쓴다.** 전신 사진에서 신발은 몇백 픽셀밖에 안 되고, 디테일 선반이 신발을 단독으로 찍은 컷이다. 2026-10 수집에서 디테일 1,991장 중 상당수가 신발·가방 클로즈업이다.

선반 3개(`config/wgsn-runway.json`의 `shelves`)는 이렇게 매핑된다.

- `women-full-length` — `{seasons, market:49153, view:19087}`
- `men-full-length` — `{seasons, market:49154, view:19087}`
- `details` — `{seasons, image_type:873591}` ← 신발 선반

참고: 여성/남성 전신 필터는 전신 컷과 함께 부분 컷도 돌려준다. 그래서 수량은 **선반이 아니라 WGSN이 붙인 image_type으로 센다**(`imageTypeKey`). 선반으로 세면 검수에서 부분 컷으로 재분류한 92장이 전신으로 잡힌다.

## 2. 수집 (사람의 PC에서)

전제: Chrome에 WGSN 구독 계정으로 로그인되어 있고, Claude 브라우저 확장이 연결되어 있을 것.

1. `https://www.wgsn.com/fashion/catwalks/search?filters=…` 를 위 조합으로 열고, 브랜드 ID를 바꿔가며 목록을 넘긴다.
2. 각 항목에서 기록할 것: `image-item-<id>`, 브랜드, market, image_type, 시즌, 가로·세로, 원본 URL(`https://media.wgsn.com/ss_image_store/…/original_*.jpg`), 그리고 **그 항목을 만든 검색 URL 자체**. 마지막 항목이 중요하다 — 선반 판정의 근거가 된다.
3. 원본은 `https://www.wgsn.com/myfolders/download_original?item_id=image.<id>` 로 받는다.
4. 해상도 기준: 긴 변 2,000px·짧은 변 1,000px 이상, 확대 보간 없음 (`resolutionFloor`).
5. 저장한 목록을 `저장목록.json` 형식의 배열로 남긴다. 레코드 하나는 이렇게 생겼다.

```json
{
  "key": "image-item-42100756",
  "brand": "ZIMMERMANN", "category": "WOMEN", "image_type": "Full Length",
  "season": "Spring/Summer 2027", "provider": "WGSN",
  "file": "ZIMMERMANN/WOMEN/ZIMMERMANN_1.jpg",
  "width": 2574, "height": 3861,
  "sha256": "e35bc3b1…",
  "source": "https://www.wgsn.com/fashion/catwalks/search?filters=…",
  "original_url": "https://media.wgsn.com/ss_image_store/…/original_zmm_prs_ss27_001.jpg",
  "download_control": "https://www.wgsn.com/myfolders/download_original?item_id=image.42100756"
}
```

`sha256`을 함께 남기는 이유: 같은 사진이 다른 경로로 다시 들어오는지 바이트 단위로 알 수 있고, 다음 시즌 수집에서 중복을 바로 걸러낸다.

## 3. 반영 (자동)

```
npm run wgsn -- "<저장목록.json 경로>"
```

두 파일이 나온다.

- `data/wgsn-runway.json` — 전 이미지 색인. 브랜드·선반·치수·해시·로컬 경로·원본 URL. **내부 전용이고 레포에 남는다.**
- `public/data/wgsn-runway.json` — 게시용 보드. 쇼 목록, 선반별 수량, WGSN 딥링크. **이미지 URL·파일 경로·해시는 들어가지 않는다.** 30KB 정도.

사이트에서는 **데이터 분석 탭**의 리테일 랭킹 보드 아래에 `WGSN 런웨이 · Spring/Summer 2027` 보드로 뜬다. 각 쇼의 선반 링크는 WGSN으로 가고, 본인 구독 계정으로만 열린다.

## 4. 왜 사진을 사이트에 올리지 않는가

WGSN은 구독 자료다. 이 레포는 이미 `config/forecast-sources.json`에서 WGSN 유료 보고서를 공개 키워드 모듈에서 제외하고 있고(`"검토한 공개 S/S27 색상 글 외 유료 보고서는 사용하지 않습니다"`), 같은 기준을 캣워크 이미지에도 적용했다. 공개된 것은 "어떤 쇼가 있고 몇 장을 읽었는지"이고, 사진 자체는 수집한 PC에만 있다.

`shoes-update.pages.dev`는 공개 URL이다. 사내용으로만 쓸 생각이어도 주소를 아는 사람은 누구나 열 수 있으므로, 구독 이미지를 올리면 라이선스 범위를 벗어난다. 사진까지 화면에 띄워야 한다면 두 가지 중 하나가 필요하다.

1. `public/internal/` 같은 분리된 비공개 배포로 옮기고 접근 제어를 붙인다 (이 레포에 이미 `MLB_Shoes_Dashboard_Public_Internal_Split` 선례가 있다).
2. WGSN에 재배포 범위를 확인하고 허용 범위 안에서 올린다.

## 5. 다음 시즌에 바꿀 것

`seasons` ID 하나만 바꾸면 된다. F/W 27-28 ID는 그 시즌 검색 URL에서 읽어 `config/wgsn-runway.json`의 `filters.seasons`에 추가한다. 브랜드 ID는 전신 검색 URL의 `brands`에서 그대로 읽힌다.

---

# 부록: 이미지 라이브러리 수집 (실제로 쓰는 경로)

위 캣워크 검색은 컬렉션 전체를 돌려준다. **신발만** 필요하면 Fashion Design의 이미지 라이브러리 저장 검색을 쓴다. 2026-10-30에 확인한 내용.

## API

검색 화면은 전부 이 두 엔드포인트로 돌아간다.

```
GET  /api/cherry/history/<saved-search-hash>   저장 검색의 필터 정의
POST /api/cherry/search/query                  결과
```

`query`의 본문은 이 모양이다. **키가 `filters`이고 `filter`가 아니다** — `history`가 돌려주는 키 이름과 다르므로 그대로 넘기면 필터가 통째로 무시되고 라이브러리 전체(1,500만 건)가 돌아온다.

```json
{
  "filters": { "...history가 준 filter 그대로..." },
  "q": [],
  "log": false,
  "lang": "en",
  "params": {"limit": 200, "offset": 0, "object_id": null, "sort": [{"field": "add_date"}]}
}
```

- `limit` 최대 200. 247건이면 두 번, 3,253건이면 17번.
- `lang: "en"` 이면 도시가 `Paris`, `"ko"` 면 `파리`. 카드에는 영문을 쓴다.
- 응답: `data.count` 총 건수, `data.results[]`.

## 레코드

```json
{
  "id": 42109268,
  "name": "agnb_prs_det_ss27_232",
  "rel_image_id": "image.42109268",
  "caption": ["Agnes B", "Spring/Summer 2027", "Paris"],
  "size": {"original": {"width": 2574, "height": 3861}},
  "urls": {"thumbnail": "...thumb_*.jpg", "detail": "...media_*.jpg", "large": "...large_*.jpg",
            "download": "...", "email": "..."}
}
```

**`caption`이 브랜드·시즌·도시다.** 캣워크 수집 때처럼 도시를 rename 기록에서 역산할 필요가 없다.

## 고화질은 로그인 세션에서만 나온다

중요한 함정이다. `thumbnail`/`detail`/`large`는 전부 **508×552, 12KB**로 같은 것이 나온다. 진짜 원본은 URL의 렌디션 접두사를 바꾼 주소다.

```
https://media.wgsn.com/ss_image_store/86/29/01/24/original_agnb_prs_det_ss27_232.jpg
```

- 로그인 세션(브라우저) → **2,574×3,861, 2.0MB**
- 쿠키 없이(curl/Python) → 같은 주소인데 **508×552, 12KB**

즉 Python으로 긁으면 조용히 저화질을 받는다. 그래서 **원본 수집은 브라우저 안에서** 하고, 거기서 1,400px로 줄여 로컬로 넘긴다. 세션 쿠키를 파일로 빼내지 않아도 되고, 500MB를 그대로 옮기지도 않는다.

## 절차

1. Chrome에 Claude 확장 연결 + WGSN 로그인 + `www.wgsn.com` 사이트 권한 허용.
2. 저장 검색 URL을 연다. 예: `https://www.wgsn.com/library/results/14de91459be576037a896127a99050f1`
3. 메타데이터 수집 — `history`로 필터를 받아 `query`를 페이지네이션하고, `caption`·`urls`·`size`를 뽑아 JSON 배열로 로컬에 넘긴다.
4. 이미지 수집 — 각 레코드의 `original_` 주소를 **브라우저에서** `fetch(..., {credentials:'include'})`로 받고, `OffscreenCanvas`로 긴 변 1,400px·JPEG 0.86으로 줄여 로컬로 POST.
5. 카드 생성:

```bash
npm run catwalk:library -- <records.json> <images-dir> --season "Spring/Summer 2027" --fresh
```

`--fresh`는 이전 수집물을 지우고 새로 깐다. 같은 룩의 다른 프레임은 지각해시로 합쳐지고(브랜드 안에서만, 해밍 6), 합쳐져서 안 쓰이게 된 파일은 지운다.

## 저장 검색이 시즌을 가두지 않는다

처음 받은 `30dba7bae6937da6c7fee0a2afcbd400`은 **3,253건이었지만 2016~2027년 26개 시즌 전체**였다 — S/S27은 그중 267장뿐. 시즌을 가두려면 필터에 `seasons`가 있어야 한다. `14de91459be576037a896127a99050f1`에는 `"seasons": ["2913181"]`이 들어 있고 **247건**이 나온다. 저장 검색을 받으면 `history`의 `filter.seasons`를 먼저 확인할 것.
