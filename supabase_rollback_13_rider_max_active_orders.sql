-- Rollback 13: Remove per-rider active order concurrency limit column from public.riders

ALTER TABLE public.riders
  DROP CONSTRAINT IF EXISTS chk_riders_max_active_orders;

ALTER TABLE public.riders
  DROP COLUMN IF EXISTS max_active_orders;
