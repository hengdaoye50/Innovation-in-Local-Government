-- 邀请码带角色：教师可以签发教师邀请码，助教自助注册为 teacher
ALTER TABLE invites ADD COLUMN role TEXT NOT NULL DEFAULT 'student';
