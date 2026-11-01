-- 文献标注：划线与边注
-- 位置用「节序-段序」+ 段内字符偏移表示，不存段落 id，文献 JSON 重新生成也不会错位
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
