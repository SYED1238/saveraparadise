-- ==============================================================================
-- SAVERA PARADISE — SUPABASE MIGRATION 05
-- Operational Invariants & Financial Immutability Hardening
-- ==============================================================================
-- 1. Enforce Server-Side Active Order Limit (max 2 active orders per customer)
-- 2. Enforce Financial Immutability Trigger on public.orders (total & items tamper guard)
-- ==============================================================================

-- 1. FINANCIAL IMMUTABILITY TRIGGER
-- Once an order is inserted, its items, subtotal, and total amount cannot be altered by status updates.
CREATE OR REPLACE FUNCTION public.prevent_order_financial_tampering()
RETURNS TRIGGER AS $$
BEGIN
  -- Prevent altering financial columns after creation
  IF (OLD.total IS NOT NULL AND NEW.total IS DISTINCT FROM OLD.total)
     OR (OLD.items IS NOT NULL AND NEW.items IS DISTINCT FROM OLD.items)
     OR (OLD.user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION 'Order financial totals and items are immutable after creation.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_order_financial_tampering ON public.orders;
CREATE TRIGGER trg_prevent_order_financial_tampering
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_order_financial_tampering();

-- 2. ACTIVE ORDERS LIMIT TRIGGER
-- Strictly enforces that a customer cannot place more than the permitted number of active orders.
CREATE OR REPLACE FUNCTION public.enforce_max_active_orders()
RETURNS TRIGGER AS $$
DECLARE
  v_active_count INT;
  v_max_allowed INT := 2;
  v_clean_phone TEXT;
BEGIN
  -- Extract digits from customer phone
  IF NEW.customer_phone IS NOT NULL THEN
    v_clean_phone := RIGHT(REGEXP_REPLACE(NEW.customer_phone, '\D', '', 'g'), 10);
  END IF;

  SELECT COUNT(*)
  INTO v_active_count
  FROM public.orders
  WHERE status NOT IN ('delivered', 'cancelled', 'undelivered')
    AND (
      (NEW.user_id IS NOT NULL AND user_id = NEW.user_id)
      OR (v_clean_phone IS NOT NULL AND LENGTH(v_clean_phone) = 10
          AND RIGHT(REGEXP_REPLACE(customer_phone, '\D', '', 'g'), 10) = v_clean_phone)
    );

  IF v_active_count >= v_max_allowed THEN
    RAISE EXCEPTION 'Active order limit reached. You cannot place more than % concurrent active orders.', v_max_allowed;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enforce_max_active_orders ON public.orders;
CREATE TRIGGER trg_enforce_max_active_orders
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_max_active_orders();
