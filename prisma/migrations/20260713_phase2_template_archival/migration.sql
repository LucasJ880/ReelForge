-- Phase 2 template version lifecycle: exactly one ACTIVE version per slug is
-- enforced by the service transaction; ARCHIVED keeps historical batch FKs valid.
ALTER TYPE "StyleTemplateStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';
