-- 설치처(조직)별 태블릿 배경 사진. 비어 있으면 상위 조직 것을 물려받고, 아무도 없으면 기본 숲 사진.
-- 전용 계정(ecog)에 ALTER 권한이 있어 deploy.sh 가 바로 적용한다 (새 테이블이 아니므로 GRANT 불필요).
ALTER TABLE eg_org ADD COLUMN IF NOT EXISTS bg_path VARCHAR(200) NULL COMMENT '태블릿 배경 사진. 비어 있으면 상위 조직 것을 물려받음' AFTER logo_path;
