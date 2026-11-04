# ecoG 2.0 개발 규칙

텀블러 세척기 모니터링 웹. README.md 에 구조·배포가 있다. 사용자는 한국어로 소통한다.

## 절대 지킬 것
- 장비 연동은 손대지 않는다. `eg_cleancount`, `eg_deviceinfo` 의 구조를 바꾸거나 행을 쓰지 않는다.
  유일한 예외: 배정·이설 시 `eg_deviceinfo.mangegroup` 동기화 (src/routes/devices.js `syncLegacyGroup`).
- 구 테이블(`eg_managegroup`, `eg_userinfo`)과 restapi(Tomcat) 코드는 읽기 전용. 구 화면이 계속 쓴다.
- 새 테이블은 `utf8mb3_general_ci` (deviceid 조인 때문). DB 변경은 `sql/NNN_*.sql` 새 파일로만, 적용된 파일은 수정 금지.
- 운영 DB 버전을 모르므로 CTE·윈도 함수·JSON 컬럼을 쓰지 않는다. 조직 트리 계산은 JS(src/lib/orgs.js).
- 사용량 집계는 반드시 `(deviceid, cleandate)` 별 MAX(cleancount) 후 합산 (src/lib/usage.js). 그날 누적값이고 중복 행이 있을 수 있다.
- 조회 범위는 세션 사용자에서만 정한다. 요청 파라미터의 조직은 `scopedSubtree` 로 범위 확인 후 쓴다.
- 화면은 빌드 없는 ES 모듈. 인라인 스크립트 금지(CSP). 외부 라이브러리는 public/vendor 에 둔다.
- 비밀값은 .env 에만. 커밋하지 않는다.

## 확인 방법
- `node dev/seed-legacy.js && npm run migrate && node scripts/migrate-legacy.js --admin-pw admin1234` 로 로컬 데이터 준비
- 계정: admin/admin1234(시스템), ecog/ecog1234(고객 관리자), gyeongnam/gn1234(경상남도), changwon/cw1234(창원시) 조회자
- 화면을 바꾸면 Playwright 로 스크린샷을 찍어 확인한다.
