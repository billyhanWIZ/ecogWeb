-- 목록에서 숨긴 장비. eg_deviceinfo 는 그대로 두고 새 시스템 화면에서만 뺀다.
-- 운영 DB 전용 계정에는 적용 후 권한을 줘야 한다:
--   GRANT SELECT, INSERT, UPDATE, DELETE ON smartgym.eg_device_hidden TO 'ecog'@'localhost';
CREATE TABLE IF NOT EXISTS eg_device_hidden (
  deviceid  VARCHAR(50) NOT NULL,
  hidden_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  hidden_by INT NULL,
  reason    VARCHAR(200) NULL,
  PRIMARY KEY (deviceid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci COMMENT='목록에서 숨긴 장비';
