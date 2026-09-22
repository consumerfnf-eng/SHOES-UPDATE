# PUBLIC 전환 체크리스트

- [ ] 기존 저장소의 `internal/` 폴더 삭제
- [ ] 이 패키지의 파일로 교체 후 Commit + Push
- [ ] GitHub 웹 저장소에서 `internal` 폴더가 없는지 확인
- [ ] 저장소 전체 검색으로 사내용 리서치 자료가 없는지 확인
- [ ] `config/mandatory_brands.json` 필수 브랜드 수 확인
- [ ] Sergio Tacchini가 필수 목록에 없는지 확인
- [ ] Settings → General → Danger Zone → Repository visibility → Public
- [ ] Settings → Pages → Source → GitHub Actions
- [ ] `JINA_API_KEY` Actions Secret 등록
- [ ] Daily Shoes Dashboard Update 수동 1회 실행
- [ ] Deploy GitHub Pages 성공 확인
