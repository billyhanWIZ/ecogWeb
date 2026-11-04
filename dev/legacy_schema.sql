-- 운영 DB 에 이미 있는 구 테이블 (로컬 개발용 재현). 운영에서는 실행하지 않는다.
CREATE TABLE IF NOT EXISTS `eg_cleancount` (
  `sn` INT(20) NOT NULL AUTO_INCREMENT,
  `deviceid` VARCHAR(50) NOT NULL COLLATE 'utf8mb3_general_ci',
  `cleandate` DATE NOT NULL COMMENT '세척일자',
  `cleancount` INT(11) NOT NULL COMMENT '세척횟수',
  PRIMARY KEY (`sn`) USING BTREE,
  INDEX `device_id` (`deviceid`) USING BTREE,
  INDEX `date` (`cleandate`) USING BTREE
) COMMENT='세척 횟수' COLLATE='utf8mb3_general_ci' ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `eg_deviceinfo` (
  `sn` INT(11) NOT NULL AUTO_INCREMENT,
  `deviceid` VARCHAR(50) NOT NULL COLLATE 'utf8mb3_general_ci',
  `devicename` VARCHAR(100) NULL DEFAULT NULL COLLATE 'utf8mb3_general_ci',
  `mangegroup` INT(11) NULL DEFAULT NULL,
  `lastsignaldt` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`sn`) USING BTREE,
  UNIQUE INDEX `deviceid` (`deviceid`) USING BTREE,
  INDEX `id` (`deviceid`) USING BTREE
) COLLATE='utf8mb3_general_ci' ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `eg_managegroup` (
  `sn` INT(11) NOT NULL AUTO_INCREMENT,
  `groupname` VARCHAR(50) NOT NULL COLLATE 'utf8mb3_general_ci',
  `upcode` INT(11) NOT NULL,
  PRIMARY KEY (`sn`) USING BTREE
) COLLATE='utf8mb3_general_ci' ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `eg_userinfo` (
  `sn` INT(11) NOT NULL AUTO_INCREMENT,
  `userid` VARCHAR(50) NOT NULL COLLATE 'utf8mb3_general_ci',
  `username` VARCHAR(50) NOT NULL COLLATE 'utf8mb3_general_ci',
  `password` VARCHAR(50) NOT NULL COLLATE 'utf8mb3_general_ci',
  `managegroup` INT(11) NULL DEFAULT NULL,
  `LEVEL` INT(11) NULL DEFAULT NULL,
  PRIMARY KEY (`sn`) USING BTREE,
  UNIQUE INDEX `userid` (`userid`) USING BTREE
) COMMENT='사용자 정보 테이블' COLLATE='utf8mb3_general_ci' ENGINE=InnoDB;
