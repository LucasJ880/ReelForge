-- 抖音发布包：发布登记记下「发到了哪个账号」。只加一个可空列，不改不删既有数据；历史行为 NULL。
-- 同一条成片只能登记给一个账号的规则在服务层（publish-service）执行，不加唯一约束：
-- 撤销登记后的行仍保留（只归档不删除），唯一约束会挡住改登记给别的账号。
-- 拿不到锁就快速失败，不在高峰排队阻塞线上查询。
SET lock_timeout = '5s';

ALTER TABLE "PublishRecord" ADD COLUMN IF NOT EXISTS "accountLabel" TEXT;
