-- Migration 15: Stuck Order Recovery & Rider Release Flow
-- Adds rider_assigned_at, dropped_rider_pins, index on ready_for_pickup,
-- updates prevent_order_status_reversal to permit ready_for_pickup -> cancelled with reason,
-- and updates rider_assign_or_claim_order with 15-minute stage-1 expiry takeover and 3-minute drop cooldown.

-- 1. Track exact Stage-1 rider claim timestamp & drop history
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS rider_assigned_at BIGINT,
  ADD COLUMN IF NOT EXISTS dropped_rider_pins JSONB DEFAULT '[]'::jsonb;

-- 2. Partial index for fast lazy-timeout checks on ready_for_pickup orders
CREATE INDEX IF NOT EXISTS idx_orders_ready_assigned
  ON public.orders (status, rider_assigned_at)
  WHERE status = 'ready_for_pickup' AND assigned_rider_pin IS NOT NULL;

-- 3. Update prevent_order_status_reversal trigger function
CREATE OR REPLACE FUNCTION public.prevent_order_status_reversal()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  old_rank INT := 0;
  new_rank INT := 0;
BEGIN
  -- Explicit cancellation rule: permitted from pending, accepted,
  -- OR from ready_for_pickup when a valid non-empty cancellation reason is provided
  IF NEW.status = 'cancelled' THEN
    IF OLD.status = 'ready_for_pickup' THEN
      IF NULLIF(trim(NEW.cancellation_reason), '') IS NULL THEN
        RAISE EXCEPTION 'Cancellation reason is required to cancel an order ready for pickup';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.status IN ('cooking', 'on_the_way', 'delivered', 'undelivered') THEN
      RAISE EXCEPTION 'Cannot cancel order once kitchen preparation has begun (% to %)', OLD.status, NEW.status;
    END IF;
    RETURN NEW;
  END IF;

  -- Delivered & Undelivered orders are terminal and cannot be modified
  IF OLD.status = 'delivered' AND NEW.status != 'delivered' THEN
    RAISE EXCEPTION 'Cannot modify an order that has already been delivered.';
  END IF;

  IF OLD.status = 'undelivered' AND NEW.status != 'undelivered' THEN
    RAISE EXCEPTION 'Cannot modify an order that was marked undelivered.';
  END IF;

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
$function$;

-- 4. Update rider_assign_or_claim_order with 15-minute stage-1 expiry takeover and 3-minute drop cooldown
CREATE OR REPLACE FUNCTION public.rider_assign_or_claim_order(
  p_action text,
  p_order_id text,
  p_rider_pin text,
  p_rider_name text DEFAULT NULL::text,
  p_rider_phone text DEFAULT NULL::text,
  p_rider_vehicle text DEFAULT 'Bike'::text,
  p_eta text DEFAULT NULL::text,
  p_within_counter_zone boolean DEFAULT false,
  p_is_rider boolean DEFAULT true,
  p_now_ms bigint DEFAULT NULL::bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now_ms BIGINT := COALESCE(p_now_ms, FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT);
  v_clean_id TEXT := REGEXP_REPLACE(COALESCE(p_order_id, ''), '^#', '');
  v_order public.orders%ROWTYPE;
  v_max_allowed INTEGER := 1;
  v_rider_max INTEGER;
  v_existing_pin TEXT;
  v_other_active_count INTEGER := 0;
  v_otw_count INTEGER := 0;
  v_first_otw_id TEXT;
  v_all_recent_pickup BOOLEAN := FALSE;
  v_details JSONB;
  v_updated public.orders%ROWTYPE;
BEGIN
  IF p_rider_pin IS NOT NULL AND TRIM(p_rider_pin) <> '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('rider_cap_' || TRIM(p_rider_pin)));

    SELECT max_active_orders INTO v_rider_max
    FROM public.riders
    WHERE pin = TRIM(p_rider_pin)
    FOR UPDATE;

    IF v_rider_max IS NOT NULL THEN
      v_max_allowed := GREATEST(1, LEAST(4, v_rider_max));
    END IF;
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = v_clean_id OR id = ('#' || v_clean_id)
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'http_status', 404, 'error', 'Order not found');
  END IF;

  v_existing_pin := COALESCE(TRIM(v_order.assigned_rider_pin), '');

  IF p_action = 'assign_order' THEN
    -- Check 3-minute anti-cherry-picking cooldown if this rider recently dropped this order
    IF p_rider_pin IS NOT NULL AND v_order.dropped_rider_pins IS NOT NULL AND jsonb_typeof(v_order.dropped_rider_pins) = 'array' THEN
      IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_order.dropped_rider_pins) elem
        WHERE (elem->>'pin') = TRIM(p_rider_pin)
          AND (v_now_ms - COALESCE((elem->>'droppedAt')::BIGINT, 0)) < 180000
      ) THEN
        RETURN jsonb_build_object(
          'ok', false,
          'http_status', 409,
          'error', 'Rider recently released this order. Please wait 3 minutes before re-claiming.'
        );
      END IF;
    END IF;

    -- Existing assigned rider check: allow atomic takeover if 15-minute timeout expired while still in ready_for_pickup
    IF v_existing_pin <> '' AND v_existing_pin <> COALESCE(TRIM(p_rider_pin), '') THEN
      IF NOT (
        v_order.status = 'ready_for_pickup'
        AND (
          (v_now_ms - COALESCE(v_order.rider_assigned_at, FLOOR(COALESCE(NULLIF(v_order.address_details->>'riderAssignedAt', ''), '0')::NUMERIC)::BIGINT)) > 900000
        )
      ) THEN
        RETURN jsonb_build_object(
          'ok', false,
          'http_status', 409,
          'error', 'Order is already accepted by another rider',
          'claimedBy', v_order.assigned_rider_name
        );
      END IF;
    END IF;

    IF v_order.status <> 'ready_for_pickup' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'http_status', 400,
        'error', format('Order is not ready for pickup (current status: %s)', v_order.status)
      );
    END IF;

    IF COALESCE(TRIM(p_rider_pin), '') <> '' AND v_existing_pin <> TRIM(p_rider_pin) THEN
      SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE status = 'on_the_way'),
        MIN(id) FILTER (WHERE status = 'on_the_way'),
        COALESCE(
          BOOL_AND(
            CASE WHEN status = 'on_the_way' THEN
              (FLOOR(COALESCE(NULLIF(address_details->>'pickedUpAt', ''), '0')::NUMERIC)::BIGINT > 0
                AND (v_now_ms - FLOOR(COALESCE(NULLIF(address_details->>'pickedUpAt', ''), '0')::NUMERIC)::BIGINT) <= 180000)
            ELSE TRUE END
          ),
          FALSE
        )
      INTO v_other_active_count, v_otw_count, v_first_otw_id, v_all_recent_pickup
      FROM public.orders
      WHERE assigned_rider_pin = TRIM(p_rider_pin)
        AND status IN ('on_the_way', 'ready_for_pickup', 'cooking', 'accepted')
        AND REGEXP_REPLACE(id, '^#', '') <> v_clean_id;

      IF v_otw_count > 0 THEN
        IF NOT (v_max_allowed > 1 AND v_other_active_count < v_max_allowed AND (COALESCE(p_within_counter_zone, FALSE) OR v_all_recent_pickup)) THEN
          RETURN jsonb_build_object(
            'ok', false,
            'http_status', 409,
            'code', 'ACTIVE_ORDER_LIMIT',
            'error', format('Rider already has an active order (%s) on the way. Complete current delivery before accepting another order.', COALESCE(v_first_otw_id, ''))
          );
        END IF;
      END IF;

      IF v_other_active_count >= v_max_allowed THEN
        RETURN jsonb_build_object(
          'ok', false,
          'http_status', 409,
          'code', 'ACTIVE_ORDER_LIMIT',
          'error', format('Rider has reached the active order limit (%s). Complete existing order(s) first.', v_max_allowed)
        );
      END IF;
    END IF;

    v_details := COALESCE(v_order.address_details, '{}'::jsonb) || jsonb_build_object(
      'riderPickupStage', 'going_to_restaurant',
      'riderAssignedAt', v_now_ms
    );

    UPDATE public.orders
    SET status_label = 'Rider Going to Restaurant',
        eta = COALESCE(NULLIF(TRIM(p_eta), ''), NULLIF(TRIM(v_order.eta), ''), 'Heading to Restaurant'),
        assigned_rider_pin = NULLIF(TRIM(p_rider_pin), ''),
        assigned_rider_name = NULLIF(TRIM(p_rider_name), ''),
        assigned_rider_phone = NULLIF(TRIM(p_rider_phone), ''),
        assigned_rider_vehicle = COALESCE(NULLIF(TRIM(p_rider_vehicle), ''), 'Bike'),
        rider_assigned_at = v_now_ms,
        address_details = v_details
    WHERE id = v_order.id
    RETURNING * INTO v_updated;

    RETURN jsonb_build_object('ok', true, 'http_status', 200, 'order', to_jsonb(v_updated));
  END IF;

  IF p_action = 'claim_order' THEN
    IF p_is_rider THEN
      IF v_existing_pin <> '' AND v_existing_pin <> COALESCE(TRIM(p_rider_pin), '') THEN
        RETURN jsonb_build_object(
          'ok', false,
          'http_status', 409,
          'error', 'Order is already claimed by another rider',
          'claimedBy', v_order.assigned_rider_name
        );
      END IF;

      IF NOT (v_existing_pin <> '' AND v_existing_pin = COALESCE(TRIM(p_rider_pin), '') AND v_order.status = 'on_the_way') THEN
        IF v_order.status <> 'ready_for_pickup' THEN
          RETURN jsonb_build_object(
            'ok', false,
            'http_status', 400,
            'error', format('Order is not ready for pickup (current status: %s). Food must be ready on counter before claim.', v_order.status)
          );
        END IF;

        IF COALESCE(TRIM(p_rider_pin), '') <> '' THEN
          SELECT COUNT(*), MIN(id)
          INTO v_otw_count, v_first_otw_id
          FROM public.orders
          WHERE assigned_rider_pin = TRIM(p_rider_pin)
            AND status = 'on_the_way'
            AND REGEXP_REPLACE(id, '^#', '') <> v_clean_id;

          IF v_otw_count >= v_max_allowed THEN
            RETURN jsonb_build_object(
              'ok', false,
              'http_status', 409,
              'code', 'ACTIVE_ORDER_LIMIT',
              'error', format('Rider already has an active order (%s) on the way. Complete current delivery before claiming another order.', COALESCE(v_first_otw_id, ''))
            );
          END IF;
        END IF;
      END IF;
    END IF;

    v_details := COALESCE(v_order.address_details, '{}'::jsonb) || jsonb_build_object(
      'riderPickupStage', 'picked_up',
      'pickedUpAt', v_now_ms
    );

    UPDATE public.orders
    SET status = 'on_the_way',
        step_index = 3,
        status_label = 'Rider is on the Way Towards You',
        assigned_rider_pin = NULLIF(TRIM(p_rider_pin), ''),
        assigned_rider_name = NULLIF(TRIM(p_rider_name), ''),
        assigned_rider_phone = NULLIF(TRIM(p_rider_phone), ''),
        assigned_rider_vehicle = COALESCE(NULLIF(TRIM(p_rider_vehicle), ''), 'Bike'),
        address_details = v_details
    WHERE id = v_order.id
    RETURNING * INTO v_updated;

    RETURN jsonb_build_object('ok', true, 'http_status', 200, 'order', to_jsonb(v_updated));
  END IF;

  RETURN jsonb_build_object('ok', false, 'http_status', 400, 'error', 'Unsupported rider order action');
END;
$function$;
