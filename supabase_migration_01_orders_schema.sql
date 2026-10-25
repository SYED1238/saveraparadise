-- =========================================================================
-- SAS CRISPY CHICKEN: STAGE 1 ORDERS SCHEMA ALIGNMENT (DDL ONLY)
-- Safe, metadata-only column additions with lock protection.
-- Copy and run this script in your Supabase Dashboard SQL Editor:
-- https://supabase.com/dashboard/project/jsqpwkgcmcfidtprvhzm/sql/new
-- =========================================================================

-- 1. Safety Guard: Abort if lock cannot be acquired within 2 seconds
-- (Protects live customer checkout from queueing behind DDL)
SET lock_timeout = '2s';

-- 2. Add application-required columns as nullable / safe constant defaults
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_phone TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_email TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS pickup_code TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'Cash on Delivery (COD)';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'Cash on Delivery';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS assigned_rider_name TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS assigned_rider_phone TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS assigned_rider_pin TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivered_at BIGINT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- 3. Add tracking_token column as nullable first (instant catalog-only metadata update)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tracking_token UUID;

-- 4. Set DEFAULT gen_random_uuid() for all subsequent new rows
ALTER TABLE public.orders ALTER COLUMN tracking_token SET DEFAULT gen_random_uuid();

-- 5. Controlled backfill on existing rows (instantaneous on existing records)
UPDATE public.orders 
SET tracking_token = gen_random_uuid() 
WHERE tracking_token IS NULL;

-- 6. Create performance indexes for lookups
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON public.orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON public.orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_tracking_token ON public.orders(tracking_token);

RESET lock_timeout;

-- =========================================================================
-- VERIFICATION CHECK (Will output the 12 added columns and 0 unbackfilled)
-- =========================================================================
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'orders' AND column_name IN (
  'customer_phone', 'customer_email', 'user_id', 'pickup_code', 
  'payment_method', 'payment_status', 'assigned_rider_name', 
  'assigned_rider_phone', 'assigned_rider_pin', 'delivered_at', 
  'cancellation_reason', 'tracking_token'
);
