-- 产品图取消（CLAUDE.md 铁律 #7：每一轮任务都必须可取消）。
-- 纯加法：枚举加值，不动任何行。
ALTER TYPE "ProductImageStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
