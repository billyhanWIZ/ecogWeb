# eco.G 2.0 — 텀블러 세척기 모니터링

텀블러 세척기 사용량과 탄소 저감 효과를 고객사·지역·설치처·세척기별로 보여주는 웹 서비스입니다.
대시보드, 통계(엑셀), 장비 관리(배정·이설·철거·숨김), 조직·사용자 관리, PDF ESG 리포트, 로비용 사이니지 화면이 있습니다.
운영 주소는 https://ecog.jnwiz.com 이고, 구 화면(restapi.jnwiz.com/ecoG)은 그대로 둡니다.

## 구조

```
세척기 ──(.do API, 변경 없음)──▶ restapi.jnwiz.com (Tomcat) ──▶ MariaDB
                                                                   ▲
브라우저 ──HTTPS──▶ nginx ──▶ ecoG 2.0 (Node.js, /opt/ecog, pm2) ──┘
```

- 장비(Unity 태블릿)가 쓰는 `eg_cleancount`, `eg_deviceinfo` 는 구조를 바꾸지 않습니다.
  2.0 이 쓰는 곳: 배정·이설 때 `eg_deviceinfo.mangegroup` 동기화, 새 장비 추가, 새 태블릿(아래)의 신호와 세척 기록.
- 사용자·조직·장비 배정은 새 테이블(`sql/001_new_tables.sql`)에 둡니다.
- 같은 장비·같은 날짜 행이 여러 개면 MAX 하나만 셉니다(cleancount 는 그날 누적값).
- 통계는 세척일 당시 배정된 설치처 기준입니다. 이설해도 과거 사용량은 이전 설치처에 남습니다.

```
server.js            Express 진입점
src/lib/             인증, 조직 트리, 통계 집계(stats.js), 설정
src/lib/report.js    PDF 리포트 (HTML + SVG 차트 → Chromium)
src/routes/          /api/* (auth, dashboard, stats, devices, orgs, users, settings, reports, signage, tablet)
public/              화면 (빌드 없는 HTML + ES 모듈, ECharts)
sql/                 번호 붙은 DB 변경 파일 (배포 때 자동 적용)
scripts/             db-migrate.js, migrate-legacy.js (구 데이터 이관)
deploy/              setup.sh(최초 1회), deploy.sh(평소), pm2 설정
dev/                 로컬 개발용 구 테이블 재현 + 가짜 데이터
docs/legacy/         운영 서버의 IpzSQL.xml (참고용)
android/             세척기 태블릿 안드로이드 앱 (WebView + BLE). 빌드는 GitHub Actions
```

## 로컬 개발

```bash
npm install
# 로컬 MariaDB 에 smartgym DB 와 ecog/ecogpw 계정이 있다고 가정 (.env 없으면 개발 기본값)
node dev/seed-legacy.js            # 구 테이블 + 가짜 데이터
npm run migrate                    # 새 테이블
node scripts/migrate-legacy.js --admin-pw admin1234
npm run dev                        # http://127.0.0.1:3100
```

## 서버 최초 설치

```bash
sudo git clone https://github.com/billyhanWIZ/ecogWeb /opt/ecog
cd /opt/ecog
sudo bash deploy/setup.sh ecog.jnwiz.com <이메일> --check   # 점검만
sudo bash deploy/setup.sh ecog.jnwiz.com <이메일>           # .env 를 만들고 멈춤 → DB 정보 채우기
# 전용 DB 계정(ecog)에 테이블 단위 권한을 주려면 테이블이 먼저 있어야 한다. DB 관리자 계정으로:
mariadb -u root -p smartgym < sql/001_new_tables.sql
mariadb -u root -p smartgym -e "CREATE TABLE IF NOT EXISTS eg_schema_migrations (filename VARCHAR(100) NOT NULL PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci"
# → 그다음 .env.example 주석의 GRANT 문 실행
sudo bash deploy/setup.sh ecog.jnwiz.com <이메일>           # 다시 실행하면 설치 완료
node scripts/migrate-legacy.js --dry-run                    # 이관 미리보기
node scripts/migrate-legacy.js --admin-id admin --admin-pw '<초기 비밀번호>'
```

## 평소 배포

```bash
# 개발 PC
git push
# 서버
cd /opt/ecog && bash deploy/deploy.sh          # pull → npm ci → DB 변경 적용 → 무중단 재시작 → 태그
bash deploy/deploy.sh --rollback               # 직전 배포로 되돌리기
```

DB 를 바꿀 때는 `sql/003_무엇.sql` 처럼 번호를 붙여 새 파일을 추가합니다. 이미 적용한 파일은 고치지 않습니다.
새 테이블을 만들면 전용 계정(ecog)에 그 테이블 권한(GRANT)도 줘야 합니다.

## 세척기 태블릿 (새 프로그램)

기존 Unity 태블릿은 그대로 둡니다. 새 태블릿은 웹 화면 `https://ecog.jnwiz.com/t` 를 씁니다.

```
세척 신호 송신부(ESP32 'ECOG', 변경 없음) ──BLE──▶ 태블릿 ──HTTPS /api/tablet/*──▶ ecoG 2.0 ──▶ MariaDB
                                                  ├ 안드로이드 앱(APK): 가까운 세척기에 터치 없이 연결, 켜지면 자동 실행
                                                  └ 크롬 웹: 페이지를 열 때마다 한 번 터치해서 세척기를 골라야 함
```

- **등록**: 장비 화면 › '새 장비 추가' → 장비 ID 와 8자리 등록 코드(24시간)가 나옵니다. 태블릿에서 코드를 넣으면 끝.
- **태블릿 교체**: 기존 장비 상세 › '태블릿 바꾸기' → 새 코드를 새 태블릿에 넣으면 같은 장비 ID 로 세척 기록이 이어집니다. 기존 Unity 태블릿은 꼭 끄세요(같은 ID 로 두 대가 올리면 숫자가 섞임).
- **세척 규칙**(Unity 와 같음): A 시작 → S 면 +1, F 면 세지 않음, A 뒤 7.5초 안에 S/F 가 없으면 +1. 세척 1건씩 `eg_clean_event` 에 남기고(uuid 로 중복 방지) 성공 건은 `eg_cleancount` 그날 누적값에 더합니다.
- **인터넷이 끊겨도** 세척 기록은 태블릿에 쌓였다가 다시 연결되면 보냅니다. 화면은 서비스 워커로 저장돼 오프라인에서도 뜹니다.
- **상태**: 10초마다 신호(`eg_deviceinfo.lastsignaldt`, 구 화면과 같은 의미)와 세척기 블루투스 연결 상태를 보냅니다. 장비 목록에 '세척기 연결 끊김'이 표시됩니다.
- **설정**: 태블릿 화면 왼쪽 위 로고를 빠르게 5번 누르면 열립니다(다시 연결, 가장 가까운 세척기 다시 찾기, 등록 해제).
- **시연**: `/t?sim=1` 로 열면 키보드 A/S/F 로 세척 신호를 흉내 냅니다.
- **APK**: `android/` 가 바뀌어 main 에 올라가면 GitHub Actions 가 빌드해 https://github.com/billyhanWIZ/ecogWeb/releases/download/apk-latest/ecog-tablet.apk 에 올립니다. 서명 키는 저장소 Secrets(`ECOG_KEYSTORE_B64`, `ECOG_KEYSTORE_PASSWORD`)에만 둡니다. 안드로이드 6.0 이상.
- **태블릿 설치**: APK 설치 → 권한(근처 기기·블루투스, 11 이하는 위치) 허용 → '다른 앱 위에 표시' 허용(재부팅 자동 실행) → 홈 버튼을 눌러 'eco.G 세척기'를 '항상' 홈 앱으로 고르면 키오스크처럼 씁니다.

## 기능 메모

- **장비 숨김**: 시험용·폐기 장비는 목록에서 숨깁니다(`eg_device_hidden`). 장비 테이블은 그대로이고, 숨김 탭에서 되살리거나 설치처에 배정하면 다시 보입니다. 숨긴 뒤 신호가 다시 들어오면 표시됩니다.
- **테스트 장비**: 장비 상세에서 '테스트로 지정'하면(`eg_device_test`) 대시보드·통계·리포트·사이니지·장비 목록·조직 대수에서 빠집니다. 시스템 관리자와 본사(최상위 조직) 고객 관리자에게만 '테스트 장비' 메뉴가 보이고, 거기서 테스트 장비만 따로 봅니다. 장비 데이터는 그대로 쌓입니다.
- **PDF 리포트**: 리포트 메뉴에서 대상·기간을 골라 미리보기·다운로드. 서버에 Chromium(`npx playwright-core install --with-deps chromium`)과 한글 폰트(`fonts-noto-cjk`)가 필요합니다.
- **사이니지**: 조직 화면에서 링크를 만들면 `https://ecog.jnwiz.com/s/<토큰>` 이 로그인 없이 열립니다(합계 숫자만). 새 링크로 바꾸면 이전 링크는 끊깁니다.
- **시계·날씨**: `.env` 에 `KMA_APIHUB_KEY`(기상청 API허브 인증키) 또는 `KMA_SERVICE_KEY`(공공데이터포털 일반 인증키)를 넣으면 대시보드·사이니지 시계 아래에 현재 기온·하늘 상태가 나옵니다. 위치는 조직 화면의 '날씨 위치'(시군구 이름이나 위도, 경도 → `eg_org.lat/lng`), 비어 있으면 조직의 시군구·시도 중심(위로 올라가며 찾음)이고, 대시보드는 로그인한 사용자의 최상위 조직 기준입니다. 같은 격자는 10분에 한 번만 조회합니다. 키가 없거나 조회에 실패하면 날씨 칸만 숨깁니다. 키 확인: `node scripts/weather-check.js 진주시`. 시군구 중심 좌표(`src/data/regions-center.json`)는 southkorea-maps(통계청 2013 경계)에서 계산했습니다.

## 권한

| 역할 | 볼 수 있는 범위 | 할 수 있는 일 |
| --- | --- | --- |
| 시스템 관리자 | 전체 + 미배정 장비 | 장비 배정·이설·철거·숨김, 조직·사용자·설정 |
| 고객 관리자 | 자기 조직 이하 | 조회, 하위 조직·사용자 관리, 장비 이름·위치 수정, 로고, 사이니지 링크 |
| 조회자 | 자기 조직 이하 | 조회, 엑셀, PDF 리포트 |

본사(최상위 조직)의 고객 관리자는 미배정 장비도 보고, 장비를 자기 조직 아래 설치처에 배정·이설·철거하거나 숨길 수 있습니다(시스템 관리자와 같은 장비 메뉴). 다른 최상위 조직에 배정된 장비는 건드릴 수 없습니다.

구 계정은 LEVEL 0 → 최상위 조직의 고객 관리자, LEVEL 1·2 → 해당 그룹의 조회자로 이관됩니다(비밀번호는 같고 해시로 저장).

## 환산계수

| 지표 | 기본값 | 출처 |
| --- | --- | --- |
| 세척 1회당 탄소 저감 | 52g CO2 | 일회용 플라스틱컵(300mL) 1개 LCA, 기후변화행동연구소 (종이컵 기준이면 28g) |
| 소나무 1그루 연간 흡수 | 6.6kg CO2 | 30년생 소나무, 국립산림과학원 |

설정 화면에서 바꿀 수 있습니다. 지도 데이터는 southkorea/southkorea-maps(KOSTAT 2013) 간소화본입니다.
