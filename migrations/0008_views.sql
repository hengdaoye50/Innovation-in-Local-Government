-- 访问记录：给后台统计日活/周活/月活与各内容浏览量用
-- 一天内同一个人看同一个目标只记一次（去重），既符合「多少人看过」的语义，
-- 也避免每次刷新都写一行把表撑爆
CREATE TABLE IF NOT EXISTS views (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  day         TEXT    NOT NULL,          -- YYYY-MM-DD（UTC）
  user_id     INTEGER NOT NULL,
  target_type TEXT    NOT NULL,          -- case | slide | reading | page
  target_id   TEXT    NOT NULL,          -- 内容 id，页面类用路径
  created_at  TEXT    NOT NULL,
  UNIQUE (day, user_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_views_day ON views(day);
CREATE INDEX IF NOT EXISTS idx_views_target ON views(target_type, target_id);
