# Shoes Dashboard 운영

공개 사이트: https://shoes-update.pages.dev/

## 매일 자동 수집

`Daily Shoes Dashboard Update`가 매일 08:00 KST에 예약 실행됩니다. GitHub 스케줄러에 따라 시작이 지연될 수 있습니다. Actions의 **Run workflow**로도 실행할 수 있습니다.

1. `npm ci`로 잠금 파일에 고정된 Playwright를 설치합니다.
2. 대시보드를 로컬 서버로 열되 상품 이미지·화면 렌더링은 수집 작업에서 생략합니다.
3. `config/daily_sources.json`의 공식 출처를 Node에서 요청합니다. Jina 호출 간격을 제한하고 429는 재시도합니다. 브랜드 작업은 최대 3개씩 진행하며 필수 브랜드의 출처가 모두 실패하면 최대 3회 확인합니다.
4. 116개 필수 브랜드의 요청 여부와 수집 결과를 검사합니다. 한 브랜드의 차단은 진단 기록에 남기고 기존 상품을 보존합니다. 모든 필수 출처가 실패하거나 필수 브랜드가 누락되면 전체 실행을 실패시키고 게시하지 않습니다.
5. 새 결과를 기존 내장 데이터에 중복 없이 추가합니다. 기존 화면 필터로 숨겨진 상품도 원본에서 삭제하지 않습니다. 캐시 키를 갱신하고 빌드 검증을 통과한 결과만 main에 커밋합니다.
6. Cloudflare의 기존 Git 연결이 main 변경을 자동 배포합니다. 공개 `deployment.json`으로 배포된 커밋을 확인할 수 있습니다.

`JINA_API_KEY`는 선택 사항입니다. GitHub Actions secret에 유효한 키가 있으면 Reader/Search에 사용합니다. 키가 없거나 인증·할당량 오류가 발생하면 익명 Reader로 계속하며 인증이 필요한 Search는 생략합니다. 키는 브라우저 저장소나 공개 파일에 쓰지 않습니다. 출처 차단이나 응답 성공만으로 ‘모든 신상품 수집 완료’를 선언하지 않습니다.

확인 위치:
- GitHub Actions 실행 로그와 Summary: 필수 브랜드 시도 수, 응답 수, 실패 브랜드
- `daily-diagnostics-<run id>` artifact: 브랜드별 오류·재시도 기록(14일 보관)
- `public/data/last_update.json`: 마지막으로 게시된 점검 결과
- `public/catalog-coverage.html`: 2026-09-23 수동 수집 범위 기록(일일 점검과 별도)

## Cloudflare Pages 설정

- Repository: `consumerfnf-eng/SHOES-UPDATE`
- Production branch: `main`
- Automatic production branch deployments: **Enabled**
- Build watch paths: Include **`*`**, Exclude **빈 값**
- Build command: **`npm run build`**
- Build output directory: **`public`**
- Root directory: 저장소 루트

기존 빈 Include paths는 변경 경로와 일치하지 않아 push 배포를 건너뛰었습니다. `exit 0` 자체는 정적 HTML의 유효한 빌드 명령이지만, 현재는 JavaScript·상품 데이터 검사 및 배포 커밋 파일 생성을 위해 `npm run build`를 사용합니다. `public` 외에 수집 원본·로그·내부 자료를 배포하지 않습니다.

이 사이트는 Cloudflare Pages를 사용합니다. 비활성 GitHub Pages를 대상으로 실패하던 워크플로우는 `Validate Shoes Dashboard`로 교체했습니다.

## 2026-09-23 장애 수정 근거

- Actions run `35804430727`: package-lock 부재로 setup-node npm cache 실패. 잠금 파일을 추가하고 `npm ci`로 고정했습니다.
- Actions run `35810427940`: localStorage quota 초과로 초기화 중단 → 서버 실행 함수 대기 timeout. 용량 초과 시 메모리 저장, 수집 전용 실행 경로 및 대량 데이터 회귀 테스트로 보완했습니다.
- 위 실패 뒤 `if: always()`로 없는 runtime_state를 저장·검증하려던 연쇄 실패를 제거했습니다. 실패 시에는 진단 단계만 실행됩니다.
- 실제 상품 추출에서 누락된 `hash`와 `firstSeenFor` 함수도 복구했습니다. 출처 응답만 받는 테스트에 더해 상품명·SKU·이미지를 실제 레코드로 변환하는 회귀 테스트를 추가했습니다. ReferenceError/TypeError/SyntaxError는 출처 차단으로 숨기지 않고 실행을 중단시킵니다.
- 일일 신규 수집은 스니커즈·운동화 상품 링크만 받습니다. 이미지 CDN/파일, Nike `/w/` 카테고리, 일반 메뉴 및 샌들·힐 등은 제외하며, 실제 오분류 사례와 정상 운동화 사례를 함께 회귀 테스트합니다. 기존 내장 원본은 유지합니다.
- Cloudflare Build watch paths Include가 빈 값이어서 최근 push들이 skipped였습니다. `*`로 복구했습니다.

## 개발 확인

```sh
npm ci
npx playwright install --with-deps chromium
npm test
python -m unittest discover -s tests -p 'test_*.py'
npm run build
npm run daily
python scripts/validate_coverage.py
python scripts/patch_snapshot.py
```

Windows에서 설치된 Edge로 테스트하려면 `PLAYWRIGHT_CHANNEL=msedge`를 지정할 수 있습니다. 로컬 `npm run daily`는 수집 결과만 만들며, 직접 push하지 않습니다.
