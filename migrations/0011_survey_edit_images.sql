-- 调研足迹：允许作者修改，并支持正文插图
-- updated_at 只在真正编辑过之后才有值，旧记录留空，界面上不显示「最后修改」
ALTER TABLE surveys ADD COLUMN updated_at TEXT;

-- 图片直接进 D1：课程量级（几百张）够用，省掉一个 R2 绑定与额外费用。
-- 前端上传前压缩到长边 1600、JPEG 约 200–400KB，单行远低于 D1 的行大小上限。
CREATE TABLE IF NOT EXISTS survey_images (
  id         TEXT    PRIMARY KEY,
  survey_id  TEXT,                             -- 归属记录，保存正文时回填
  owner_id   INTEGER,                          -- 上传者，只有本人能删
  mime       TEXT    NOT NULL,
  width      INTEGER,
  height     INTEGER,
  bytes      BLOB    NOT NULL,
  created_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_survey_images_survey ON survey_images(survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_images_owner ON survey_images(owner_id, created_at);
