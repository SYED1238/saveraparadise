-- =========================================================================
-- SAVERA PARADISE: ROLLBACK FOR STAGE 1 ORDERS SCHEMA ALIGNMENT
-- Only use if explicitly needed to revert Stage 1 column additions.
-- NOTE: Does NOT affect core orders columns (id, customer_name, total, etc.)
-- =========================================================================

SET lock_timeout = '2s';

DROP INDEX IF EXISTS public.idx_orders_customer_phone;
DROP INDEX IF EXISTS public.idx_orders_user_id;
DROP INDEX IF EXISTS public.idx_orders_tracking_token;

ALTER TABLE public.orders DROP COLUMN IF EXISTS customer_phone;
ALTER TABLE public.orders DROP COLUMN IF EXISTS customer_email;
ALTER TABLE public.orders DROP COLUMN IF EXISTS user_id;
ALTER TABLE public.orders DROP COLUMN IF EXISTS pickup_code;
ALTER TABLE public.orders DROP COLUMN IF EXISTS payment_method;
ALTER TABLE public.orders DROP COLUMN IF EXISTS payment_status;
ALTER TABLE public.orders DROP COLUMN IF EXISTS assigned_rider_name;
ALTER TABLE public.orders DROP COLUMN IF EXISTS assigned_rider_phone;
ALTER TABLE public.orders DROP COLUMN IF EXISTS assigned_rider_pin;
ALTER TABLE public.orders DROP COLUMN IF EXISTS delivered_at;
ALTER TABLE public.orders DROP COLUMN IF EXISTS cancellation_reason;
ALTER TABLE public.orders DROP COLUMN IF EXISTS tracking_token;

RESET lock_timeout;
