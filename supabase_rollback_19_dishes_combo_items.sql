-- ============================================================================
-- Rollback 19: Remove combo_items column from public.dishes
-- ============================================================================

ALTER TABLE public.dishes DROP COLUMN IF EXISTS combo_items;
