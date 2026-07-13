-- Expand-only prerequisite for the Phase 1 account unification migration.
-- A separate migration ensures PostgreSQL commits the enum addition before a
-- later migration uses CUSTOMER in defaults and data updates.
ALTER TYPE "AdminRole" ADD VALUE IF NOT EXISTS 'CUSTOMER';
