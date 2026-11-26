-- ============================================================================
-- Rollback 17: Remove sort_order column from public.categories and public.dishes
-- ============================================================================

ALTER TABLE public.categories DROP COLUMN IF EXISTS sort_order;
ALTER TABLE public.dishes DROP COLUMN IF EXISTS sort_order;
