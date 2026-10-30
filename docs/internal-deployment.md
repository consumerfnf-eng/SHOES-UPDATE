# 내부 전용 배포 (WGSN CATWALK)

WGSN 캣워크 사진을 사이트에서 보되 공개하지는 않기 위한 배포 경로.

## 왜 `/internal/` 경로가 아니라 별도 프로젝트인가

이 저장소는 **public GitHub repo**다. `public/internal/` 아래에 넣으면 Cloudflare에 무슨 접근 제어를 걸어도 `github.com/consumerfnf-eng/SHOES-UPDATE` 에서 사진이 그대로 받아진다. 사이트를 막는 것과 저장소를 막는 것은 다른 문제다.

그래서 렌더링된 사진과 그 색인은 **git에 들어가지 않는다** (`.gitignore`의 `public/catwalk/`, `public/data/catwalk.json`). 대신 이 PC에서 내부 프로젝트로 직접 업로드한다. 결과적으로 사진이 존재하는 곳은 두 군데뿐이다 — 수집한 PC와 접근 제어가 걸린 배포.

## 페이지 쪽에 분기 코드가 없다

공개 빌드에는 `public/data/catwalk.json`이 없고, CATWALK 탭은 **룩이 없으면 탭 자체가 보이지 않는다** (`renderAnalysis`). 내부 빌드에는 그 파일이 있으니 탭이 나타난다. 같은 코드, 같은 `public/` 폴더, 파일 하나의 유무가 전부다.

| | 공개 `shoes-update.pages.dev` | 내부 `shoes-update-internal.pages.dev` |
|---|---|---|
| 공식 신상 · 리테일 · 뉴스레터 · 데이터 분석 | ○ | ○ |
| WGSN 런웨이 보드 (쇼 목록·수량·링크) | ○ | ○ |
| **CATWALK 탭 (사진 3,648장)** | **탭 자체가 없음** | **○** |
| 로그인 | 없음 | @fnfcorp.com 메일 일회용 코드 |

## 처음 한 번만

```bash
npx wrangler login                                        # 브라우저로 Cloudflare 로그인
npx wrangler pages project create shoes-update-internal --production-branch main
```

그다음 **Cloudflare Access로 잠근다. 이게 이 배포를 "내부"로 만드는 유일한 장치다.**

1. Cloudflare 대시보드 → **Zero Trust** → **Access** → **Applications** → **Add an application** → **Self-hosted**
2. Application domain: `shoes-update-internal.pages.dev` (경로는 비워 전체 보호)
3. Session duration: 24시간 정도
4. **Add a policy**
   - Policy name: `F&F 사내`
   - Action: **Allow**
   - Include → **Emails ending in** → `@fnfcorp.com`
5. Authentication: **One-time PIN** 만 켜도 된다 (메일로 코드 수신 → 입력). SSO가 있으면 그쪽을 쓴다.
6. Save

무료 플랜에서 Zero Trust 사용자 50명까지 포함된다.

## 매번

```bash
npm run catwalk -- "C:\Users\AC0950\Desktop\런웨이추가크롤링"    # 사진 렌더링 (이미 된 건 건너뜀)
npm run internal -- --access-policy-in-place                    # 내부 프로젝트로 업로드
```

`--access-policy-in-place` 플래그가 없으면 배포를 거부한다. 접근 제어가 걸리기 전에 구독 이미지가 올라가는 사고를 막기 위한 장치이고, 위 Access 정책을 실제로 만든 다음에만 붙인다.

프로젝트 이름을 바꾸려면 `INTERNAL_PAGES_PROJECT` 환경변수로 넘긴다.

## 공개 사이트에서 들어가는 길

공개 사이트 헤더의 `Retail Archive ↗` 옆에 내부 주소 링크를 두면 된다. 링크 자체는 공개돼도 무방하다 — 열면 Access가 먼저 묻는다. 필요하면 말해달라, 바로 넣겠다.

## 주의

- 사진을 다시 렌더링해도 파일명은 사진의 SHA-256이라 바뀌지 않는다. 이미 있는 건 건너뛰므로 재배포가 싸다.
- 배포본에는 `public/` 전체가 올라간다. 즉 내부 주소에서도 공개 사이트의 모든 기능이 그대로 동작한다.
- WGSN 자료의 성격과 그 근거는 `config/wgsn-runway.json`의 `licence` 블록, 수집 자동화는 `docs/wgsn-runway-automation.md`.
