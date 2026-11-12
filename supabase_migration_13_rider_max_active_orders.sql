-- Migration 13: Add per-rider active order concurrency limit (1-5, default 1)
-- Safe non-blocking expand migration for PostgreSQL 11+ (static constant default, no table rewrite).

ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS max_active_orders INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_riders_max_active_orders'
      AND conrelid = 'public.riders'::regclass
  ) THEN
    ALTER TABLE public.riders
      ADD CONSTRAINT chk_riders_max_active_orders
      CHECK (max_active_orders >= 1 AND max_active_orders <= 5);
  END IF;
END $$;
