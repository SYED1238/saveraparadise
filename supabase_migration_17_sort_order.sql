-- ============================================================================
-- Migration 17: Add nullable sort_order to public.categories and public.dishes
-- ============================================================================
-- Allows Admin Portal to control explicit display ordering:
--   NULL = fallback to default ordering (Combos first, then created order)
--   1..N = explicit 1-based position (1 shows first)
-- ============================================================================

ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT NULL;
ALTER TABLE public.dishes ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT NULL;
