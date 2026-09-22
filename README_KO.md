# MLB Shoes Dashboard — PUBLIC ONLY

이 저장소는 공개 웹사이트 전용입니다.

## 포함
- `public/index.html`: 공개 Dashboard
- LUXURY / SPORTS / CASUAL 필터
- Shoes Trend Keywords
- 지정 필수 브랜드 일일 점검
- 매일 08:00 KST 자동 업데이트
- GitHub Pages 자동 배포

## 포함하지 않음
- 사내용 리서치 모듈
- 사내용 리서치 이미지/스크린샷
- 사내용 제품 매칭 데이터
- `internal/` 폴더

## 최초 설정
1. Settings → Secrets and variables → Actions → `JINA_API_KEY` 등록
2. 저장소의 기존 `internal/` 폴더가 완전히 삭제됐는지 확인
3. 저장소 전체 검색에서 사내용 리서치 자료가 남아 있지 않은지 확인
4. 저장소를 Public으로 전환
5. Settings → Pages → Source: GitHub Actions
6. Actions → Daily Shoes Dashboard Update → Run workflow
7. Actions → Deploy GitHub Pages → 성공 여부 확인

## 자동 업데이트
`.github/workflows/daily-update.yml`이 매일 08:00 KST에 실행됩니다.
필수 브랜드는 `config/mandatory_brands.json`에 있으며 Sergio Tacchini는 제외되어 있습니다.
