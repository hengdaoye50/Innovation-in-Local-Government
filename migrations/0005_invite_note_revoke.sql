-- 邀请码备注与作废
-- 作废用软删除：保留生成与作废痕迹，已使用的码不允许作废
ALTER TABLE invites ADD COLUMN note TEXT;
ALTER TABLE invites ADD COLUMN revoked_at TEXT;

CREATE INDEX IF NOT EXISTS idx_invites_created ON invites(created_at DESC);
