-- 地方政府创新案例库 · D1 初始结构
-- 执行：wrangler d1 execute innovation-localgov --file=migrations/0001_init.sql --remote

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  display_name  TEXT,
  role          TEXT    NOT NULL DEFAULT 'student',  -- student | teacher | admin
  status        TEXT    NOT NULL DEFAULT 'active',   -- active | disabled
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS invites (
  code        TEXT    PRIMARY KEY,
  created_by  INTEGER,
  used_by     INTEGER,
  used_at     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (used_by)   REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS cases (
  id           TEXT    PRIMARY KEY,
  title        TEXT    NOT NULL,
  province     TEXT    NOT NULL,
  city         TEXT,
  lng          REAL,
  lat          REAL,
  domains      TEXT    NOT NULL DEFAULT '[]',   -- JSON 数组
  summary      TEXT,
  body         TEXT    NOT NULL,
  sources_json TEXT    NOT NULL DEFAULT '[]',   -- JSON 数组 {url,title}
  author_id    INTEGER NOT NULL,
  author_name  TEXT,
  status       TEXT    NOT NULL DEFAULT 'pending', -- pending | published | rejected | hidden
  ai_review    TEXT,
  ai_score     INTEGER,
  year         TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_cases_status   ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_province ON cases(province);
CREATE INDEX IF NOT EXISTS idx_cases_author   ON cases(author_id);
CREATE INDEX IF NOT EXISTS idx_cases_created  ON cases(created_at DESC);

CREATE TABLE IF NOT EXISTS slides (
  id          TEXT    PRIMARY KEY,
  title       TEXT    NOT NULL,
  course      TEXT,
  term        TEXT,
  author_id   INTEGER,
  author_name TEXT,
  cover_url   TEXT,
  file_url    TEXT,
  description TEXT,
  slide_count INTEGER DEFAULT 0,
  ai_review   TEXT,
  ai_score    INTEGER,
  status      TEXT    NOT NULL DEFAULT 'published',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_slides_created ON slides(created_at DESC);

CREATE TABLE IF NOT EXISTS posts (
  id           TEXT    PRIMARY KEY,
  title        TEXT    NOT NULL,
  author       TEXT,
  source_url   TEXT,
  tags         TEXT    NOT NULL DEFAULT '[]',
  excerpt      TEXT,
  body         TEXT,
  cover_url    TEXT,
  status       TEXT    NOT NULL DEFAULT 'published',
  published_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published_at DESC);

CREATE TABLE IF NOT EXISTS comments (
  id          TEXT    PRIMARY KEY,
  target_type TEXT    NOT NULL,  -- case | slide | post
  target_id   TEXT    NOT NULL,
  author_id   INTEGER,
  author_name TEXT,
  author_role TEXT    NOT NULL DEFAULT 'student', -- student | teacher | ai
  body        TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'visible',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, target_id, created_at);
