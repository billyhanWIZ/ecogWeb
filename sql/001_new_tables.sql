-- ecoG 2.0 신규 테이블
-- 장비가 쓰는 eg_cleancount, eg_deviceinfo 는 건드리지 않는다.
-- deviceid 조인을 위해 기존 테이블과 같은 utf8mb3_general_ci 를 쓴다.

CREATE TABLE IF NOT EXISTS eg_org (
  sn              INT NOT NULL AUTO_INCREMENT,
  parent_sn       INT NULL COMMENT '상위 조직 (NULL = 최상위)',
  org_type        VARCHAR(10) NOT NULL DEFAULT 'SITE' COMMENT 'HQ | BRANCH | SITE',
  name            VARCHAR(100) NOT NULL,
  sido            VARCHAR(20)  NULL COMMENT '시도 (예: 서울특별시). 비어 있으면 상위 조직 값을 물려받음',
  sigungu         VARCHAR(30)  NULL COMMENT '시군구',
  address         VARCHAR(200) NULL,
  lat             DECIMAL(10,7) NULL,
  lng             DECIMAL(10,7) NULL,
  manager_name    VARCHAR(50)  NULL,
  manager_phone   VARCHAR(30)  NULL,
  logo_path       VARCHAR(200) NULL COMMENT '비어 있으면 상위 조직 로고를 물려받음',
  signage_token   VARCHAR(40)  NULL COMMENT '사이니지 공개 화면용 토큰',
  legacy_group_sn INT NULL COMMENT 'eg_managegroup.sn (구 화면 동기화용)',
  sort_order      INT NOT NULL DEFAULT 0,
  use_yn          CHAR(1) NOT NULL DEFAULT 'Y',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (sn),
  INDEX idx_org_parent (parent_sn),
  INDEX idx_org_legacy (legacy_group_sn)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci COMMENT='고객 조직 트리';

CREATE TABLE IF NOT EXISTS eg_device_site (
  sn            INT NOT NULL AUTO_INCREMENT,
  deviceid      VARCHAR(50) NOT NULL,
  site_sn       INT NOT NULL COMMENT 'eg_org.sn',
  display_name  VARCHAR(100) NULL COMMENT '관리자가 붙인 장비 이름',
  installed_on  DATE NOT NULL,
  removed_on    DATE NULL COMMENT 'NULL = 현재 배정. 이 날짜부터는 다른 곳',
  location_note VARCHAR(200) NULL COMMENT '예: 3층 탕비실',
  memo          VARCHAR(500) NULL,
  created_by    INT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (sn),
  INDEX idx_ds_device (deviceid),
  INDEX idx_ds_site (site_sn)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci COMMENT='장비-설치처 배정 이력';

CREATE TABLE IF NOT EXISTS eg_user (
  sn                 INT NOT NULL AUTO_INCREMENT,
  login_id           VARCHAR(50) NOT NULL,
  name               VARCHAR(50) NOT NULL,
  password_hash      VARCHAR(100) NOT NULL,
  role               VARCHAR(10) NOT NULL DEFAULT 'VIEWER' COMMENT 'SYSADMIN | CUSTADMIN | VIEWER',
  org_sn             INT NULL COMMENT '볼 수 있는 조직 (하위 포함). SYSADMIN 은 무시',
  email              VARCHAR(100) NULL,
  active             CHAR(1) NOT NULL DEFAULT 'Y',
  must_change_pw     CHAR(1) NOT NULL DEFAULT 'N',
  fail_count         INT NOT NULL DEFAULT 0,
  locked_until       DATETIME NULL,
  last_login_at      DATETIME NULL,
  legacy_userinfo_sn INT NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (sn),
  UNIQUE INDEX uq_user_login (login_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci COMMENT='사용자';

CREATE TABLE IF NOT EXISTS eg_setting (
  skey        VARCHAR(50) NOT NULL,
  svalue      VARCHAR(200) NOT NULL,
  description VARCHAR(200) NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (skey)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci COMMENT='설정값';

INSERT IGNORE INTO eg_setting (skey, svalue, description) VALUES
 ('co2_per_use_g',   '52',  '세척 1회당 CO2 저감량(g). 일회용 플라스틱컵 1개 LCA, 기후변화행동연구소'),
 ('co2_per_tree_kg', '6.6', '30년생 소나무 1그루 연간 CO2 흡수량(kg), 국립산림과학원'),
 ('offline_seconds', '60',  '이 시간(초) 동안 신호가 없으면 무신호'),
 ('drop_min_avg',    '3',   '최근 14일 하루 평균이 이 값 이상인데 어제 0회면 사용 급감');

CREATE TABLE IF NOT EXISTS eg_report (
  sn         INT NOT NULL AUTO_INCREMENT,
  org_sn     INT NULL,
  scope_desc VARCHAR(200) NULL,
  date_from  DATE NOT NULL,
  date_to    DATE NOT NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (sn)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci COMMENT='리포트 다운로드 이력';

CREATE TABLE IF NOT EXISTS eg_audit_log (
  sn          INT NOT NULL AUTO_INCREMENT,
  user_sn     INT NULL,
  action      VARCHAR(40) NOT NULL,
  target_type VARCHAR(20) NULL,
  target_id   VARCHAR(60) NULL,
  detail      TEXT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (sn),
  INDEX idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci COMMENT='변경 이력';
