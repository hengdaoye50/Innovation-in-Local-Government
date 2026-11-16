-- 材料提交：学生交案例报告 / 课件 / 读书报告 / 文献评析，教师批阅并择优展出
-- 与 cases 分开：案例要过模型质检并落到地图，这里只收成品、只做人工批阅
CREATE TABLE IF NOT EXISTS works (
  id             TEXT PRIMARY KEY,
  kind           TEXT    NOT NULL DEFAULT 'other',     -- case-report | slides | reading-report | lit-review | other
  title          TEXT    NOT NULL,
  course         TEXT,
  term           TEXT,
  group_name     TEXT,
  members        TEXT,                                 -- 组员，一行一个
  summary        TEXT,                                 -- 说明 / 摘要，纯文本
  links_json     TEXT    NOT NULL DEFAULT '[]',         -- 附带的在线文档外链
  author_id      INTEGER,
  author_name    TEXT,
  status         TEXT    NOT NULL DEFAULT 'submitted',  -- submitted | returned | reviewed | archived
  verdict        TEXT,                                 -- excellent | pass | return
  comment        TEXT,
  comment_public INTEGER NOT NULL DEFAULT 0,            -- 评语是否随择优一起公开
  reviewer_id    INTEGER,
  reviewer_name  TEXT,
  reviewed_at    TEXT,
  featured       INTEGER NOT NULL DEFAULT 0,            -- 1 = 出现在课堂展示墙上
  featured_at    TEXT,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_works_author ON works(author_id, created_at);
CREATE INDEX IF NOT EXISTS idx_works_queue ON works(status, created_at);
CREATE INDEX IF NOT EXISTS idx_works_featured ON works(featured, featured_at);

-- 附件元信息；文件本体在对象存储里（R2 优先，未开通时暂落 KV）
CREATE TABLE IF NOT EXISTS work_files (
  id         TEXT    PRIMARY KEY,
  work_id    TEXT,                                     -- 提交时回填，未提交前为空
  owner_id   INTEGER,
  file_name  TEXT,
  mime       TEXT,
  size       INTEGER,
  storage    TEXT    NOT NULL DEFAULT 'r2',            -- r2 | kv
  created_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_work_files_work ON work_files(work_id);
CREATE INDEX IF NOT EXISTS idx_work_files_owner ON work_files(owner_id, created_at);
