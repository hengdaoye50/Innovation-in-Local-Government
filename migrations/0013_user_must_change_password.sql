-- 强制改密：管理员在后台把密码重置成默认口令后，置 1。
-- 下一次登录必须先改成自己的密码，其余接口一律 403（闸口在 functions/_middleware.js）。
-- 学生自己改密码成功后清回 0。
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
