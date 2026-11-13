-- Migration 13: Add per-rider active order concurrency limit (1-4, default 1)
-- Safe non-blocking expand migration for PostgreSQL 11+ (static constant default, no table rewrite).

ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS max_active_orders INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_riders_max_active_orders'
      AND conrelid = 'public.riders'::regclass
  ) THEN
    ALTER TABLE public.riders
      DROP CONSTRAINT chk_riders_max_active_orders;
  END IF;

  ALTER TABLE public.riders
    ADD CONSTRAINT chk_riders_max_active_orders
    CHECK (max_active_orders >= 1 AND max_active_orders <= 4);
END $$;

CREATE OR REPLACE FUNCTION public.rider_assign_or_claim_order(
  p_action TEXT,
  p_order_id TEXT,
  p_rider_pin TEXT,
  p_rider_name TEXT DEFAULT NULL,
  p_rider_phone TEXT DEFAULT NULL,
  p_rider_vehicle TEXT DEFAULT 'Bike',
  p_eta TEXT DEFAULT NULL,
  p_within_counter_zone BOOLEAN DEFAULT FALSE,
  p_is_rider BOOLEAN DEFAULT TRUE,
  p_now_ms BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    IF v_existing_pin <> '' AND v_existing_pin <> COALESCE(TRIM(p_rider_pin), '') THEN
      RETURN jsonb_build_object(
        'ok', false,
        'http_status', 409,
        'error', 'Order is already accepted by another rider',
        'claimedBy', v_order.assigned_rider_name
      );
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
        IF v_order.status <> 'ready_for_pickup' AND NOT (v_order.status = 'on_the_way' AND v_existing_pin = '') THEN
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
$$;

REVOKE ALL ON FUNCTION public.rider_assign_or_claim_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rider_assign_or_claim_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BIGINT) FROM anon;
REVOKE ALL ON FUNCTION public.rider_assign_or_claim_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BIGINT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rider_assign_or_claim_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BIGINT) TO service_role;
