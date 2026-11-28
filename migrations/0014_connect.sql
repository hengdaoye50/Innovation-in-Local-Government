-- 师生互联：一对一提问（含往返消息）+ office hour 预约
-- 执行：npx wrangler d1 migrations apply innovation-localgov --local / --remote
--
-- 两点设计口径（与 CLAUDE.md「师生互联」一节对应）：
-- 1. 提问是往返的私信，一条提问 = 一个 thread + 若干 message；awaiting 记「现在轮到谁」。
-- 2. 预约的具体时间由老师批复时给出。防撞靠 slot_key：只在 confirmed 时写入，
--    并在库上用 partial unique index 兜底（declined / cancelled 必须置空）。

CREATE TABLE IF NOT EXISTS qa_threads (
  id            TEXT    PRIMARY KEY,
  student_id    INTEGER NOT NULL,
  student_name  TEXT,
  subject       TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'open',   -- open | replied
  awaiting      TEXT    NOT NULL DEFAULT 'staff',  -- staff | student
  message_count INTEGER NOT NULL DEFAULT 0,
  last_body     TEXT,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  FOREIGN KEY (student_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_qa_threads_student  ON qa_threads(student_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_qa_threads_awaiting ON qa_threads(awaiting, updated_at DESC);

CREATE TABLE IF NOT EXISTS qa_messages (
  id          TEXT    PRIMARY KEY,
  thread_id   TEXT    NOT NULL,
  author_id   INTEGER NOT NULL,
  author_name TEXT,
  author_role TEXT    NOT NULL,                    -- student | teacher | admin
  body        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES qa_threads(id),
  FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_qa_messages_thread ON qa_messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS office_hours (
  id              TEXT    PRIMARY KEY,
  student_id      INTEGER NOT NULL,
  student_name    TEXT,
  topic           TEXT    NOT NULL,
  note            TEXT,
  prefer_date     TEXT    NOT NULL,                -- YYYY-MM-DD，只收周三/周四
  prefer_slot     TEXT    NOT NULL,                -- HH:MM，固定档位
  status          TEXT    NOT NULL DEFAULT 'pending', -- pending | confirmed | declined | cancelled | done
  slot_key        TEXT,                            -- 已确认时段 "YYYY-MM-DD HH:MM"，防撞用
  scheduled_date  TEXT,
  scheduled_slot  TEXT,
  location        TEXT,
  reply           TEXT,
  decided_by      INTEGER,
  decided_by_name TEXT,
  decided_at      TEXT,
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  FOREIGN KEY (student_id) REFERENCES users(id)
);

-- 同一时段只能有一条「已确认」：partial unique index 只约束 slot_key 非空的行
CREATE UNIQUE INDEX IF NOT EXISTS idx_office_hours_slot ON office_hours(slot_key)
  WHERE slot_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_office_hours_student ON office_hours(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_office_hours_status  ON office_hours(status, created_at DESC);
