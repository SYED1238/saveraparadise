-- ==============================================================================
-- SAVERA PARADISE — SUPABASE MIGRATION 05
-- Operational Invariants & Comprehensive Mutation Security Hardening
-- ==============================================================================
-- 1. Enforce Server-Side Active Order Limit (max 2 active orders per customer)
-- 2. Enforce Comprehensive Mutation Protection Trigger on public.orders:
--    - Financial Immutability (total, items, user_id)
--    - Customer Details & Address Immutability
--    - Payment Integrity (Online payment verification locked to service_role)
--    - Order Lifecycle & Forward Progression Invariants
-- ==============================================================================

-- 1. COMPREHENSIVE ORDER MUTATION SECURITY TRIGGER
CREATE OR REPLACE FUNCTION public.prevent_order_financial_tampering()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role TEXT := auth.role();
  v_is_service_role BOOLEAN := (v_role = 'service_role');
  v_old_rank INT := 0;
  v_new_rank INT := 0;
BEGIN
  -- 1. Trusted backend operations (e.g. verified Cashfree webhook via service_role)
  IF v_is_service_role THEN
    RETURN NEW;
  END IF;

  -- 2. Terminal State Immutability:
  -- Once an order reaches terminal status (delivered, undelivered, cancelled),
  -- no further modifications are permitted.
  IF OLD.status IN ('delivered', 'undelivered', 'cancelled') THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.payment_status IS NOT DISTINCT FROM OLD.payment_status
       AND NEW.is_paid_online IS NOT DISTINCT FROM OLD.is_paid_online THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Order % is in terminal status (%) and cannot be modified.', OLD.id, OLD.status;
  END IF;

  -- 3. Financial Immutability:
  -- Total, items, and customer account user_id are strictly immutable after creation.
  IF (OLD.total IS NOT NULL AND NEW.total IS DISTINCT FROM OLD.total)
     OR (OLD.items IS NOT NULL AND NEW.items IS DISTINCT FROM OLD.items)
     OR (OLD.user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION 'Order financial totals and items are immutable after creation.';
  END IF;

  -- 4. Customer PII and Delivery Address Immutability:
  -- Delivery location, recipient name, phone, and pickup tags cannot be tampered with.
  IF (OLD.customer_phone IS NOT NULL AND NEW.customer_phone IS DISTINCT FROM OLD.customer_phone)
     OR (OLD.customer_name IS NOT NULL AND NEW.customer_name IS DISTINCT FROM OLD.customer_name)
     OR (OLD.delivery_address IS NOT NULL AND NEW.delivery_address IS DISTINCT FROM OLD.delivery_address)
     OR (OLD.pickup_code IS NOT NULL AND NEW.pickup_code IS DISTINCT FROM OLD.pickup_code) THEN
    RAISE EXCEPTION 'Customer delivery information and pickup code are immutable after order placement.';
  END IF;

  -- 5. Payment Integrity Guard (Critical Bug Protection):
  -- Flipping online payment flag to true is strictly restricted to service_role (Cashfree webhook).
  IF (NEW.is_paid_online = TRUE AND (OLD.is_paid_online IS NULL OR OLD.is_paid_online = FALSE)) THEN
    RAISE EXCEPTION 'Unauthorized payment confirmation: Online payment verification requires server authorization.';
  END IF;

  -- Cashfree transaction reference updates are strictly restricted to service_role.
  IF (NEW.cf_payment_status IS NOT NULL AND NEW.cf_payment_status = 'SUCCESS'
      AND (OLD.cf_payment_status IS NULL OR OLD.cf_payment_status != 'SUCCESS')) THEN
    RAISE EXCEPTION 'Unauthorized payment confirmation: Cashfree transaction status can only be updated via verified webhook.';
  END IF;

  -- Online orders cannot have payment_status marked as 'Paid' by client-side anonymous calls.
  IF (OLD.payment_method = 'Online' OR OLD.payment_status = 'Pending')
     AND (NEW.payment_status = 'Paid' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'Paid'))
     AND (NEW.is_paid_online IS NOT TRUE) THEN
    RAISE EXCEPTION 'Online payment orders can only be marked as Paid through Cashfree payment verification.';
  END IF;

  -- Unpaid orders cannot be marked as Paid prior to actual delivery.
  IF (NEW.payment_status = 'Paid' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'Paid')) THEN
    IF NEW.status != 'delivered' THEN
      RAISE EXCEPTION 'Unpaid orders cannot be marked as Paid prior to successful delivery.';
    END IF;
  END IF;

  -- 6. Order Lifecycle Progression & Customer Cancellation:
  IF NEW.status = 'cancelled' AND (OLD.status IS DISTINCT FROM 'cancelled') THEN
    IF OLD.status NOT IN ('pending', 'accepted') THEN
      RAISE EXCEPTION 'Cannot cancel order once kitchen preparation has begun (% to %).', OLD.status, NEW.status;
    END IF;
    RETURN NEW;
  END IF;

  -- Calculate state progression ranks
  CASE OLD.status
    WHEN 'pending' THEN v_old_rank := 0;
    WHEN 'accepted' THEN v_old_rank := 1;
    WHEN 'cooking' THEN v_old_rank := 2;
    WHEN 'ready_for_pickup' THEN v_old_rank := 3;
    WHEN 'on_the_way' THEN v_old_rank := 4;
    WHEN 'delivered' THEN v_old_rank := 5;
    WHEN 'undelivered' THEN v_old_rank := 5;
    ELSE v_old_rank := 0;
  END CASE;

  CASE NEW.status
    WHEN 'pending' THEN v_new_rank := 0;
    WHEN 'accepted' THEN v_new_rank := 1;
    WHEN 'cooking' THEN v_new_rank := 2;
    WHEN 'ready_for_pickup' THEN v_new_rank := 3;
    WHEN 'on_the_way' THEN v_new_rank := 4;
    WHEN 'delivered' THEN v_new_rank := 5;
    WHEN 'undelivered' THEN v_new_rank := 5;
    ELSE v_new_rank := 0;
  END CASE;

  -- Invariant: Order status cannot regress backwards
  IF v_new_rank < v_old_rank THEN
    RAISE EXCEPTION 'Order status cannot regress backwards (% to %).', OLD.status, NEW.status;
  END IF;

  -- Invariant: Order cannot skip straight from pending/accepted to delivered
  IF v_old_rank < 3 AND NEW.status = 'delivered' THEN
    RAISE EXCEPTION 'Illegal order transition: Order cannot be marked delivered directly from % status.', OLD.status;
  END IF;

  RETURN NEW;
END;
$$;

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
