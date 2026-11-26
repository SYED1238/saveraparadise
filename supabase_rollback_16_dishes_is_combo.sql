-- ============================================================================
-- Rollback 16: Remove is_combo column from public.dishes
-- ============================================================================

ALTER TABLE public.dishes DROP COLUMN IF EXISTS is_combo;
