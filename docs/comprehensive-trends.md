# 종합 슈즈 트렌드 파이프라인

기존 SHOES 사이트의 키워드 순위, 무신사·KREAM 상품 순위, Instagram 해시태그 게시물 표본, 최근 한 달 뉴스레터·웹진을 수집한다. 실행 결과는 `Comprehensive_Shoe_Trend_Report.xlsx`의 세 시트와 JSON/CSV 파일이다. 실제 확인된 키워드만 최대 100개를 내보낸다. 100개를 채우기 위한 예시·가상 데이터는 추가하지 않는다.

## 실행

Python 3.12 이상, Node.js 22 이상을 사용한다. 저장소 루트의 PowerShell에서:

```powershell
python -m venv .venv-trends
.\.venv-trends\Scripts\python.exe -m pip install -r requirements-trends.txt
.\.venv-trends\Scripts\python.exe -m playwright install chromium
.\.venv-trends\Scripts\python.exe scripts/comprehensive_trends.py --output-dir reports/latest
```

이미 설치된 Edge를 이용할 때는 마지막 명령에 `--browser-channel msedge`를 붙인다. 내부 주소·플랫폼 주소·수집 수·가중치는 `config/comprehensive-trends.json`에서 변경한다. 사내 주소를 사용할 경우 해당 네트워크에서 실행한다. 현재 기본 내부 소스는 공개 SHOES 사이트이며 별도의 사내 DB는 연결하지 않았다.

이미 보관된 원본으로 계산을 재현하려면 `--input-snapshot reports/latest/collection_snapshot.json --output-dir reports/replay`를 사용한다. 원래 관측 시각은 보존되므로 오래된 자료가 새 자료가 되지 않는다.

## 로그인

Playwright는 `SHOE_TRENDS_STORAGE_STATE` 환경변수가 가리키는, 사용자가 준비한 storage-state JSON을 선택적으로 읽는다. Instagram은 `INSTAGRAM_USERNAME`과 `INSTALOADER_SESSION_FILE`에 지정한 사용자 본인의 Instaloader 세션 파일만 읽는다. 파일은 `.secrets/`처럼 Git에서 제외된 경로에 보관한다. 현재 Codex 브라우저의 로그인 쿠키를 자동으로 추출하거나 GitHub로 옮기지 않는다.

Instaloader는 공식 Instagram Graph API가 아닌 별도 수집 도구다. 웹 로그인, Creator 계정, Meta 등록만으로 이 세션 파일이나 태그 수집 권한이 만들어지지 않는다. 로그인 요구·인증 확인·차단·호출 제한이 발생하면 해당 소스를 미확보로 기록하고 다른 소스와 리포트 생성을 계속한다. 헤더와 요청 간 대기는 트래픽을 줄이기 위한 것으로 접근 성공을 보장하지 않는다.

## 함수와 점수

- `collect_internal`: Playwright로 현재 화면의 키워드와 명시된 순위를 읽고 공식 공개 카탈로그를 함께 읽는다.
- `collect_ecommerce`: 명시된 1~50위만 수집한다. 상품 배열의 위치를 순위로 만들지 않는다.
- `collect_instagram`: 사용자가 지정한 세션으로 게시물 표본·본문·좋아요 수를 읽는다. 같은 게시물이 여러 태그에서 나와도 한 번만 센다.
- `collect_newsletters`: 원문의 게시일이 확인되는 최근 달력상 한 달 이내의 풋웨어 기사만 포함한다.
- `prepare_observations` / `calculate_ranking`: pandas로 검증·중복 제거·키워드 매핑·점수 결합을 수행한다.
- `generate_upload_items` / `export_workbook`: 공식 상품과 검토된 사진만 매칭하고 3개 시트를 출력한다.

가중치는 내부 20%, 이커머스 30%, SNS 30%, 뉴스레터 20%다. 내부·이커머스 순위는 `1 / log2(rank + 1)`로 변환한다. SNS는 수집한 고유 게시물 수, 뉴스레터는 매칭 표현의 출현 빈도에 `log(1+x)`를 적용한다. 소스마다 최고값을 100으로 정규화한 뒤 같은 채널 안의 소스를 평균하므로 단순히 수집량이 큰 플랫폼이 전체 비중을 독점하지 않는다. 평균 좋아요는 별도 보조 컬럼이며 전체 게시물량이나 검색량으로 바꾸지 않는다.

모든 설정 소스가 정상 수집됐을 때만 `Total_Trend_Score`를 채운다. 일부 소스가 빠지거나 1~50위 일부만 확보되면 `Ranking_Status`가 잠정 상태가 되고, 확보 채널의 가중치 합으로 나눈 `Provisional_Score`로 정렬한다. `Evidence_Coverage`는 확보된 채널 가중치 합이다. 플랫폼별 수집 완전성은 `Raw_Data`의 `source_status` 행에 별도로 남긴다. 실패한 채널의 점수는 빈칸이고, 정상적으로 확인했지만 해당 키워드가 없는 경우만 0점이다.

이 순위는 수집 표본에 대한 사용자 지정 종합 지표다. Instagram 공식 검색량 순위나 전세계 상품 판매량 순위가 아니다. 내부 순위를 포함하므로 이전 사이트 선정 기준도 20% 반영된다. 이 결과를 다시 내부 순위에 자동 덮어써 반복 증폭시키지 않는다.

## 결과물과 사이트 연결

`Combined_Ranking`은 최대 100개 키워드, 채널 점수, 종합/잠정 점수, 표본 수, 평균 좋아요, 원본 근거 ID를 담는다. `Raw_Data`에는 원문 URL·관측 시각·발행일·포함/제외 이유·수집 상태를 보관한다. 시트 첫 행은 굵은 헤더, 필터, 열 너비 조절, 틀 고정이 적용된다. 계산 결과는 실행 시점의 스냅샷이므로 가중치를 바꿀 때 스크립트를 재실행한다.

`Upload_Format`과 `Upload_Format.csv`는 요청한 7개 컬럼만 사용한다:

`Item_Name, Brand, Price, Trend_Keyword, Image_CDN_URL, Color_Hex, Description`

공식 가격의 통화 표기를 보존하고, 확인되지 않은 가격·HEX는 비워 둔다. SNS 본문에 정확한 품번이 확인되면 해당 한 줄을 설명에 사용한다. 없으면 공식 카탈로그 설명을 쓰며 `upload_items.json`에 설명의 출처를 명시한다. 속성이 인기 키워드와 일치한다는 사실만으로 개별 상품에 SNS 인기 인증을 붙이지 않는다.

같은 모델은 `Upload_Format`에서도 한 행이며 색상별 공식 사진·품번·색상명은 `upload_items.json`의 `variants`에 보관한다. 이 파일과 사이트가 같은 그룹 키 함수를 공유한다. `catalog_import.json`은 기존 게시 파이프라인에 전달할 수 있도록 공식 검증·사진·신상·최초 게시일 근거를 가진 상품 레코드를 보존한다. 7개 표시 컬럼만으로 기존 사이트의 검증 필드를 대체하지 않는다. 이 실행은 리포트/입력 파일을 만들며 운영 카탈로그를 덮어쓰지는 않는다.

일반 구두·슬링백·힐·로퍼는 게시 대상에서 제외한다. 사진은 기존 사이트에서 검토된 옆면 또는 45도 상품 사진만 사용한다. SNS 전신 착장 사진을 대표 사진으로 가져오지 않는다. 원본 레코드의 색상·성별·품번은 보존하며, 같은 모델의 남녀 명칭만 화면 그룹 키에서 정규화한다. LITE-SHOW·GTX·세대·소재가 다른 모델은 별도 카드다.

다음 명령으로 현재 운영 카탈로그와 품번·사진·최초 게시일을 대조한 후 업로드 피드를 만들 수 있다. 먼저 `--apply` 없이 검증하고, 통과한 결과만 적용한다.

```powershell
node scripts/import-trend-report.mjs --input reports/latest/upload_items.json
node scripts/import-trend-report.mjs --input reports/latest/upload_items.json --apply
```

적용 결과는 `public/data/comprehensive-trends.json`이다. 새로 계산된 키워드·순위·점수·잠정 여부·설명 출처와 전체 색상/품번 레코드를 함께 보존한다. 일반 상품 카탈로그와 기존 키워드 순위를 덮어쓰지 않으므로 내부 순위의 반복 가중 문제를 피한다. 공개할 때는 기존 Cloudflare Git 배포를 이용한다. 이 명령은 지정된 로컬 파일만 쓰며 Git push를 자동 실행하지 않는다.

## 검증

```powershell
.\.venv-trends\Scripts\python.exe -m unittest discover -s tests -p 'test_*.py'
npm test
$env:UI_BROWSER_CHANNEL='msedge'
npm run test:ui
npm run build
```

단위 테스트는 명시적으로 만든 테스트 데이터만 사용한다. 실제 결과물에는 테스트 데이터를 넣지 않는다. 보고서와 로그인 파일은 Git에서 제외되며, 공개 사이트에는 배포용 검증 카탈로그와 프런트엔드만 전달한다.
