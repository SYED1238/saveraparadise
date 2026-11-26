-- ============================================================================
-- Migration 16: Add explicit nullable is_combo flag to public.dishes
-- ============================================================================
-- Allows Kitchen/Admin Portal to explicitly turn "Combo Meal (Show First in Menu)"
-- ON or OFF for any dish (regardless of category/badge):
--   NULL  = backwards-compatible auto-detection by category/badge
--   TRUE  = explicitly featured first in menu
--   FALSE = explicitly not forced first in menu
-- ============================================================================

ALTER TABLE public.dishes ADD COLUMN IF NOT EXISTS is_combo BOOLEAN DEFAULT NULL;
