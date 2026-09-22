# Deploy Checklist

- [ ] GitHub repo 생성
- [ ] 이 ZIP의 전체 내용을 repo 루트에 업로드
- [ ] `JINA_API_KEY` Actions Secret 등록
- [ ] GitHub Pages Source = GitHub Actions
- [ ] 저장소가 Public이면 `internal/`의 WGSN 원본이 노출될 수 있음 → WGSN 보호가 필요하면 repo를 Private로 유지하거나 internal을 별도 Private repo로 분리
- [ ] Actions에서 `Daily Shoes Dashboard Update` 수동 1회 실행
- [ ] `public/index.html`에 WGSN 버튼/모달이 없는지 확인
- [ ] `internal/dashboard.html`에는 WGSN 모듈이 유지되는지 확인
- [ ] coverage 로그에서 mandatory 116/116 attempted 확인
