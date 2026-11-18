-- ==============================================================================
-- SAVERA PARADISE — SUPABASE ROLLBACK 14
-- Rollback for Migration 14: Security & Schema Alignment
-- ==============================================================================

BEGIN;

-- Restore standard prevent_order_deletion without bypass
CREATE OR REPLACE FUNCTION public.prevent_order_deletion()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Orders cannot be deleted: Orders are permanent financial and audit records.';
END;
$$ LANGUAGE plpgsql;

-- Restore standard enforce_order_status_monotonicity
CREATE OR REPLACE FUNCTION public.enforce_order_status_monotonicity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'delivered' AND NEW.status != 'delivered' THEN
    RAISE EXCEPTION 'Cannot modify an already delivered order';
  END IF;
  IF OLD.status = 'undelivered' AND NEW.status != 'undelivered' THEN
    RAISE EXCEPTION 'Cannot modify an undelivered order';
  END IF;
  IF OLD.status = 'cancelled' AND NEW.status != 'cancelled' THEN
    RAISE EXCEPTION 'Cannot modify a cancelled order';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
