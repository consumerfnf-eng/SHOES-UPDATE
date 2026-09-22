# MLB Shoes Dashboard — 공개/사내용 분리 배포

이 패키지는 같은 자동 업데이트 데이터를 사용하면서 **공개 사이트**와 **사내용 WGSN 포함 버전**을 분리합니다.

## 폴더 구조

```text
internal/dashboard.html   # 사내용 원본: WGSN 모듈 포함
public/index.html          # 공개 사이트: WGSN DOM/이미지/내부 매칭 데이터 제거
config/mandatory_brands.json
scripts/run_daily_update.mjs
scripts/patch_snapshot.py
scripts/build_public.py
scripts/validate_coverage.py
.github/workflows/daily-update.yml
.github/workflows/pages.yml
```

## 매일 자동 업데이트

GitHub Actions가 매일 **08:00 KST**에 실행됩니다.

1. `internal/dashboard.html`에서 브랜드/상품/키워드 업데이트 실행
2. 럭셔리·스포츠·캐주얼 전체 소스 점검
3. 사용자 지정 필수 브랜드 **116개**를 모두 점검했는지 coverage QA
4. 신규 데이터와 Shoes Trend Keywords를 `internal/dashboard.html`에 저장
5. `scripts/build_public.py`가 동일한 최신 데이터로 `public/index.html` 생성
6. 공개 빌드에서는 WGSN 버튼·모달·내부 WGSN 매칭/설명 데이터를 제거
7. GitHub Pages는 `public/` 폴더만 배포

**Sergio Tacchini는 일일 모니터링 및 필수 브랜드 목록에서 제외되어 있습니다.**

## WGSN 보호 방식

공개 사이트에는 다음이 포함되지 않습니다.

- WGSN 런치 버튼
- WGSN 모달
- WGSN 리서치 이미지
- WGSN 내부 트렌드별 제품 매칭 목록
- WGSN 내부 설명/매칭 사유
- 상품별 WGSN 내부 태그(`wgsnTrends`)

사내용 버전은 `internal/dashboard.html`에 그대로 유지됩니다.

> 중요: GitHub 저장소 자체가 **Public**이면 `internal/dashboard.html` 원본 소스는 저장소에서 볼 수 있습니다. WGSN 자료를 외부에 노출하면 안 되는 경우 저장소를 **Private**로 두세요. GitHub 플랜상 Private repo의 Pages 공개 배포가 불가능하면, 공개 사이트용 repo에는 `public/` 산출물만 두고 `internal/`은 별도 Private repo에 보관하는 2-repo 구성을 사용하세요.

## GitHub 설정

### 1. Repository Secrets

`Settings → Secrets and variables → Actions`에서 다음을 등록합니다.

```text
JINA_API_KEY
```

### 2. Pages

`Settings → Pages → Source`를 **GitHub Actions**로 설정합니다.

### 3. 수동 업데이트

`Actions → Daily Shoes Dashboard Update → Run workflow`

을 누르면 즉시 전체 업데이트가 실행됩니다.

## 필수 브랜드 QA

`config/mandatory_brands.json`에는 사용자 지정 **116개 브랜드**가 들어 있습니다. 매일 각 브랜드를 반드시 시도하고, 필수 브랜드가 아예 시도되지 않은 경우 workflow를 실패 처리합니다. 소스 일시 장애는 로그에 남기되 마지막 정상 데이터를 지우지 않습니다.

## 로컬 확인

사내용:

```text
internal/dashboard.html
```

공개용:

```text
public/index.html
```

공개 빌드를 다시 만들려면:

```bash
python scripts/build_public.py
```
