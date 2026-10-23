-- 案例增加区县字段：坐标精度从地级市下沉到区县，
-- 同城多个案例才能在地图上分开，否则放大后仍然重叠成一点。
ALTER TABLE cases ADD COLUMN district TEXT;

CREATE INDEX IF NOT EXISTS idx_cases_district ON cases(province, city, district);
