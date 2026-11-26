-- ============================================================================
-- Rollback 18: Remove stock_out_date from public.dishes
-- ============================================================================

ALTER TABLE public.dishes DROP COLUMN IF EXISTS stock_out_date;
