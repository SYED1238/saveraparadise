-- ========================================================
-- QuickBite Supabase Database Schema & Seed Data
-- ========================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Create Tables
CREATE TABLE IF NOT EXISTS public.categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.dishes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  category_name TEXT,
  price NUMERIC NOT NULL,
  rating TEXT,
  image TEXT NOT NULL,
  badge TEXT,
  time TEXT,
  calories TEXT,
  diet TEXT,
  description TEXT,
  in_stock BOOLEAN DEFAULT TRUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.orders (
  id TEXT PRIMARY KEY,
  created_at BIGINT NOT NULL,
  user_id TEXT,
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  delivery_address TEXT,
  lat NUMERIC,
  lng NUMERIC,
  address_details JSONB,
  payment_method TEXT DEFAULT 'Cash on Delivery (COD)',
  payment_status TEXT DEFAULT 'Cash on Delivery',
  step_index INTEGER DEFAULT 0 NOT NULL,
  status TEXT DEFAULT 'accepted' NOT NULL,
  status_label TEXT DEFAULT 'Accepted' NOT NULL,
  eta TEXT,
  items_summary TEXT,
  items JSONB,
  total TEXT,
  pickup_code TEXT,
  assigned_rider_pin TEXT,
  assigned_rider_name TEXT,
  assigned_rider_phone TEXT,
  assigned_rider_vehicle TEXT,
  claimed_at BIGINT,
  delivered_at BIGINT,
  tracking_token UUID DEFAULT gen_random_uuid(),
  inserted_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Migration safety for existing deployments
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_email TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_phone TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS lat NUMERIC;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS lng NUMERIC;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS address_details JSONB;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'Cash on Delivery (COD)';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'Cash on Delivery';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS pickup_code TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS assigned_rider_pin TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS assigned_rider_name TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS assigned_rider_phone TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS assigned_rider_vehicle TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS claimed_at BIGINT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivered_at BIGINT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS rider_notes TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cash_collected NUMERIC;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS dispatch_time TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tracking_token UUID DEFAULT gen_random_uuid();
CREATE INDEX IF NOT EXISTS idx_orders_tracking_token ON public.orders(tracking_token);

CREATE TABLE IF NOT EXISTS public.user_addresses (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  user_email TEXT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  tag TEXT DEFAULT 'Home',
  flat_no TEXT NOT NULL,
  area TEXT NOT NULL,
  city TEXT,
  pincode TEXT,
  lat NUMERIC,
  lng NUMERIC,
  distance_km NUMERIC,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.store_settings (
  id TEXT PRIMARY KEY,
  settings JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.riders (
  pin TEXT PRIMARY KEY,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  vehicle TEXT DEFAULT '🏍️ Bike',
  status TEXT DEFAULT 'online',
  avatar TEXT DEFAULT '🏍️',
  avatar_img TEXT,
  cash_settled_at BIGINT,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Enable Row Level Security (RLS) & Hardened Security Policies
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;

-- 2.0 Store Settings: Public read-only; admin/service role mutations
DROP POLICY IF EXISTS "public_read_store_settings" ON public.store_settings;
DROP POLICY IF EXISTS "allow_all_store_settings" ON public.store_settings;
DROP POLICY IF EXISTS "admin_manage_store_settings" ON public.store_settings;

CREATE POLICY "public_read_store_settings" ON public.store_settings
  FOR SELECT USING (true);

CREATE POLICY "admin_manage_store_settings" ON public.store_settings
  FOR ALL USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff') OR auth.role() = 'service_role'
  ) WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff') OR auth.role() = 'service_role'
  );

-- 2.1 Categories: Public read-only; mutations allowed for admin/service role
DROP POLICY IF EXISTS "allow_all_categories" ON public.categories;
DROP POLICY IF EXISTS "public_read_categories" ON public.categories;
DROP POLICY IF EXISTS "admin_manage_categories" ON public.categories;

CREATE POLICY "public_read_categories" ON public.categories
  FOR SELECT USING (true);

CREATE POLICY "admin_manage_categories" ON public.categories
  FOR ALL USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff') OR auth.role() = 'service_role'
  ) WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff') OR auth.role() = 'service_role'
  );

-- 2.2 Food Dishes: Public read-only; mutations allowed for admin/service role
DROP POLICY IF EXISTS "allow_all_dishes" ON public.dishes;
DROP POLICY IF EXISTS "public_read_dishes" ON public.dishes;
DROP POLICY IF EXISTS "admin_manage_dishes" ON public.dishes;

CREATE POLICY "public_read_dishes" ON public.dishes
  FOR SELECT USING (true);

CREATE POLICY "admin_manage_dishes" ON public.dishes
  FOR ALL USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff') OR auth.role() = 'service_role'
  ) WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff') OR auth.role() = 'service_role'
  );

-- 2.3 Orders: Anyone can create an order with valid initial status; customer/staff can read; staff/rider can update
DROP POLICY IF EXISTS "allow_all_orders" ON public.orders;
DROP POLICY IF EXISTS "public_create_orders" ON public.orders;
DROP POLICY IF EXISTS "owner_read_orders" ON public.orders;
DROP POLICY IF EXISTS "staff_manage_orders" ON public.orders;
DROP POLICY IF EXISTS "app_read_orders" ON public.orders;
DROP POLICY IF EXISTS "app_update_orders" ON public.orders;
DROP POLICY IF EXISTS "orders_select_owner_or_staff" ON public.orders;
DROP POLICY IF EXISTS "orders_update_staff_only" ON public.orders;

CREATE POLICY "public_create_orders" ON public.orders
  FOR INSERT WITH CHECK (
    (status IS NULL OR status IN ('accepted', 'pending'))
  );

CREATE POLICY "orders_select_owner_or_staff" ON public.orders
  FOR SELECT USING (
    (auth.uid() IS NOT NULL AND auth.uid()::text = user_id)
    OR (auth.jwt() ->> 'email' IS NOT NULL AND LOWER(auth.jwt() ->> 'email') = LOWER(customer_email))
    OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'rider')
    OR auth.role() = 'service_role'
  );

CREATE POLICY "orders_update_staff_only" ON public.orders
  FOR UPDATE USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'rider')
    OR auth.role() = 'service_role'
  ) WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'rider')
    OR auth.role() = 'service_role'
  );

-- 2.3B Riders: Public read; staff/service role manage
DROP POLICY IF EXISTS "allow_all_riders" ON public.riders;
DROP POLICY IF EXISTS "public_read_riders" ON public.riders;
DROP POLICY IF EXISTS "riders_staff_only" ON public.riders;

CREATE POLICY "public_read_riders" ON public.riders
  FOR SELECT USING (true);

CREATE POLICY "riders_staff_only" ON public.riders
  FOR ALL USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'rider')
    OR auth.role() = 'service_role'
  ) WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff')
    OR auth.role() = 'service_role'
  );

-- Secure Single-Rider PIN Verification RPC
CREATE OR REPLACE FUNCTION public.verify_rider_pin(p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
BEGIN
  IF p_pin IS NULL OR length(trim(p_pin)) != 4 THEN
    RETURN NULL;
  END IF;

  SELECT id, name, phone, vehicle, status, avatar, avatar_img, cash_settled_at
  INTO r
  FROM public.riders
  WHERE pin = trim(p_pin)
  LIMIT 1;

  IF r.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN to_jsonb(r);
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_rider_pin(TEXT) TO anon, authenticated;

-- Secure Guest Order Tracking RPC
CREATE OR REPLACE FUNCTION public.track_guest_order(p_order_id TEXT, p_tracking_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result JSONB;
BEGIN
  IF p_order_id IS NULL OR p_tracking_token IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'id', id,
    'created_at', created_at,
    'status', status,
    'status_label', status_label,
    'step_index', step_index,
    'eta', eta,
    'items_summary', items_summary,
    'items', items,
    'total', total,
    'delivery_address', delivery_address,
    'payment_method', payment_method,
    'payment_status', payment_status,
    'pickup_code', pickup_code,
    'assigned_rider_name', assigned_rider_name,
    'assigned_rider_phone', assigned_rider_phone,
    'delivered_at', delivered_at,
    'cancellation_reason', cancellation_reason
  ) INTO result
  FROM public.orders
  WHERE (id = p_order_id OR id = '#' || ltrim(p_order_id, '#'))
    AND tracking_token = p_tracking_token
  LIMIT 1;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.track_guest_order(TEXT, UUID) TO anon, authenticated;

-- Secure Guest Order Cancellation RPC
CREATE OR REPLACE FUNCTION public.cancel_guest_order(p_order_id TEXT, p_tracking_token UUID, p_reason TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  curr_status TEXT;
  rows_updated INT;
BEGIN
  IF p_order_id IS NULL OR p_tracking_token IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT status INTO curr_status
  FROM public.orders
  WHERE (id = p_order_id OR id = '#' || ltrim(p_order_id, '#'))
    AND tracking_token = p_tracking_token;

  IF curr_status IS NULL THEN
    RETURN FALSE;
  END IF;

  IF curr_status NOT IN ('pending', 'accepted') THEN
    RAISE EXCEPTION 'Order cannot be cancelled once kitchen preparation has begun';
  END IF;

  UPDATE public.orders
  SET status = 'cancelled',
      status_label = 'Cancelled',
      step_index = -1,
      cancellation_reason = COALESCE(NULLIF(trim(p_reason), ''), 'Cancelled by customer')
  WHERE (id = p_order_id OR id = '#' || ltrim(p_order_id, '#'))
    AND tracking_token = p_tracking_token;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_guest_order(TEXT, UUID, TEXT) TO anon, authenticated;

-- 2.4 User Addresses: Strictly protect customer PII (names, phones, GPS coordinates)
-- Only the owner or staff can select or mutate user addresses
DROP POLICY IF EXISTS "allow_all_user_addresses" ON public.user_addresses;
DROP POLICY IF EXISTS "owner_manage_user_addresses" ON public.user_addresses;
DROP POLICY IF EXISTS "staff_read_addresses" ON public.user_addresses;

CREATE POLICY "owner_manage_user_addresses" ON public.user_addresses
  FOR ALL USING (
    (auth.uid() IS NOT NULL AND auth.uid()::text = user_id)
    OR (auth.jwt() ->> 'email' IS NOT NULL AND auth.jwt() ->> 'email' = user_email)
    OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'rider')
    OR auth.role() = 'service_role'
  ) WITH CHECK (
    (auth.uid() IS NOT NULL AND auth.uid()::text = user_id)
    OR (auth.jwt() ->> 'email' IS NOT NULL AND auth.jwt() ->> 'email' = user_email)
    OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'rider')
    OR auth.role() = 'service_role'
  );

-- 2.5 Order Immutability Rules: Orders can NEVER be deleted, and once passed any status cannot be reversed
-- Status rank pipeline: pending(0) -> accepted(1) -> cooking(2) -> ready_for_pickup(3) -> on_the_way(4) -> delivered(5)
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

DROP TRIGGER IF EXISTS trg_prevent_order_status_reversal ON public.orders;
CREATE TRIGGER trg_prevent_order_status_reversal
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_order_status_reversal();

CREATE OR REPLACE FUNCTION public.prevent_order_deletion()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Orders cannot be deleted: Orders are permanent financial and audit records.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_order_deletion ON public.orders;
CREATE TRIGGER trg_prevent_order_deletion
  BEFORE DELETE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_order_deletion();

-- 3. Enable Realtime Broadcasting
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.categories;
  EXCEPTION WHEN others THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.dishes;
  EXCEPTION WHEN others THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  EXCEPTION WHEN others THEN NULL;
  END;
END $$;

-- 4. Initial Starter Data
INSERT INTO public.categories (id, name, emoji, slug)
VALUES
  ('cat-biryani', 'Rice & Biryani', '🍚', 'biryani'),
  ('cat-bbq', 'BBQ & Tandoori', '🔥', 'bbq-tandoori'),
  ('cat-seafood', 'Sea Food Dishes', '🦐', 'seafood'),
  ('cat-chinese', 'Chinese Dry', '🥢', 'chinese-dry'),
  ('cat-kebab', 'Kebab Specials', '🍢', 'kabab-spl'),
  ('cat-gravy', 'Chicken Gravies', '🍲', 'chicken-gravy'),
  ('cat-roti', 'Roti & Breads', '🫓', 'roti-items'),
  ('cat-shawarma', 'Shawarma & Rolls', '🌯', 'shawarma-rolls'),
  ('cat-veg', 'Veg Gravy & Dal', '🥗', 'veg-gravy')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, emoji = EXCLUDED.emoji, slug = EXCLUDED.slug;

INSERT INTO public.dishes (id, name, category, category_name, price, rating, image, badge, time, calories, diet, description, in_stock)
VALUES
  ('dish-biryani-rice-2pc-kebab', 'Biryani Rice & 2 Piece Kebab', 'biryani', 'Rice & Biryani', 130, '5.0 (420 reviews)', '/biryani-plate-1.png', '🔥 Value Combo', '10 - 15 mins', '450 kcal', 'Non-Veg', 'Aromatic Biryani rice served with 2 crispy golden fried chicken kebabs.', true),
  ('dish-chicken-biryani-full', 'Chicken Biryani (Full)', 'biryani', 'Rice & Biryani', 210, '5.0 (420 reviews)', '/biryani-plate-2.png', '⭐ Bestseller', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Royal Dum Biryani loaded with tender, spiced chicken pieces and fragrant long-grain Basmati rice.', true),
  ('dish-chicken-biryani-half', 'Chicken Biryani (Half)', 'biryani', 'Rice & Biryani', 170, '5.0 (420 reviews)', '/biryani-plate-2.png', '⭐ Popular', '10 - 15 mins', '450 kcal', 'Non-Veg', 'Single-portion authentic Chicken Dum Biryani cooked with secret spices.', true),
  ('dish-biryani-rice-full', 'Biryani Rice (Full)', 'biryani', 'Rice & Biryani', 95, '5.0 (420 reviews)', '/biryani-plate-1.png', 'Popular', '5 - 10 mins', '450 kcal', 'Non-Veg', 'Full portion of rich, spiced Biryani Kuska rice simmered in chicken broth.', true),
  ('dish-biryani-rice-half', 'Biryani Rice (Half)', 'biryani', 'Rice & Biryani', 82, '5.0 (420 reviews)', '/biryani-plate-1.png', '', '5 - 10 mins', '450 kcal', 'Non-Veg', 'Half portion of aromatic spiced Biryani Kuska rice.', true),
  ('dish-ghee-rice-full', 'Ghee Rice (Full)', 'biryani', 'Rice & Biryani', 89, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1596797038530-2c107229654b?w=500&auto=format&fit=crop&q=80', 'Chef Special', '10 - 12 mins', '450 kcal', 'Veg', 'Fluffy Basmati rice gently sautéed in pure desi ghee with cashews and mild spices.', true),
  ('dish-ghee-rice-half', 'Ghee Rice (Half)', 'biryani', 'Rice & Biryani', 79, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1596797038530-2c107229654b?w=500&auto=format&fit=crop&q=80', '', '8 - 10 mins', '450 kcal', 'Veg', 'Half plate aromatic desi ghee rice.', true),
  ('dish-jeera-rice-full', 'Jeera Rice (Full)', 'biryani', 'Rice & Biryani', 105, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=80', '', '10 - 12 mins', '450 kcal', 'Veg', 'Fragrant cumin-tempered Basmati rice garnished with fresh coriander.', true),
  ('dish-jeera-rice-half', 'Jeera Rice (Half)', 'biryani', 'Rice & Biryani', 89, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=80', '', '8 - 10 mins', '450 kcal', 'Veg', 'Half plate cumin-flavored Basmati rice.', true),
  ('dish-chicken-fried-rice', 'Chicken Fried Rice', 'biryani', 'Rice & Biryani', 170, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1603133872878-684f208fb84b?w=500&auto=format&fit=crop&q=80', 'Wok Special', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Wok-tossed rice with tender shredded chicken, scrambled eggs, and crunchy spring onions.', true),
  ('dish-veg-fried-rice', 'Veg Fried Rice', 'biryani', 'Rice & Biryani', 139, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1645177628172-a94c1f96e6db?w=500&auto=format&fit=crop&q=80', '', '10 - 12 mins', '450 kcal', 'Veg', 'Garden fresh carrots, beans, and capsicum tossed with aromatic rice in Chinese wok style.', true),
  ('dish-egg-fried-rice', 'Egg Fried Rice', 'biryani', 'Rice & Biryani', 139, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=500&auto=format&fit=crop&q=80', '', '10 - 12 mins', '450 kcal', 'Egg', 'Classic Indo-Chinese fried rice stir-fried with fluffy scrambled eggs and mild peppers.', true),
  ('dish-tandoori-chicken-full', 'Tandoori Chicken (Full)', 'bbq-tandoori', 'BBQ & Tandoori', 499, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=500&auto=format&fit=crop&q=80', '🔥 Charcoal Grilled', '20 - 25 mins', '450 kcal', 'Non-Veg', 'Whole chicken marinated overnight in spiced yogurt, charred to smoky perfection in clay tandoor.', true),
  ('dish-tandoori-chicken-half', 'Tandoori Chicken (Half)', 'bbq-tandoori', 'BBQ & Tandoori', 249, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=500&auto=format&fit=crop&q=80', 'Popular', '18 - 20 mins', '450 kcal', 'Non-Veg', 'Half portion of authentic charcoal roasted tandoori chicken served with mint chutney.', true),
  ('dish-grilled-chicken-full', 'Grilled Chicken (Full) (Starts 3 PM)', 'bbq-tandoori', 'BBQ & Tandoori', 499, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1532550907401-a500c9a57435?w=500&auto=format&fit=crop&q=80', '⏰ Starts 3 PM', '20 - 25 mins', '450 kcal', 'Non-Veg', 'Juicy Arabian-spiced whole chicken slow grilled on rotisserie skewers.', true),
  ('dish-grilled-chicken-half', 'Grilled Chicken (Half) (Starts 3 PM)', 'bbq-tandoori', 'BBQ & Tandoori', 249, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1532550907401-a500c9a57435?w=500&auto=format&fit=crop&q=80', '⏰ Starts 3 PM', '18 - 20 mins', '450 kcal', 'Non-Veg', 'Half portion rotisserie chicken spiced with garlic, pepper, and herbs.', true),
  ('dish-alfaham-chicken-full', 'Alfaham Chicken (Full)', 'bbq-tandoori', 'BBQ & Tandoori', 499, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1544025162-d76694265947?w=500&auto=format&fit=crop&q=80', '⭐ Arabian Legend', '20 - 25 mins', '450 kcal', 'Non-Veg', 'Authentic Arabian charcoal grilled chicken basted with lemon, green chilies, and Gulf spices.', true),
  ('dish-alfaham-chicken-half', 'Alfaham Chicken (Half)', 'bbq-tandoori', 'BBQ & Tandoori', 249, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1544025162-d76694265947?w=500&auto=format&fit=crop&q=80', 'Popular', '18 - 20 mins', '450 kcal', 'Non-Veg', 'Half plate smoky charcoal-cooked Arabian Alfaham chicken.', true),
  ('dish-hariyali-kebab-full', 'Hariyali Kebab (Full)', 'bbq-tandoori', 'BBQ & Tandoori', 249, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=500&auto=format&fit=crop&q=80', '', '15 - 18 mins', '450 kcal', 'Non-Veg', 'Boneless chicken chunks marinated in mint, coriander, and green chili pesto, grilled in tandoor.', true),
  ('dish-hariyali-kebab-half', 'Hariyali Kebab (Half)', 'bbq-tandoori', 'BBQ & Tandoori', 140, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=500&auto=format&fit=crop&q=80', '', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Half portion green herb chicken kebabs.', true),
  ('dish-kalmi-kebab', 'Kalmi Kebab', 'bbq-tandoori', 'BBQ & Tandoori', 95, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=500&auto=format&fit=crop&q=80', 'Mughlai', '15 - 18 mins', '450 kcal', 'Non-Veg', 'Succulent chicken drumstick marinated in creamy cashew, cardamom, and saffron marinade.', true),
  ('dish-chicken-tikka-full', 'Chicken Tikka (Full)', 'bbq-tandoori', 'BBQ & Tandoori', 249, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=500&auto=format&fit=crop&q=80', 'Classic', '15 - 18 mins', '450 kcal', 'Non-Veg', 'Boneless chicken cubes skewers roasted red hot with Kashmiri chili and mustard oil.', true),
  ('dish-chicken-tikka-half', 'Chicken Tikka (Half)', 'bbq-tandoori', 'BBQ & Tandoori', 140, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=500&auto=format&fit=crop&q=80', '', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Half portion of authentic charcoal grilled chicken tikka.', true),
  ('dish-malai-tikka-full', 'Malai Tikka (Full)', 'bbq-tandoori', 'BBQ & Tandoori', 249, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=500&auto=format&fit=crop&q=80', 'Creamy', '15 - 18 mins', '450 kcal', 'Non-Veg', 'Melt-in-mouth chicken pieces steeped in cream, cheese, white pepper, and green cardamom.', true),
  ('dish-malai-tikka-half', 'Malai Tikka (Half)', 'bbq-tandoori', 'BBQ & Tandoori', 140, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=500&auto=format&fit=crop&q=80', '', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Half plate rich and silky cream malai tikka.', true),
  ('dish-hyderabadi-kebab-full', 'Hyderabadi Kebab (Full)', 'bbq-tandoori', 'BBQ & Tandoori', 249, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=500&auto=format&fit=crop&q=80', 'Spicy', '15 - 18 mins', '450 kcal', 'Non-Veg', 'Deccan spiced fiery tandoori chicken kebab infused with roasted spices.', true),
  ('dish-hyderabadi-kebab-half', 'Hyderabadi Kebab (Half)', 'bbq-tandoori', 'BBQ & Tandoori', 140, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=500&auto=format&fit=crop&q=80', '', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Half portion spicy Hyderabadi kebab.', true),
  ('dish-tandoori-kebab-full', 'Tandoori Kebab (Full)', 'bbq-tandoori', 'BBQ & Tandoori', 249, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=500&auto=format&fit=crop&q=80', '', '15 - 18 mins', '450 kcal', 'Non-Veg', 'Full plate roasted chicken kebabs straight from the clay pit.', true),
  ('dish-tandoori-kebab-half', 'Tandoori Kebab (Half)', 'bbq-tandoori', 'BBQ & Tandoori', 140, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=500&auto=format&fit=crop&q=80', '', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Half plate roasted chicken kebabs.', true),
  ('dish-tandoori-masala-full', 'Tandoori Masala (Full)', 'bbq-tandoori', 'BBQ & Tandoori', 540, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80', 'Signature', '20 - 25 mins', '450 kcal', 'Non-Veg', 'Charcoal grilled tandoori chicken simmered in rich, buttery, spiced tomato gravy.', true),
  ('dish-tandoori-masala-half', 'Tandoori Masala (Half)', 'bbq-tandoori', 'BBQ & Tandoori', 290, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80', '', '18 - 20 mins', '450 kcal', 'Non-Veg', 'Half plate smoky tandoori chicken in spicy gravy.', true),
  ('dish-teetar-kebab', 'Teetar Kebab', 'bbq-tandoori', 'BBQ & Tandoori', 170, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=500&auto=format&fit=crop&q=80', 'Exotic', '15 - 20 mins', '450 kcal', 'Non-Veg', 'Marinated quail meat roasted over glowing coal embers.', true),
  ('dish-prawns-pepper-dry', 'Prawns Pepper Dry', 'seafood', 'Sea Food Dishes', 370, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1559737558-245ff29d2b27?w=500&auto=format&fit=crop&q=80', '⭐ Chef Special', '15 - 18 mins', '450 kcal', 'Seafood', 'Juicy sea prawns tossed with crushed Malabar black pepper, curry leaves, and browned onions.', true),
  ('dish-prawns-dry', 'Prawns Dry', 'seafood', 'Sea Food Dishes', 370, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1559737558-245ff29d2b27?w=500&auto=format&fit=crop&q=80', '', '15 - 18 mins', '450 kcal', 'Seafood', 'Crisp pan-fried fresh prawns coated with coastal spices.', true),
  ('dish-prawns-chilli', 'Prawns Chilli', 'seafood', 'Sea Food Dishes', 370, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1559737558-245ff29d2b27?w=500&auto=format&fit=crop&q=80', 'Spicy', '15 - 18 mins', '450 kcal', 'Seafood', 'Wok-fried prawns tossed in spicy soya sauce, fresh green chilies, and bell peppers.', true),
  ('dish-prawns-kabab', 'Prawns Kabab', 'seafood', 'Sea Food Dishes', 370, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1559737558-245ff29d2b27?w=500&auto=format&fit=crop&q=80', '', '15 - 18 mins', '450 kcal', 'Seafood', 'Crispy battered and deep-fried succulent prawns sprinkled with chaat masala.', true),
  ('dish-prawns-masala', 'Prawns Masala', 'seafood', 'Sea Food Dishes', 370, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1559737558-245ff29d2b27?w=500&auto=format&fit=crop&q=80', 'Gravy', '18 - 20 mins', '450 kcal', 'Seafood', 'Tender prawns cooked in a rich, tangy onion-tomato gravy with aromatic coastal spices.', true),
  ('dish-fish-masala', 'Fish Masala', 'seafood', 'Sea Food Dishes', 250, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=500&auto=format&fit=crop&q=80', 'Popular', '15 - 18 mins', '450 kcal', 'Seafood', 'Fresh fish steaks simmered in traditional spiced curry gravy.', true),
  ('dish-fish-tikka', 'Fish Tikka', 'seafood', 'Sea Food Dishes', 250, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=500&auto=format&fit=crop&q=80', 'Tandoori', '15 - 18 mins', '450 kcal', 'Seafood', 'Boneless fish cubes marinated in ajwain, yogurt, and chili, roasted in clay tandoor.', true),
  ('dish-chilli-fish', 'Chilli Fish', 'seafood', 'Sea Food Dishes', 250, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=500&auto=format&fit=crop&q=80', 'Indo-Chinese', '12 - 15 mins', '450 kcal', 'Seafood', 'Crispy batter-fried fish tossed with dark soy, garlic, and hot green peppers.', true),
  ('dish-apolo-fish', 'Apolo Fish', 'seafood', 'Sea Food Dishes', 250, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=500&auto=format&fit=crop&q=80', 'Hyderabadi', '15 - 18 mins', '450 kcal', 'Seafood', 'Boneless fish tossed in spicy yogurt, curry leaves, ginger, and South Indian spices.', true),
  ('dish-teetar-pepper-dry', 'Teetar Pepper Dry', 'seafood', 'Sea Food Dishes', 150, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=500&auto=format&fit=crop&q=80', 'Specialty', '15 - 18 mins', '450 kcal', 'Non-Veg', 'Quail pieces pan-roasted with fresh crushed black pepper and onions.', true),
  ('dish-special-noori-chicken', 'Special Noori Chicken', 'chinese-dry', 'Chinese Dry', 380, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1563245372-f21724e3856d?w=500&auto=format&fit=crop&q=80', '👑 House Special', '15 - 18 mins', '450 kcal', 'Non-Veg', 'Signature house specialty chicken tossed in secret spicy rich red sauce with garlic crunch.', true),
  ('dish-chicken-manchurian-full', 'Chicken Manchurian (Full)', 'chinese-dry', 'Chinese Dry', 260, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80', 'Popular', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Crispy fried chicken balls tossed in garlic, ginger, and tangy soya Manchurian glaze.', true),
  ('dish-chicken-manchurian-half', 'Chicken Manchurian (Half)', 'chinese-dry', 'Chinese Dry', 199, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80', '', '10 - 12 mins', '450 kcal', 'Non-Veg', 'Half portion of classic Indo-Chinese Chicken Manchurian.', true),
  ('dish-chilli-chicken-full', 'Chilli Chicken (Full)', 'chinese-dry', 'Chinese Dry', 260, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80', '🔥 Spicy', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Deep-fried chicken chunks stir-fried with capsicum, onions, and hot green chillies.', true),
  ('dish-chilli-chicken-half', 'Chilli Chicken (Half)', 'chinese-dry', 'Chinese Dry', 199, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80', '', '10 - 12 mins', '450 kcal', 'Non-Veg', 'Half portion of spicy wok-tossed Chilli Chicken.', true),
  ('dish-chicken-65-full', 'Chicken 65 (Full)', 'chinese-dry', 'Chinese Dry', 260, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1563245372-f21724e3856d?w=500&auto=format&fit=crop&q=80', '⭐ All-Time Fav', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Crispy chicken morsels tempered with fiery curry leaves, slit chillies, and garlic.', true),
  ('dish-chicken-65-half', 'Chicken 65 (Half)', 'chinese-dry', 'Chinese Dry', 199, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1563245372-f21724e3856d?w=500&auto=format&fit=crop&q=80', '', '10 - 12 mins', '450 kcal', 'Non-Veg', 'Half portion of crunchy Chicken 65.', true),
  ('dish-chicken-lollipop-full', 'Chicken Lollipop (Full)', 'chinese-dry', 'Chinese Dry', 260, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1562967914-608f82629710?w=500&auto=format&fit=crop&q=80', 'Crispy', '15 - 18 mins', '450 kcal', 'Non-Veg', 'Frenched chicken winglets deep-fried with crunchy batter, served with spicy Schezwan dip.', true),
  ('dish-chicken-lollipop-half', 'Chicken Lollipop (Half)', 'chinese-dry', 'Chinese Dry', 199, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1562967914-608f82629710?w=500&auto=format&fit=crop&q=80', '', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Half plate crispy chicken wing lollipops.', true),
  ('dish-pepper-chicken-full', 'Pepper Chicken (Full)', 'chinese-dry', 'Chinese Dry', 260, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80', '', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Chicken sautéed in fresh crushed black pepper, onions, and aromatic herbs.', true),
  ('dish-pepper-chicken-half', 'Pepper Chicken (Half)', 'chinese-dry', 'Chinese Dry', 199, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80', '', '10 - 12 mins', '450 kcal', 'Non-Veg', 'Half portion of peppery chicken dry.', true),
  ('dish-schezwan-chicken-full', 'Schezwan Chicken (Full)', 'chinese-dry', 'Chinese Dry', 260, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1563245372-f21724e3856d?w=500&auto=format&fit=crop&q=80', 'Hot', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Wok-fried chicken in spicy, pungent Schezwan sauce with celery and red peppers.', true),
  ('dish-schezwan-chicken-half', 'Schezwan Chicken (Half)', 'chinese-dry', 'Chinese Dry', 199, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1563245372-f21724e3856d?w=500&auto=format&fit=crop&q=80', '', '10 - 12 mins', '450 kcal', 'Non-Veg', 'Half portion of hot Schezwan chicken.', true),
  ('dish-lemon-chicken-full', 'Lemon Chicken (Full)', 'chinese-dry', 'Chinese Dry', 260, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80', 'Tangy', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Crispy chicken glazed in a zesty, sweet and sour lemon sauce.', true),
  ('dish-lemon-chicken-half', 'Lemon Chicken (Half)', 'chinese-dry', 'Chinese Dry', 199, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80', '', '10 - 12 mins', '450 kcal', 'Non-Veg', 'Half plate tangy lemon chicken.', true),
  ('dish-chicken-555-full', 'Chicken 555 (Full)', 'chinese-dry', 'Chinese Dry', 260, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1563245372-f21724e3856d?w=500&auto=format&fit=crop&q=80', 'Specialty', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Crispy chicken strips coated with spicy Andhra masala, garlic, and mint.', true),
  ('dish-chicken-555-half', 'Chicken 555 (Half)', 'chinese-dry', 'Chinese Dry', 199, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1563245372-f21724e3856d?w=500&auto=format&fit=crop&q=80', '', '10 - 12 mins', '450 kcal', 'Non-Veg', 'Half plate spicy Chicken 555.', true),
  ('dish-chicken-pepper-dry-full', 'Chicken Pepper Dry (Full)', 'chinese-dry', 'Chinese Dry', 260, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80', '', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Dry roasted chicken tossed in roasted pepper and onion tempering.', true),
  ('dish-chicken-pepper-dry-half', 'Chicken Pepper Dry (Half)', 'chinese-dry', 'Chinese Dry', 199, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80', '', '10 - 12 mins', '450 kcal', 'Non-Veg', 'Half portion of chicken pepper dry.', true),
  ('dish-chicken-kebab-full', 'Chicken Kebab (Full)', 'kabab-spl', 'Kebab Specials', 220, '5.0 (420 reviews)', '/api/r2-image?key=categories%2FGemini_Generated_Image_cd6g2ncd6g2ncd6g-removebg-preview.png', '⭐ Crowd Favorite', '10 - 15 mins', '450 kcal', 'Non-Veg', 'Crispy, juicy red fried chicken kebab seasoned with traditional spices.', true),
  ('dish-chicken-kebab-half', 'Chicken Kebab (Half)', 'kabab-spl', 'Kebab Specials', 145, '5.0 (420 reviews)', '/api/r2-image?key=categories%2FGemini_Generated_Image_cd6g2ncd6g2ncd6g-removebg-preview.png', '', '8 - 12 mins', '450 kcal', 'Non-Veg', 'Half plate crisp fried chicken kebab.', true),
  ('dish-green-kebab-full', 'Green Kebab (Full)', 'kabab-spl', 'Kebab Specials', 220, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=500&auto=format&fit=crop&q=80', 'Herb Spiced', '10 - 15 mins', '450 kcal', 'Non-Veg', 'Golden fried chicken kebab coated in mint, coriander, and green chilli marinade.', true),
  ('dish-green-kebab-half', 'Green Kebab (Half)', 'kabab-spl', 'Kebab Specials', 145, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=500&auto=format&fit=crop&q=80', '', '8 - 12 mins', '450 kcal', 'Non-Veg', 'Half plate crispy green herb chicken kebab.', true),
  ('dish-yellow-kebab-full', 'Yellow Kebab (Full)', 'kabab-spl', 'Kebab Specials', 220, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=500&auto=format&fit=crop&q=80', 'Mild', '10 - 15 mins', '450 kcal', 'Non-Veg', 'Tender fried chicken kebab marinated with turmeric, ginger, and garlic.', true),
  ('dish-yellow-kebab-half', 'Yellow Kebab (Half)', 'kabab-spl', 'Kebab Specials', 145, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=500&auto=format&fit=crop&q=80', '', '8 - 12 mins', '450 kcal', 'Non-Veg', 'Half plate crispy yellow spiced chicken kebab.', true),
  ('dish-fish-kebab', 'Fish Kebab', 'kabab-spl', 'Kebab Specials', 240, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=500&auto=format&fit=crop&q=80', 'Seafood', '12 - 15 mins', '450 kcal', 'Seafood', 'Fresh fish cutlets seasoned with spices and deep-fried to golden perfection.', true),
  ('dish-drumstick-chicken-3pcs', 'Drumstick Chicken (3 Pieces)', 'kabab-spl', 'Kebab Specials', 130, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1562967914-608f82629710?w=500&auto=format&fit=crop&q=80', 'Value 3-Pack', '10 - 12 mins', '450 kcal', 'Non-Veg', '3 juicy, tender fried chicken drumsticks seasoned in authentic spices.', true),
  ('dish-chicken-stick-green', 'Chicken Stick Green', 'kabab-spl', 'Kebab Specials', 85, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=500&auto=format&fit=crop&q=80', 'Skewered', '8 - 10 mins', '450 kcal', 'Non-Veg', 'Skewered boneless chicken chunks marinated in mint-coriander paste.', true),
  ('dish-chicken-stick-red', 'Chicken Stick Red', 'kabab-spl', 'Kebab Specials', 85, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=500&auto=format&fit=crop&q=80', 'Skewered', '8 - 10 mins', '450 kcal', 'Non-Veg', 'Spicy red masala boneless chicken skewer fried crisp.', true),
  ('dish-chicken-stick-yellow', 'Chicken Stick Yellow', 'kabab-spl', 'Kebab Specials', 85, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=500&auto=format&fit=crop&q=80', 'Skewered', '8 - 10 mins', '450 kcal', 'Non-Veg', 'Mild yellow-spiced boneless chicken skewer.', true),
  ('dish-chicken-chinese-stick', 'Chicken Chinese Stick', 'kabab-spl', 'Kebab Specials', 99, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80', 'Indo-Chinese', '8 - 10 mins', '450 kcal', 'Non-Veg', 'Soya-garlic glazed chicken cubes on skewers.', true),
  ('dish-chicken-leg-piece', 'Chicken Leg Piece', 'kabab-spl', 'Kebab Specials', 115, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=500&auto=format&fit=crop&q=80', 'Single', '10 - 12 mins', '450 kcal', 'Non-Veg', 'Single jumbo chicken leg piece marinated and deep-fried crisp.', true),
  ('dish-chicken-wings', 'Chicken Wings', 'kabab-spl', 'Kebab Specials', 85, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1562967914-608f82629710?w=500&auto=format&fit=crop&q=80', 'Crispy', '8 - 10 mins', '450 kcal', 'Non-Veg', 'Golden fried seasoned chicken wings with crunchy skin.', true),
  ('dish-butter-chicken-full', 'Butter Chicken (Full)', 'chicken-gravy', 'Chicken Gravies', 259, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80', '⭐ All-Time Best', '15 - 18 mins', '450 kcal', 'Non-Veg', 'Tandoori chicken pieces in a silky, creamy tomato and butter makhani gravy.', true),
  ('dish-butter-chicken-half', 'Butter Chicken (Half)', 'chicken-gravy', 'Chicken Gravies', 179, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80', '', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Half portion of rich Butter Chicken.', true),
  ('dish-methi-chicken-full', 'Methi Chicken (Full)', 'chicken-gravy', 'Chicken Gravies', 259, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80', 'Aromatic', '15 - 18 mins', '450 kcal', 'Non-Veg', 'Chicken simmered in fragrant fenugreek leaves and spiced onion gravy.', true),
  ('dish-methi-chicken-half', 'Methi Chicken (Half)', 'chicken-gravy', 'Chicken Gravies', 179, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80', '', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Half plate fragrant methi chicken curry.', true),
  ('dish-chicken-masala-full', 'Chicken Masala (Full)', 'chicken-gravy', 'Chicken Gravies', 259, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80', 'Dhaba Style', '15 - 18 mins', '450 kcal', 'Non-Veg', 'Homestyle rich chicken curry cooked with roasted whole spices and onions.', true),
  ('dish-chicken-masala-half', 'Chicken Masala (Half)', 'chicken-gravy', 'Chicken Gravies', 179, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80', '', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Half plate Dhaba style chicken masala.', true),
  ('dish-kadai-chicken-full', 'Kadai Chicken (Full)', 'chicken-gravy', 'Chicken Gravies', 259, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80', 'Spicy', '15 - 18 mins', '450 kcal', 'Non-Veg', 'Chicken cooked in an iron wok with freshly ground coriander seeds and bell peppers.', true),
  ('dish-kadai-chicken-half', 'Kadai Chicken (Half)', 'chicken-gravy', 'Chicken Gravies', 179, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80', '', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Half plate Kadai Chicken with bell peppers.', true),
  ('dish-chicken-hyderabadi-full', 'Chicken Hyderabadi (Full)', 'chicken-gravy', 'Chicken Gravies', 259, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80', 'Royal', '15 - 18 mins', '450 kcal', 'Non-Veg', 'Nizami special chicken curry cooked with fried onions, coconut, and yogurt.', true),
  ('dish-chicken-hyderabadi-half', 'Chicken Hyderabadi (Half)', 'chicken-gravy', 'Chicken Gravies', 179, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80', '', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Half plate Hyderabadi chicken gravy.', true),
  ('dish-chicken-kolhapuri-full', 'Chicken Kolhapuri (Full)', 'chicken-gravy', 'Chicken Gravies', 259, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80', 'Extra Hot', '15 - 18 mins', '450 kcal', 'Non-Veg', 'Fiery Maharashtrian chicken curry with dry coconut, sesame, and red chillies.', true),
  ('dish-chicken-kolhapuri-half', 'Chicken Kolhapuri (Half)', 'chicken-gravy', 'Chicken Gravies', 179, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80', '', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Half plate spicy Kolhapuri chicken curry.', true),
  ('dish-chicken-kali-mirchi-full', 'Chicken Kali Mirchi (Full)', 'chicken-gravy', 'Chicken Gravies', 259, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80', 'Peppery', '15 - 18 mins', '450 kcal', 'Non-Veg', 'Chicken in a rich cashew gravy loaded with freshly crushed black peppercorns.', true),
  ('dish-chicken-kali-mirchi-half', 'Chicken Kali Mirchi (Half)', 'chicken-gravy', 'Chicken Gravies', 179, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80', '', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Half plate black pepper chicken gravy.', true),
  ('dish-chicken-mowgli-full', 'Chicken Mowgli (Full)', 'chicken-gravy', 'Chicken Gravies', 259, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80', 'Specialty', '15 - 18 mins', '450 kcal', 'Non-Veg', 'Chef''s signature spicy rustic chicken curry with bold rustic flavors.', true),
  ('dish-chicken-mowgli-half', 'Chicken Mowgli (Half)', 'chicken-gravy', 'Chicken Gravies', 179, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80', '', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Half plate Chicken Mowgli.', true),
  ('dish-chicken-kurma-full', 'Chicken Kurma (Full)', 'chicken-gravy', 'Chicken Gravies', 259, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80', 'Mild', '15 - 18 mins', '450 kcal', 'Non-Veg', 'Traditional South Indian kurma prepared with coconut paste and poppy seeds.', true),
  ('dish-chicken-kurma-half', 'Chicken Kurma (Half)', 'chicken-gravy', 'Chicken Gravies', 179, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80', '', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Half plate coconut chicken kurma.', true),
  ('dish-chicken-kassa-full', 'Chicken Kassa (Full)', 'chicken-gravy', 'Chicken Gravies', 259, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80', 'Semi-Dry', '15 - 18 mins', '450 kcal', 'Non-Veg', 'Slow-roasted chicken in a rich, thick, deeply caramelized onion and ginger-garlic reduction.', true),
  ('dish-chicken-kassa-half', 'Chicken Kassa (Half)', 'chicken-gravy', 'Chicken Gravies', 179, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80', '', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Half plate thick roasted chicken kassa.', true),
  ('dish-chicken-hyderabadi-gravy-full', 'Chicken Hyderabadi Gravy (Full)', 'chicken-gravy', 'Chicken Gravies', 259, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80', 'Spicy', '15 - 18 mins', '450 kcal', 'Non-Veg', 'Rich green chili and mint Hyderabadi style spicy chicken curry.', true),
  ('dish-chicken-hyderabadi-gravy-half', 'Chicken Hyderabadi Gravy (Half)', 'chicken-gravy', 'Chicken Gravies', 179, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=500&auto=format&fit=crop&q=80', '', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Half plate Hyderabadi style chicken gravy.', true),
  ('dish-ceylon-parota', 'Ceylon Parota', 'roti-items', 'Roti & Breads', 40, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=500&auto=format&fit=crop&q=80', 'Layered', '5 - 8 mins', '450 kcal', 'Veg', 'Crispy, flaky square layered parota rolled and pan-fried.', true),
  ('dish-kerala-parota', 'Kerala Parota', 'roti-items', 'Roti & Breads', 40, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=500&auto=format&fit=crop&q=80', '⭐ Malabar', '5 - 8 mins', '450 kcal', 'Veg', 'Traditional Malabar layered flaky flatbread, soft inside and crisp outside.', true),
  ('dish-roomali-roti', 'Roomali Roti', 'roti-items', 'Roti & Breads', 40, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=500&auto=format&fit=crop&q=80', 'Handkerchief Soft', '5 - 8 mins', '450 kcal', 'Veg', 'Ultra thin, soft flatbread stretched and cooked over an inverted wok.', true),
  ('dish-tandoori-roti', 'Tandoori Roti', 'roti-items', 'Roti & Breads', 45, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=500&auto=format&fit=crop&q=80', 'Whole Wheat', '5 - 8 mins', '450 kcal', 'Veg', 'Whole wheat bread baked crisp on clay tandoor walls.', true),
  ('dish-tandoori-butter-roti', 'Tandoori Butter Roti', 'roti-items', 'Roti & Breads', 54, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=500&auto=format&fit=crop&q=80', 'Buttery', '5 - 8 mins', '450 kcal', 'Veg', 'Hot tandoori wheat roti brushed generously with melted butter.', true),
  ('dish-butter-kulcha', 'Butter Kulcha', 'roti-items', 'Roti & Breads', 55, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=500&auto=format&fit=crop&q=80', 'Soft', '5 - 8 mins', '450 kcal', 'Veg', 'Soft leavened flatbread topped with black sesame and melted butter.', true),
  ('dish-kulcha', 'Kulcha', 'roti-items', 'Roti & Breads', 50, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=500&auto=format&fit=crop&q=80', '', '5 - 8 mins', '450 kcal', 'Veg', 'Classic oven-baked leavened bread.', true),
  ('dish-butter-naan', 'Butter Naan', 'roti-items', 'Roti & Breads', 50, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=500&auto=format&fit=crop&q=80', '⭐ Favorite', '5 - 8 mins', '450 kcal', 'Veg', 'Pillow-soft tandoori naan glazed with rich melted dairy butter.', true),
  ('dish-naan', 'Naan', 'roti-items', 'Roti & Breads', 45, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=500&auto=format&fit=crop&q=80', 'Plain', '5 - 8 mins', '450 kcal', 'Veg', 'Traditional clay-oven baked plain naan.', true),
  ('dish-garlic-naan', 'Garlic Naan', 'roti-items', 'Roti & Breads', 50, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=500&auto=format&fit=crop&q=80', 'Garlic Butter', '5 - 8 mins', '450 kcal', 'Veg', 'Tandoori naan infused with minced garlic and coriander, topped with butter.', true),
  ('dish-shawarma-special-roll', 'Shawarma Special Roll (Starts 5 PM)', 'shawarma-rolls', 'Shawarma & Rolls', 150, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1529006557810-274b9b2fc783?w=500&auto=format&fit=crop&q=80', '🔥 Loaded (Starts 5 PM)', '8 - 10 mins', '450 kcal', 'Non-Veg', 'Loaded with extra shredded rotisserie chicken, garlic toum, pickles, and french fries.', true),
  ('dish-shawarma-roll', 'Shawarma Roll (Starts 5 PM)', 'shawarma-rolls', 'Shawarma & Rolls', 130, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1529006557810-274b9b2fc783?w=500&auto=format&fit=crop&q=80', '⭐ Classic (Starts 5 PM)', '8 - 10 mins', '450 kcal', 'Non-Veg', 'Juicy Arabian chicken shawarma wrapped in warm rumali with creamy garlic sauce.', true),
  ('dish-shawarma-plate', 'Shawarma Plate (Starts 5 PM)', 'shawarma-rolls', 'Shawarma & Rolls', 199, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1529006557810-274b9b2fc783?w=500&auto=format&fit=crop&q=80', 'Platter (Starts 5 PM)', '10 - 12 mins', '450 kcal', 'Non-Veg', 'Generous mound of rotisserie chicken shavings served with rumali roti, fries, salad, and garlic sauce.', true),
  ('dish-jumbo-shawarma', 'Jumbo Shawarma (Starts 5 PM)', 'shawarma-rolls', 'Shawarma & Rolls', 199, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1529006557810-274b9b2fc783?w=500&auto=format&fit=crop&q=80', 'XL Size (Starts 5 PM)', '10 - 12 mins', '450 kcal', 'Non-Veg', 'Extra large double-wrapped chicken shawarma with cheese and special dressing.', true),
  ('dish-veg-noodles', 'Veg Noodles', 'shawarma-rolls', 'Shawarma & Rolls', 155, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1585032226651-759b368d7246?w=500&auto=format&fit=crop&q=80', 'Wok Tossed', '10 - 12 mins', '450 kcal', 'Veg', 'Hakka noodles wok-tossed with shredded cabbage, carrots, bell peppers, and soy.', true),
  ('dish-chicken-noodles', 'Chicken Noodles', 'shawarma-rolls', 'Shawarma & Rolls', 195, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1585032226651-759b368d7246?w=500&auto=format&fit=crop&q=80', 'Popular', '12 - 15 mins', '450 kcal', 'Non-Veg', 'Stir-fried noodles loaded with shredded tender chicken and vegetables.', true),
  ('dish-egg-noodles', 'Egg Noodles', 'shawarma-rolls', 'Shawarma & Rolls', 175, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1585032226651-759b368d7246?w=500&auto=format&fit=crop&q=80', '', '10 - 12 mins', '450 kcal', 'Egg', 'Wok-fried noodles with scrambled egg ribbons and fresh green onions.', true),
  ('dish-chicken-samosa', 'Chicken Samosa', 'shawarma-rolls', 'Shawarma & Rolls', 30, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=500&auto=format&fit=crop&q=80', 'Snack', '5 mins', '450 kcal', 'Non-Veg', 'Crispy triangular pastry stuffed with spicy minced chicken filling.', true),
  ('dish-veg-samosa', 'Veg Samosa', 'shawarma-rolls', 'Shawarma & Rolls', 30, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=500&auto=format&fit=crop&q=80', 'Snack', '5 mins', '450 kcal', 'Veg', 'Golden crust samosa filled with spiced potato and green peas mash.', true),
  ('dish-paneer-butter-masala', 'Paneer Butter Masala', 'veg-gravy', 'Veg Gravy & Dal', 190, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=500&auto=format&fit=crop&q=80', '⭐ Veg Best', '12 - 15 mins', '450 kcal', 'Veg', 'Soft cottage cheese cubes in a creamy, velvety tomato and butter makhani gravy.', true),
  ('dish-palak-paneer', 'Palak Paneer', 'veg-gravy', 'Veg Gravy & Dal', 190, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1613292443284-8d10ef9383fe?w=500&auto=format&fit=crop&q=80', 'Healthy', '12 - 15 mins', '450 kcal', 'Veg', 'Fresh cottage cheese simmered in a spiced spinach puree with garlic and ginger.', true),
  ('dish-paneer-65', 'Paneer 65', 'veg-gravy', 'Veg Gravy & Dal', 190, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=500&auto=format&fit=crop&q=80', 'Crispy', '10 - 12 mins', '450 kcal', 'Veg', 'Crispy batter-fried paneer cubes tossed with curry leaves, curd, and red chillies.', true),
  ('dish-paneer-pepper-dry', 'Paneer Pepper Dry', 'veg-gravy', 'Veg Gravy & Dal', 190, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=500&auto=format&fit=crop&q=80', 'Peppery', '10 - 12 mins', '450 kcal', 'Veg', 'Cottage cheese pieces sautéed with crushed black pepper, onions, and curry leaves.', true),
  ('dish-chilli-paneer', 'Chilli Paneer', 'veg-gravy', 'Veg Gravy & Dal', 190, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1563245372-f21724e3856d?w=500&auto=format&fit=crop&q=80', 'Indo-Chinese', '12 - 15 mins', '450 kcal', 'Veg', 'Wok-fried paneer cubes in spicy dark soy sauce with crunchy green peppers.', true),
  ('dish-kaddi-paneer', 'Kadai Paneer', 'veg-gravy', 'Veg Gravy & Dal', 190, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=500&auto=format&fit=crop&q=80', 'Wok Special', '12 - 15 mins', '450 kcal', 'Veg', 'Paneer cubes cooked with freshly pounded kadai coriander spices, capsicum, and tomato.', true),
  ('dish-paneer-manchurian', 'Paneer Manchurian', 'veg-gravy', 'Veg Gravy & Dal', 190, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1525755662778-989d0524087e?w=500&auto=format&fit=crop&q=80', '', '10 - 12 mins', '450 kcal', 'Veg', 'Crispy paneer tossed in ginger, garlic, spring onion, and tangy soya Manchurian glaze.', true),
  ('dish-mushroom-masala', 'Mushroom Masala', 'veg-gravy', 'Veg Gravy & Dal', 190, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=80', '', '12 - 15 mins', '450 kcal', 'Veg', 'Fresh button mushrooms simmered in a spiced onion, tomato, and cashew gravy.', true),
  ('dish-mushroom-manchurian', 'Mushroom Manchurian', 'veg-gravy', 'Veg Gravy & Dal', 190, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=80', '', '10 - 12 mins', '450 kcal', 'Veg', 'Crispy batter-fried button mushrooms glazed with savoury Manchurian sauce.', true),
  ('dish-mushroom-pepper-dry', 'Mushroom Pepper Dry', 'veg-gravy', 'Veg Gravy & Dal', 190, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=80', 'Dry', '10 - 12 mins', '450 kcal', 'Veg', 'Sliced mushrooms tossed in spicy crushed black pepper and caramelised onions.', true),
  ('dish-mushroom-chilli', 'Mushroom Chilli', 'veg-gravy', 'Veg Gravy & Dal', 190, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=80', 'Spicy', '10 - 12 mins', '450 kcal', 'Veg', 'Wok-tossed mushrooms with green chillies, garlic, and capsicum.', true),
  ('dish-green-piece-masala', 'Green Peas Masala', 'veg-gravy', 'Veg Gravy & Dal', 190, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=500&auto=format&fit=crop&q=80', '', '10 - 12 mins', '450 kcal', 'Veg', 'Sweet green peas cooked in a rich, velvety spiced tomato and onion gravy.', true),
  ('dish-alu-goobi-masala', 'Alu Gobi Masala', 'veg-gravy', 'Veg Gravy & Dal', 190, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?w=500&auto=format&fit=crop&q=80', 'Dhaba Classic', '12 - 15 mins', '450 kcal', 'Veg', 'Tender potatoes and fresh cauliflower florets sauteed with cumin, ginger, and turmeric.', true),
  ('dish-baby-corn-masala', 'Baby Corn Masala', 'veg-gravy', 'Veg Gravy & Dal', 190, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=500&auto=format&fit=crop&q=80', '', '12 - 15 mins', '450 kcal', 'Veg', 'Crispy baby corn chunks simmered in aromatic North Indian spiced curry.', true),
  ('dish-veg-khurma', 'Veg Kurma', 'veg-gravy', 'Veg Gravy & Dal', 190, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=500&auto=format&fit=crop&q=80', '', '12 - 15 mins', '450 kcal', 'Veg', 'Assorted vegetables simmered in rich coconut, poppy seeds, and cashew gravy.', true),
  ('dish-kadai-veg', 'Kadai Veg', 'veg-gravy', 'Veg Gravy & Dal', 190, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=500&auto=format&fit=crop&q=80', '', '12 - 15 mins', '450 kcal', 'Veg', 'Mixed garden vegetables cooked in spicy kadai gravy with bell peppers.', true),
  ('dish-dal-fry', 'Dal Fry', 'veg-gravy', 'Veg Gravy & Dal', 140, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=80', 'Comfort Food', '10 - 12 mins', '450 kcal', 'Veg', 'Yellow toor dal tempered with cumin, garlic, green chillies, and tomatoes in desi ghee.', true),
  ('dish-dal-tadaka', 'Dal Tadka', 'veg-gravy', 'Veg Gravy & Dal', 140, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500&auto=format&fit=crop&q=80', '⭐ Ghee Tadka', '10 - 12 mins', '450 kcal', 'Veg', 'Golden lentils topped with aromatic sizzling ghee tadka of mustard seeds and dried red chillies.', true),
  ('dish-tomato-fry', 'Tomato Fry', 'veg-gravy', 'Veg Gravy & Dal', 120, '5.0 (420 reviews)', 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?w=500&auto=format&fit=crop&q=80', 'Tangy', '8 - 10 mins', '450 kcal', 'Veg', 'Fresh country tomatoes cooked with mustard seeds, curry leaves, onions, and spices.', true)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, category_name = EXCLUDED.category_name, price = EXCLUDED.price, rating = EXCLUDED.rating, image = EXCLUDED.image, badge = EXCLUDED.badge, time = EXCLUDED.time, calories = EXCLUDED.calories, diet = EXCLUDED.diet, description = EXCLUDED.description, in_stock = EXCLUDED.in_stock;

INSERT INTO public.riders (pin, id, name, phone, vehicle, status, avatar, avatar_img)
VALUES
  ('2233', 'rider-2233', 'Rahul Kumar', '+91 98765 43210', '🏍️ Pulsar 150', 'online', '🏍️', '/avatars/rider-1.svg'),
  ('4422', 'rider-4422', 'Syed Imran', '+91 98450 11223', '🛵 Activa 6G', 'online', '🛵', '/avatars/rider-2.svg'),
  ('4455', 'rider-4455', 'Manjunath K', '+91 99887 76655', '🏍️ Splendor Plus', 'online', '🏍️', '/avatars/rider-3.svg'),
  ('8811', 'rider-8811', 'Tanveer Ahmed', '+91 97401 22334', '🛵 Jupiter 125', 'online', '🛵', '/avatars/rider-4.svg')
ON CONFLICT (pin) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone, vehicle = EXCLUDED.vehicle, status = EXCLUDED.status;
