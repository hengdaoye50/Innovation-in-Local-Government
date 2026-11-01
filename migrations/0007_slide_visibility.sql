-- 展位可见性：public 所有人可见，private 仅上传者与管理员可见
-- 老数据一律按 public 处理，不会有展位因为这次改动消失
ALTER TABLE slides ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
