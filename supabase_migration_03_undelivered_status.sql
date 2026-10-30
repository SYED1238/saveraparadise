-- =========================================================================
-- SAVERA PARADISE: STAGE 3 CUSTOMER UNREACHABLE / UNDELIVERED STATUS
-- Idempotent trigger function update to support 'undelivered' terminal status
-- Copy and run in Supabase SQL Editor if using remote PostgreSQL triggers:
-- https://supabase.com/dashboard/project/jsqpwkgcmcfidtprvhzm/sql/new
-- =========================================================================

SET lock_timeout = '2s';

-- 1. Ensure prevent_order_status_reversal supports 'undelivered' as rank 5 terminal status
CREATE OR REPLACE FUNCTION public.prevent_order_status_reversal()
RETURNS TRIGGER AS $$
DECLARE
  old_rank INT := 0;
  new_rank INT := 0;
BEGIN
  -- Explicit cancellation rule: permitted ONLY from pending or accepted before cooking starts
  IF NEW.status = 'cancelled' THEN
    IF OLD.status IN ('cooking', 'ready_for_pickup', 'on_the_way', 'delivered', 'undelivered') THEN
      RAISE EXCEPTION 'Cannot cancel order once kitchen preparation has begun (% to %)', OLD.status, NEW.status;
    END IF;
    RETURN NEW;
  END IF;

  -- Delivered orders cannot be changed
  IF OLD.status = 'delivered' AND NEW.status != 'delivered' THEN
    RAISE EXCEPTION 'Cannot modify an order that has already been delivered.';
  END IF;

  -- Undelivered orders cannot be changed
  IF OLD.status = 'undelivered' AND NEW.status != 'undelivered' THEN
    RAISE EXCEPTION 'Cannot modify an order that was marked undelivered.';
  END IF;

  -- Cancelled orders cannot be reactivated
  IF OLD.status = 'cancelled' AND NEW.status != 'cancelled' THEN
    RAISE EXCEPTION 'Cannot reactivate an order that was cancelled.';
  END IF;

  -- Compute old status rank
  CASE OLD.status
    WHEN 'pending' THEN old_rank := 0;
    WHEN 'accepted' THEN old_rank := 1;
    WHEN 'cooking' THEN old_rank := 2;
    WHEN 'ready_for_pickup' THEN old_rank := 3;
    WHEN 'on_the_way' THEN old_rank := 4;
    WHEN 'delivered' THEN old_rank := 5;
    WHEN 'undelivered' THEN old_rank := 5;
    ELSE old_rank := 0;
  END CASE;

  -- Compute new status rank
  CASE NEW.status
    WHEN 'pending' THEN new_rank := 0;
    WHEN 'accepted' THEN new_rank := 1;
    WHEN 'cooking' THEN new_rank := 2;
    WHEN 'ready_for_pickup' THEN new_rank := 3;
    WHEN 'on_the_way' THEN new_rank := 4;
    WHEN 'delivered' THEN new_rank := 5;
    WHEN 'undelivered' THEN new_rank := 5;
    ELSE new_rank := 0;
  END CASE;

  -- Prevent reversing status backwards
  IF new_rank < old_rank THEN
    RAISE EXCEPTION 'Order status cannot be reversed from % (rank %) to % (rank %). Status progression is forward-only.', OLD.status, old_rank, NEW.status, new_rank;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

RESET lock_timeout;
