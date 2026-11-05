# ecoG 2.0 개발 규칙

텀블러 세척기 모니터링 웹. README.md 에 구조·배포가 있다. 사용자는 한국어로 소통한다.

## 절대 지킬 것
- 장비 연동은 손대지 않는다. `eg_cleancount`, `eg_deviceinfo` 의 구조를 바꾸지 않는다. 기존 .do API·Unity 태블릿은 그대로 둔다.
  행을 쓰는 곳은 아래뿐이다.
  - 배정·이설 시 `eg_deviceinfo.mangegroup` 동기화 (src/routes/devices.js `syncLegacyGroup`)
  - 새 장비 추가 시 `eg_deviceinfo` 행 추가 (devices.js `/devices/new`)
  - 새 태블릿 API (src/routes/tablet.js, src/lib/tablet.js): `eg_deviceinfo.lastsignaldt` 갱신, 세척 성공 건을 `eg_cleancount` 그날 누적값에 더함.
    `eg_clean_event` 의 uuid 로 중복을 막고, 장비 단위 GET_LOCK 안에서 (장비, 날짜) 행을 모두 MAX+n 으로 맞춘다(없으면 1행 추가).
- 구 테이블(`eg_managegroup`, `eg_userinfo`)과 restapi(Tomcat) 코드는 읽기 전용. 구 화면이 계속 쓴다.
- 새 테이블은 `utf8mb3_general_ci` (deviceid 조인 때문). DB 변경은 `sql/NNN_*.sql` 새 파일로만, 적용된 파일은 수정 금지.
- 운영 DB 버전을 모르므로 CTE·윈도 함수·JSON 컬럼을 쓰지 않는다. 조직 트리 계산은 JS(src/lib/orgs.js).
- 사용량 집계는 반드시 `(deviceid, cleandate)` 별 MAX(cleancount) 후 합산 (src/lib/usage.js). 그날 누적값이고 중복 행이 있을 수 있다.
- 조회 범위는 세션 사용자에서만 정한다. 요청 파라미터의 조직은 `scopedSubtree` 로 범위 확인 후 쓴다.
- 화면은 빌드 없는 ES 모듈. 인라인 스크립트 금지(CSP). 외부 라이브러리는 public/vendor 에 둔다.
- 비밀값은 .env 에만. 커밋하지 않는다.
- 새 테이블을 만들면 README·.env.example 의 GRANT 목록에도 추가한다 (운영은 테이블 단위 권한).
- 디자인: eco.G 로고 색(숲 초록 #134226/#1F7A45, 새잎 연두 #88BC50). 로고·사진은 public/img. 모바일(860px 이하)은 위쪽 막대 + 펼치는 메뉴.

## 세척기 태블릿
- 화면은 `/t` (public/tablet.html, public/js/tablet/). 웹(크롬 Web Bluetooth)과 안드로이드 앱(android/, WebView + 네이티브 BLE)이 같은 화면을 쓴다.
- 신호: N 대기(1초마다), A 시작, S 정상(+1), F 5초 안에 끝남(세지 않음). A 뒤 7.5초 안에 S/F 가 없으면 +1(T). Unity 앱과 같은 규칙.
- 앱은 가장 가까운(RSSI 가 가장 센) `ECOG` 에 터치 없이 붙고 주소를 기억한다. 송신부(ESP32) 펌웨어는 바꾸지 않는다.
- 태블릿 인증은 등록 코드(8자리, 24시간) → 토큰(sha256 만 저장). 같은 장비 ID 로 새 태블릿을 등록하면 이전 토큰은 끊긴다.
- 시연: `/t?sim=1` (키보드 A/S/F). APK 는 GitHub Actions(.github/workflows/android.yml)가 만들어 릴리스 apk-latest 에 올린다.

## 확인 방법
- `node dev/seed-legacy.js && npm run migrate && node scripts/migrate-legacy.js --admin-pw admin1234` 로 로컬 데이터 준비
- 계정: admin/admin1234(시스템), ecog/ecog1234(고객 관리자), gyeongnam/gn1234(경상남도), changwon/cw1234(창원시) 조회자
- 화면을 바꾸면 Playwright 로 스크린샷을 찍어 확인한다.
