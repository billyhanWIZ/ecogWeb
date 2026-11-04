-- 테스트용 장비. 여기 있는 장비는 대시보드·통계·리포트·사이니지·장비 목록에서 빠지고
-- '테스트 장비' 화면(시스템 관리자·본사 관리자)에서만 보인다. 장비 테이블은 그대로 둔다.
-- 운영 DB 전용 계정 권한:
--   GRANT SELECT, INSERT, UPDATE, DELETE ON smartgym.eg_device_test TO 'ecog'@'localhost';
CREATE TABLE IF NOT EXISTS eg_device_test (
  deviceid  VARCHAR(50) NOT NULL,
  marked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  marked_by INT NULL,
  note      VARCHAR(200) NULL,
  PRIMARY KEY (deviceid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci COMMENT='테스트용 장비';
