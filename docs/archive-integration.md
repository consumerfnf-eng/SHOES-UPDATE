# SHOES 아카이브 연결과 기존 시트 보호

## 현재 상태

**서버 인증과 네 파일의 편집 권한 연결을 확인했습니다.** 2026-09-28 오전 11:42:50 한국시간에 실제 `--verify-connection` 실행에서 네 파일 모두 `canEdit: true`, `schemaMatches: true`, 최종 `connection-verified`를 반환했습니다. 이 확인은 읽기만 수행했으며 Google Sheets 기록은 0건입니다.

`scripts/archive-expired.mjs`는 기본적으로 **읽기·계획만 수행**합니다. 실제 추가는 `--apply`를 통해 실행합니다. 현재 검증을 통과한 3개월 경과 상품 큐가 비어 있어 실제 상품 추가와 추가 후 시각 검증은 아직 수행하지 않았습니다.

새 스프레드시트나 탭을 만들지 않습니다. 아래의 기존 `시트1`(sheetId `0`)만 대상으로 합니다.

| 파일 | ID | 운영 권한 |
|---|---|---|
| 애슬레저 | `1iqyZhiZhEtKC3HKSI_bRFT_V8nxEy4HyaBTn5TOm644` | 추가 기록 대상 |
| 아웃도어·스포츠 | `1hRSkBD82TnzqusqH79qy-k0kSMGGqx5XbTk5dbnA1-A` | 추가 기록 대상 |
| 럭셔리 | `1VOOVTnp_T8YUqb_O06a_O02VNM3_jEJTLwIXfTEsKx0` | 추가 기록 대상 |
| 국내 브랜드 | `1ie6e9jQAkauBdBssqCH1DuyZHcGLyb2KDTysFdHV3Vc` | 추가 기록 대상 |
| 중국 | `1tA9UpzRober_qfosSOv2hwkrq5d8hAG-jeEn8dY21RQ` | 공개 읽기 전용, 추가 기록 보류 |

중국 파일은 마지막으로 사용자가 전달한 네 개 파일에 포함되지 않았으므로 공개 CSV를 분류 참고용으로만 읽습니다. 이 파일이 목적지인 상품은 검토 목록에 남습니다.

## 서버 인증 설정과 유지 관리

현재 연결은 Google Cloud 프로젝트 `gen-lang-client-0635715571`의 전용 서비스 계정 `shoes-archive@gen-lang-client-0635715571.iam.gserviceaccount.com`을 사용합니다. Google Sheets API와 Google Drive API가 활성화되어 있으며, 위 네 파일에 편집 권한을 부여했습니다. GitHub의 `GOOGLE_SERVICE_ACCOUNT_JSON` 비밀값도 등록했습니다.

등록된 공개 인증서는 **2027-09-28에 만료**됩니다. 만료 전에 인증서를 갱신하고 저장소 비밀값을 교체한 뒤 읽기 전용 연결 확인을 다시 실행해야 합니다. 비공개 키와 복구 사본은 공개 저장소 밖에 보관하며 문서·로그에 포함하지 않습니다.

다른 프로젝트로 이전하거나 인증을 재설정할 때는 다음 절차를 따릅니다.

1. 기존 Google Cloud 프로젝트에서 Google Sheets API를 활성화합니다. 읽기 전용 편집 권한 확인(`--verify-connection`)에는 Google Drive API도 활성화되어 있어야 합니다. Drive 파일 기록·이동 권한은 요청하지 않습니다.
2. 기존 서비스 계정의 이메일(`…@….iam.gserviceaccount.com`)을 확인합니다.
3. 위 네 개 파일에만 해당 서비스 계정을 **편집자**로 공유합니다. 폴더·Drive 전체 접근이나 도메인 위임은 필요하지 않습니다.
4. 저장소의 **Settings → Secrets and variables → Actions**에 `GOOGLE_SERVICE_ACCOUNT_JSON`을 등록합니다. 값은 해당 서비스 계정의 JSON 인증키입니다. 키를 채팅·소스·공개 로그에 붙여넣지 않습니다.
5. 첫 실행은 `node scripts/archive-expired.mjs`로 기록 예정 목록을 확인합니다. 인증 연결 후 최초 `--apply`는 적은 수의 검증 완료 상품으로 실행하고 실제 시트의 해당 행을 확인합니다.

실제 이전 실행의 OAuth 범위는 `https://www.googleapis.com/auth/spreadsheets`입니다. 아래 읽기 전용 연결 확인은 파일의 `capabilities.canEdit`을 확인하기 위해 `https://www.googleapis.com/auth/drive.metadata.readonly`도 요청합니다. API 범위 자체는 접근 가능한 시트 전체를 허용하므로, **서비스 계정에 공유하는 파일을 위 네 개로 제한**합니다. 중국 파일은 코드에서도 쓰기를 차단합니다.

대안으로 승인된 사용자 OAuth의 `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN` 세 비밀값을 사용할 수 있습니다. 기존 서비스 계정을 우선합니다. 브라우저 쿠키·앱 연결 토큰·로컬 계정 저장소를 추출하는 방식은 사용하지 않습니다. Apps Script 웹훅은 배포하지 않았습니다.

기존 시트 보존용 `ARCHIVE_BACKUP_KEY`는 저장소 비밀값에 설정했으며 공개 저장소 밖에 복구용 사본을 보관했습니다. 32바이트 무작위 AES 키의 base64 값입니다. 자동 실행은 `GITHUB_TOKEN`(contents:write), `GITHUB_REPOSITORY`, `GITHUB_SHA`도 사용합니다. 키·토큰이 없거나 암호화 백업을 원격에서 다시 확인하지 못하면 Sheet 기록을 시작하지 않습니다. 키를 교체할 때는 기존 암호화 파일을 복호화할 수 있도록 이전 키를 보존해야 합니다.

## 실행 계약

```sh
# 기본: 실제 기록 없음
node scripts/archive-expired.mjs
# 큐가 비어 있어도 실제 인증·네 파일 편집 권한과 헤더를 읽기만 해서 확인
node scripts/archive-expired.mjs --verify-connection
# 서버 인증이 준비된 이후
node scripts/archive-expired.mjs --apply
# 별도 검토 큐/보고서 경로
node scripts/archive-expired.mjs --queue data/archive-queue.json --report data/archive-report.json
```

- 입력: `data/archive-queue.json`, `{schemaVersion:1, generatedAt, products:[...]}`.
- 제품은 카테고리/MLB·DISCOVERY 적합성/검증 완료 상태, 정확한 출시일과 검증한 원문, 상품 원문 검증, 이미지·링크·국가가 있어야 합니다.
- `releaseDate`가 한국시간 기준 달력상 3개월 경계보다 과거일 때만 이전합니다. 경계 당일은 신상품에 남습니다.
- 기존 원천 데이터와 큐를 삭제하지 않습니다. 다운로드에서 제외한 검증 근거는 새 아카이브 행에 넣지 않습니다.
- 출력: `data/archive-report.json`의 `ready`, `pending`, `skipped`, `appended`.
- 종료 코드: `0`은 검토/완료/처리할 항목 없음, `2`는 인증 설정 차단, `1`은 검증·통신 실패입니다. `0`이어도 `pending`은 미해결일 수 있으므로 확인해야 합니다.
- 검토가 필요한 항목은 `needsReview: true`와 실제 이전 실행의 `status: action-required`로 표시합니다. GitHub 실행 요약에 사유별 수와 상품 ID를 남기고 `archive_status`, `archive_pending`, `archive_attention`을 step output으로 전달합니다. 기존 시트의 원본 셀이나 백업 내용을 공개 로그에 넣지 않습니다.
- 큐가 비어 있으면 네트워크 요청이나 인증 없이 `nothing-to-do`로 끝납니다. 이는 인증 연결 성공을 뜻하지 않습니다.
- `--verify-connection`은 Google Drive 파일 메타데이터와 대상 탭 A1부터 3행까지를 읽어 실제 editor capability·헤더·전체 탭 보호 상태를 확인합니다. 네 파일 모두 확인되어야 `connection-verified`입니다. 파일이나 셀은 기록하지 않으며 암호화 저장소 브랜치도 만들지 않습니다. 기존 사용자 OAuth에 metadata 읽기 범위가 없다면 권한 검증 실패로 표시합니다.

## 분류 기준

1. Ralph Lauren은 애슬레저, 기존 컨템포러리 목록의 나머지는 국내 브랜드 파일로 저장합니다.
2. 그 외에는 최신 시트에서 확인한 기존 브랜드 위치를 먼저 사용합니다.
3. 여러 파일에 있으면 실제 국가·브랜드 그룹·협업 맥락으로 구분합니다. 하나로 결정되지 않으면 검토 대상으로 남깁니다.
4. 기존 위치가 없는 브랜드는 `config/archive-sheets.json`의 검토한 브랜드 분류를 사용합니다. 등록되지 않은 브랜드를 임의로 새 그룹에 넣지 않습니다.
5. `country`는 실제 수집 시장을 보존합니다. 국내 브랜드 파일이라고 `KR`로 바꾸지 않습니다. US/CA/TW 등 실제 국가 코드는 유지합니다.
6. 국가 열이 없는 애슬레저·아웃도어 파일에는 참고 사이트가 지원하는 `브랜드 (US)` 등의 표기를 사용합니다. `GL`은 사이트의 Global 코드입니다.

기존 아카이브의 국가 필터는 실제 데이터에서 국가를 동적으로 모으므로 US/CA/TW 등도 그대로 표시됩니다. Retail Archive에 해당 국가의 읽기 쉬운 라벨과 신규 컨템포러리 브랜드의 화면 분류를 배포했습니다. 저장된 실제 국가를 GL로 바꾸지 않습니다.

## 원본 양식과 셀 보호

- 2026-09-28에 실제 메타데이터와 A1 이후 헤더·샘플 셀을 읽었습니다. 아웃도어·럭셔리에는 다른 탭도 있으며 그대로 보존합니다.
- 기본 A:K는 `season, brand, gender, category, picture, product_name, material, color, image_hex_color, image_url, debug`입니다. 애슬레저 H1은 원래 빈칸이며 H열에 컬러가 있습니다. 헤더를 고치지 않습니다. 별도 Retail Archive의 읽기 코드에서 이 특정 빈 헤더만 `color`로 해석합니다.
- `country`, `release_date`, `상품코드`는 실제 헤더가 존재할 때만 그 위치에 입력합니다. 빈 열에 새로운 헤더를 만들지 않습니다.
- `category`는 기존 사이트의 SHOES 분류에 맞춘 `shoe`입니다. 알 수 없는 gender/material/color는 빈칸으로 둡니다.
- 새 행의 `season`은 **검증한 출시 연월(YYYY-MM)** 입니다. 기존 행의 수집 시즌이나 값은 바꾸지 않습니다.
- 이미지 칸에는 새 행의 J열을 참조하는 `IMAGE` 수식을 넣습니다. 기존 이미지·ARRAYFORMULA·옆 열의 COUNTIF/MATCH 계산은 복사하거나 고치지 않습니다.
- 최소 두 개의 기존 SHOES 행을 비교해 서식과 유효성 검사를 확인합니다. 검증할 수 없는 드롭다운/칩/새 스키마는 실패로 처리합니다.
- 문자열은 `stringValue`로 기록하여 `=`로 시작하는 상품명도 수식으로 실행되지 않습니다.
- `appendCells`에는 새 행의 값과 검증된 native 서식·validation을 함께 전달합니다. 값만 덧붙이는 API나 기존 범위의 `updateCells`, 행 삭제·이동·정렬은 사용하지 않습니다.
- Google 서버가 마지막 데이터 뒤를 결정하므로 다른 사용자가 동시에 추가한 행을 예상 주소로 덮어쓰지 않습니다. 새 행 높이는 현재 시트 기본 높이를 따르며, 기존 행 높이나 열 폭은 변경하지 않습니다. 최초 실제 추가 후 이미지 높이·줄바꿈은 Google Sheets 화면에서 확인해야 합니다.

## 복구·중복 방지

1. 쓰기 직전에 기존 파일을 다시 읽습니다. 45,000셀 이하 범위로 나누어 대상 탭 전체의 값·수식·서식·validation·chip·note와 구조 메타데이터를 확보합니다.
2. 스냅샷을 gzip 압축 후 AES-256-GCM으로 암호화하고 고유 트랜잭션의 `.enc`를 `logs/archive-audit/`에 `wx` 모드로 생성합니다. **암호문을 GitHub의 전용 `archive-audit` 브랜치에 저장하고 원격 SHA와 원문 바이트 일치를 다시 확인한 뒤에만** 다음으로 진행합니다. 백업은 고유 경로이며 덮어쓰지 않습니다. 별도 Google Sheets 백업 파일은 만들지 않습니다.
3. 같은 브랜치의 `state/ledger.enc`에 pending 상태를 암호화해 저장·재조회합니다. 이전에 읽은 SHA를 조건으로 쓰므로 다른 실행과 충돌하면 중단합니다. `data/archive-ledger.json`은 실행 중 로컬 사본일 뿐이며 공개 저장소에 커밋하거나 실행 아티팩트로 올리지 않습니다.
4. 새 product_name 셀 note에 내부 중복 방지 키를 붙입니다. 기존 셀 note는 변경하지 않습니다. 이 note는 CSV 다운로드 항목에 포함되지 않습니다.
5. 추가 후 다시 읽어 새 셀 값·수식·서식·validation을 대조하고 기존 값 있는 셀의 지문이 같은지 확인합니다.
6. 타임아웃이 나도 즉시 재전송하지 않습니다. 새 marker와 셀 내용이 모두 확인되면 완료 처리하고, 확인되지 않으면 uncertain으로 남겨 다음 실행도 재전송하지 않습니다.
7. 사람이 바꾼 기존 값이 감지되면 중단합니다. 자동으로 과거 스냅샷을 복원해 사람의 작업을 덮어쓰지 않습니다.

GitHub Actions의 모든 아카이브 실행은 같은 concurrency 그룹을 사용해야 합니다. 매 실행은 원격 암호화 ledger를 먼저 복호화해 복원합니다. 작업 러너나 메인 브랜치 push가 실패해도 백업과 pending 기록은 전용 브랜치에 남습니다. `.lock`은 같은 작업공간의 동시 실행만 방지합니다. 기존 `archive-audit` 브랜치가 있다면 앱 고유 marker가 일치해야 하며, 다른 용도의 브랜치를 변경하지 않습니다. 1MB가 넘는 암호문은 GitHub의 raw Contents 읽기를 사용하고 25MB 초과는 중단합니다. 공개 GitHub 아티팩트나 메인 브랜치에 평문 원본 스냅샷·ledger·보고서를 올리지 않습니다.

## 검증

`node --test tests/archive.test.mjs tests/archive-store.test.mjs`에서 dry-run 무기록, 기존 메타데이터 보존, 반복 실행 중복 방지, 잘못된 국가/브랜드 보류, 타임아웃 후 조회·재전송 차단, 변경 감지 중단, 실제 국가·빈 성별 유지, 암호문 변조 차단, 다른 브랜치 보호, SHA 충돌 방지, 1MB 초과 재조회, 원격 백업 실패 시 Sheet 무기록, 추가 직후 실행 중단 시 중복 차단을 검사합니다.

실제 서비스 계정 인증·네 파일의 편집 권한·대상 탭 헤더 확인은 완료했습니다(`2026-09-28T02:42:50.844Z`, `writes: 0`). 실제 Google Sheets 추가 실행과 Google 화면의 새 행 시각 검증은 아직 하지 않았습니다. 검증 완료된 이전 대상 상품이 생기면 최초 적은 수의 추가 결과와 기존 셀 보존 결과를 확인해야 실제 상품 이전까지 검증한 것으로 볼 수 있습니다.

## 참고한 문서

- [기존 사이트 설정과 열 매핑](https://consumerfnf-eng.github.io/retail-archive-/js/config.js)
- [기존 사이트 국가·브랜드 처리](https://consumerfnf-eng.github.io/retail-archive-/js/sheet-loader.js)
- [Google Sheets AppendCells 및 요청 정의](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/request#AppendCellsRequest)
- [원자적 batchUpdate와 동시 편집 특성](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate)
- [서비스 계정 OAuth](https://developers.google.com/identity/protocols/oauth2/service-account)
- [Drive 파일 메타데이터와 허용 범위](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get)
- [GitHub Contents API와 raw 읽기](https://docs.github.com/en/rest/repos/contents)
- [GitHub 참조 생성](https://docs.github.com/en/rest/git/refs#create-a-reference)
- Google Drive/Google Sheets skill의 edit workflow, live-read safety, native cell structure, batch recipes, visual quality 지침.
