# 기본 배포: shoes-update-internal.pages.dev

공식 신상품·리테일·뉴스레터·분석·CATWALK의 운영 주소는 https://shoes-update-internal.pages.dev/ 이다. 기존 https://shoes-update.pages.dev/ 요청은 경로와 검색 조건을 유지해 내부 주소로 이동한다.

## 전체 자료 배포

```powershell
npm run build
npm test
npm run deploy
```

`deploy`와 `internal`은 모두 `scripts/deploy-internal.mjs`를 실행하며, `shoes-update-internal` 프로젝트의 `main`에 `public/` 전체와 Pages Functions를 올린다. 기존 `INTERNAL_SITE_PASSWORD` 시크릿은 유지한다. 공유 비밀번호를 코드·로그·Git에 넣지 않는다. 비밀번호가 없는 내부 도메인은 미들웨어에서 503으로 차단한다. 인증 없이 상품 JSON·사진·CATWALK를 요청해도 401이 나와야 한다.

CATWALK 색인 `public/data/catwalk.json`과 `public/catwalk/`는 gitignored 자료다. 배포 전에 수집 PC의 최신 파일이 있는지 확인한다. 배포 스크립트는 색인·사진·기존 비밀번호 시크릿이 없으면 업로드를 중단한다. 저장소가 공개이므로 CATWALK 자료는 커밋하지 않는다.

## 배포 후 확인

1. Wrangler 배포 성공 및 production deployment의 커밋을 확인한다.
2. 로그인된 브라우저에서 `/deployment.json`의 커밋, 상품 목록, 컬러칩, 사진과 CATWALK를 확인한다.
3. 로그아웃 요청의 상품 JSON·이미지·CATWALK가 401인지 확인한다.
4. 이전 공개 주소가 내부 주소로 이동하는지 확인한다.

## 수집 자동화와 배포 자동화의 차이

현재 내부 프로젝트는 Cloudflare Direct Upload 방식이다. GitHub 수집 워크플로의 커밋·푸시만으로 내부 배포가 바뀌지는 않는다. 기본 업로드는 위 `npm run deploy` 명령이다. CI에서 내부 배포까지 자동화하려면 프로젝트 범위 배포 자격 증명과 비공개 CATWALK 보존 경로를 별도로 구성해야 한다. 개인 OAuth 토큰이나 CATWALK 자료를 공개 저장소에 넣어 해결하지 않는다.

프로젝트 변경은 `INTERNAL_PAGES_PROJECT` 환경변수로 지정한다. 비밀번호 변경이 필요한 경우에만 사용자가 `npm run internal:set-password`를 실행한다.
