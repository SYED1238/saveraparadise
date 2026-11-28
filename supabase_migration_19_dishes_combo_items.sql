-- ============================================================================
-- Migration 19: Add nullable combo_items JSONB array to public.dishes
-- ============================================================================
-- Stores structured individual included items for combo meals, e.g.:
--   ["Half Alfaham", "2 Biryani Rice (Full)", "2 Kerala Parota"]
--   NULL = regular single dish or dish without structured combo item tags
-- Also idempotently backfills existing '+'-separated combo descriptions.
-- ============================================================================

ALTER TABLE public.dishes ADD COLUMN IF NOT EXISTS combo_items JSONB DEFAULT NULL;

-- Idempotent backfill for existing combos that list items separated by '+'
UPDATE public.dishes
SET combo_items = (
  SELECT jsonb_agg(trim(part))
  FROM unnest(string_to_array(description, '+')) AS part
  WHERE trim(part) <> ''
)
WHERE combo_items IS NULL
  AND description IS NOT NULL
  AND description LIKE '%+%'
  AND (
    is_combo IS TRUE
    OR lower(coalesce(category, '')) LIKE '%combo%'
    OR lower(coalesce(category_name, '')) LIKE '%combo%'
    OR lower(coalesce(badge, '')) LIKE '%combo%'
  );
