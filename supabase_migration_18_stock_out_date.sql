-- ============================================================================
-- Migration 18: Add nullable stock_out_date to public.dishes
-- ============================================================================
-- Tracks the IST operational date (YYYY-MM-DD, starting 1:00 AM IST) when a dish
-- was manually marked Out of Stock (in_stock = false):
--   NULL = no daily stock-out stamp recorded
--   YYYY-MM-DD = stamped when marked Out of Stock; enables daily auto-restock
--                the following day when settings.returnStockEveryDay = true
-- ============================================================================

ALTER TABLE public.dishes ADD COLUMN IF NOT EXISTS stock_out_date TEXT DEFAULT NULL;
