-- 调研足迹：师生实地调研的见闻记录
-- 与案例的区别写在字段里：这条只要求地点、时间、正文，不判「创新点」
CREATE TABLE IF NOT EXISTS surveys (
  id          TEXT    PRIMARY KEY,
  title       TEXT    NOT NULL,
  province    TEXT    NOT NULL,
  city        TEXT,
  district    TEXT,
  lng         REAL,
  lat         REAL,
  body        TEXT    NOT NULL,
  author_id   INTEGER,
  author_name TEXT,
  visited_at  TEXT,                              -- 调研日期（YYYY-MM），可空
  status      TEXT    NOT NULL DEFAULT 'published', -- published | hidden
  created_at  TEXT    NOT NULL,
  FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_surveys_status ON surveys(status, created_at);
