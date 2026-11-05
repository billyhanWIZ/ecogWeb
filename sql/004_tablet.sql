-- 세척기 태블릿(웹·APK) 연동.
--  eg_tablet      : 장비 ID 하나에 지금 쓰는 태블릿 하나. 등록 코드로 태블릿을 붙이고, 새로 붙이면 이전 태블릿 토큰은 끊긴다.
--  eg_clean_event : 태블릿이 보낸 세척 1건 = 1행. uuid 로 같은 건을 두 번 세지 않는다.
--                   성공 건수는 eg_cleancount(그날 누적값)에도 더해서 구 화면·2.0 집계가 그대로 동작한다.
-- 운영 DB 전용 계정 권한 (root 로 이 파일을 먼저 적용한 뒤):
--   GRANT SELECT, INSERT, UPDATE, DELETE ON smartgym.eg_tablet TO 'ecog'@'localhost';
--   GRANT SELECT, INSERT, UPDATE, DELETE ON smartgym.eg_clean_event TO 'ecog'@'localhost';
--   GRANT SELECT, INSERT, UPDATE ON smartgym.eg_cleancount TO 'ecog'@'localhost';
--   GRANT SELECT, INSERT, UPDATE ON smartgym.eg_deviceinfo TO 'ecog'@'localhost';
CREATE TABLE IF NOT EXISTS eg_tablet (
  deviceid         VARCHAR(50) NOT NULL,
  reg_code         CHAR(8) NULL COMMENT '태블릿 등록 코드 (한 번 쓰면 지움)',
  reg_code_expires DATETIME NULL,
  reg_code_by      INT NULL,
  token_hash       CHAR(64) NULL COMMENT '태블릿 토큰의 sha256',
  activated_at     DATETIME NULL,
  last_seen        DATETIME NULL,
  ble_state        VARCHAR(20) NULL COMMENT 'connected / connecting / disconnected / off',
  ble_changed_at   DATETIME NULL,
  app_kind         VARCHAR(10) NULL COMMENT 'web / apk',
  app_version      VARCHAR(40) NULL,
  user_agent       VARCHAR(200) NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (deviceid),
  UNIQUE KEY uk_tablet_code (reg_code),
  UNIQUE KEY uk_tablet_token (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci COMMENT='세척기 태블릿';

CREATE TABLE IF NOT EXISTS eg_clean_event (
  sn          BIGINT NOT NULL AUTO_INCREMENT,
  deviceid    VARCHAR(50) NOT NULL,
  uuid        CHAR(36) NOT NULL COMMENT '태블릿이 만든 세척 건 ID',
  started_at  DATETIME NULL,
  ended_at    DATETIME NOT NULL,
  cleandate   DATE NOT NULL,
  result      CHAR(1) NOT NULL COMMENT 'S 정상 / T 신호 없이 시간 초과(정상으로 셈) / F 5초 안에 끝남(세지 않음)',
  duration_ms INT NULL,
  counted     TINYINT NOT NULL DEFAULT 0 COMMENT 'eg_cleancount 에 더했으면 1',
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (sn),
  UNIQUE KEY uk_clean_event_uuid (uuid),
  KEY ix_clean_event_dev (deviceid, cleandate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci COMMENT='태블릿 세척 기록';
