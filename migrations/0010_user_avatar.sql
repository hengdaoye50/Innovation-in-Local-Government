-- 用户头像：存预设头像的编号（形如 m3 或 m3:2），不存图片。
-- 取值校验在 functions/api/auth/[[path]].js 里做，前端 src/lib/avatar.js 提供同一套预设。
ALTER TABLE users ADD COLUMN avatar TEXT;
