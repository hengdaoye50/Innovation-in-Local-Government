-- 一次性修复：线上库的表结构早就建好，但 d1_migrations 表里只记了 0001/0002，
-- 导致 wrangler 从头重跑、在 0003 撞上「列已存在」。
-- 这个脚本补齐真正缺的东西（0006 的表、0007 的列），并把 0003-0007 记进迁移表，
-- 之后 migrations apply 就不会再从头跑了。
--
-- 执行：npx wrangler d1 execute innovation-localgov --remote --file scripts/repair-migrations-0003-0007.sql
-- 前置：先 PRAGMA table_info(invites) 确认 role / note / revoked_at 都在，
--       缺列说明 0004/0005 也没生效，别跑这个脚本，先补那两张表的列。

-- 0006：标注表（已存在则跳过）
CREATE TABLE IF NOT EXISTS annotations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  reading_id    TEXT    NOT NULL,
  author_id     INTEGER NOT NULL,
  author_name   TEXT,
  paragraph_key TEXT    NOT NULL,
  start_offset  INTEGER NOT NULL,
  end_offset    INTEGER NOT NULL,
  quote         TEXT,
  color         TEXT    NOT NULL DEFAULT 'gold',
  note          TEXT,
  created_at    TEXT    NOT NULL,
  FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_annotations_reading ON annotations(reading_id);

-- 0007：展位可见范围（已确认 slides 还没有这一列）
ALTER TABLE slides ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';

-- 把已经生效的迁移补记进去，避免下次 migrations apply 又从 0003 开始撞墙
INSERT OR IGNORE INTO d1_migrations (name) VALUES
  ('0003_add_district.sql'),
  ('0004_invite_role.sql'),
  ('0005_invite_note_revoke.sql'),
  ('0006_annotations.sql'),
  ('0007_slide_visibility.sql');
