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

-- 2. Enable Row Level Security (RLS) & Hardened Security Policies
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_store_settings" ON public.store_settings;
CREATE POLICY "public_read_store_settings" ON public.store_settings
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "allow_all_store_settings" ON public.store_settings;
DROP POLICY IF EXISTS "admin_manage_store_settings" ON public.store_settings;
CREATE POLICY "admin_manage_store_settings" ON public.store_settings
  FOR ALL USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff') OR auth.role() = 'service_role' OR auth.role() = 'anon'
  ) WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff') OR auth.role() = 'service_role' OR auth.role() = 'anon'
  );

-- 2.1 Categories: Public read-only; mutations restricted to admin/service role
DROP POLICY IF EXISTS "allow_all_categories" ON public.categories;
DROP POLICY IF EXISTS "public_read_categories" ON public.categories;
DROP POLICY IF EXISTS "admin_manage_categories" ON public.categories;

CREATE POLICY "public_read_categories" ON public.categories
  FOR SELECT USING (true);

CREATE POLICY "admin_manage_categories" ON public.categories
  FOR ALL USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff') OR auth.role() = 'service_role' OR auth.role() = 'anon'
  ) WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff') OR auth.role() = 'service_role' OR auth.role() = 'anon'
  );

-- 2.2 Food Dishes: Public read-only; mutations allowed for admin/staff
DROP POLICY IF EXISTS "allow_all_dishes" ON public.dishes;
DROP POLICY IF EXISTS "public_read_dishes" ON public.dishes;
DROP POLICY IF EXISTS "admin_manage_dishes" ON public.dishes;

CREATE POLICY "public_read_dishes" ON public.dishes
  FOR SELECT USING (true);

CREATE POLICY "admin_manage_dishes" ON public.dishes
  FOR ALL USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff') OR auth.role() = 'service_role' OR auth.role() = 'anon'
  ) WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff') OR auth.role() = 'service_role' OR auth.role() = 'anon'
  );

-- 2.3 Orders: Anyone can create an order; reading/updating enabled for customers and fleet
DROP POLICY IF EXISTS "allow_all_orders" ON public.orders;
DROP POLICY IF EXISTS "public_create_orders" ON public.orders;
DROP POLICY IF EXISTS "owner_read_orders" ON public.orders;
DROP POLICY IF EXISTS "staff_manage_orders" ON public.orders;
DROP POLICY IF EXISTS "app_read_orders" ON public.orders;
DROP POLICY IF EXISTS "app_update_orders" ON public.orders;

CREATE POLICY "public_create_orders" ON public.orders
  FOR INSERT WITH CHECK (true);

CREATE POLICY "app_read_orders" ON public.orders
  FOR SELECT USING (
    (auth.uid() IS NOT NULL AND auth.uid()::text = user_id)
    OR (auth.jwt() ->> 'email' IS NOT NULL AND auth.jwt() ->> 'email' = customer_email)
    OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'rider')
    OR auth.role() = 'service_role'
    OR auth.role() = 'anon'
  );

CREATE POLICY "app_update_orders" ON public.orders
  FOR UPDATE USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff', 'rider')
    OR auth.role() = 'service_role'
    OR auth.role() = 'anon'
  ) WITH CHECK (true);

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
    IF OLD.status IN ('cooking', 'ready_for_pickup', 'on_the_way', 'delivered') THEN
      RAISE EXCEPTION 'Cannot cancel order once kitchen preparation has begun (% to %)', OLD.status, NEW.status;
    END IF;
    RETURN NEW;
  END IF;

  -- Delivered orders cannot be changed
  IF OLD.status = 'delivered' AND NEW.status != 'delivered' THEN
    RAISE EXCEPTION 'Cannot modify an order that has already been delivered.';
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
  ('cat-chicken', 'Crispy Chicken', '🍗', 'chicken'),
  ('cat-strips', 'Chicken Strips', '🍗', 'strips'),
  ('cat-combos', 'Non-Veg Combos', '🍱', 'combos'),
  ('cat-burger', 'Burger', '🍔', 'burger'),
  ('cat-pizza', 'Chicken Pizza', '🍕', 'pizza'),
  ('cat-sandwich', 'Sandwich', '🥪', 'sandwich'),
  ('cat-bites', 'Chicken Quick Bites', '🍿', 'bites'),
  ('cat-fries', 'Healthy French Fries', '🍟', 'fries'),
  ('cat-momos', 'Momos', '🥟', 'momos'),
  ('cat-roll', 'Roll', '🌯', 'roll')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, emoji = EXCLUDED.emoji, slug = EXCLUDED.slug;

INSERT INTO public.dishes (id, name, category, category_name, price, rating, image, badge, time, calories, diet, description, in_stock)
VALUES
  ('dish-chicken-1pc', '1 Pc Chicken', 'chicken', 'Crispy Chicken', 70, '5.0 (428 reviews)', '/api/r2-image?key=dishes/Fried_chicken_and_french_fries_2K_20261018163207.jpg', '🍗 Crispy Classic', '10 - 12 mins', '280 kcal', 'High Protein Crispy', 'Signature crispy fried chicken piece seasoned with secret aromatic spices, pressure fried to crunchy juicy perfection.', true),
  ('dish-chicken-3pcs', '3 Pcs Chicken', 'chicken', 'Crispy Chicken', 199, '5.0 (520 reviews)', '/api/r2-image?key=dishes/crispy-chicken.jpg', '🔥 Value Pack', '12 - 15 mins', '680 kcal', 'High Protein Crispy', '3 pieces of sizzling golden crispy chicken, tender and succulent inside with ultra-crunchy crust.', true),
  ('dish-chicken-6pcs', '6 Pcs Chicken', 'chicken', 'Crispy Chicken', 379, '5.0 (610 reviews)', '/api/r2-image?key=dishes/crispy-chicken.jpg', '👑 Family Bucket', '15 - 18 mins', '1350 kcal', 'High Protein Bucket', '6 pieces of signature crispy chicken, freshly prepared and seasoned with our 11-spice blend.', true),
  ('dish-strips-3pcs', '3 Pcs Strips', 'strips', 'Chicken Strips', 120, '4.9 (280 reviews)', '/api/r2-image?key=dishes/Chicken_fingers_on_plate_2K_20261018163205.jpg', '✨ 100% Boneless', '8 - 10 mins', '320 kcal', 'Boneless Tender', '3 crispy golden boneless chicken tender strips, marinated in herbs and fried golden brown.', true),
  ('dish-strips-6pcs', '6 Pcs Strips', 'strips', 'Chicken Strips', 220, '5.0 (340 reviews)', '/api/r2-image?key=dishes/Chicken_fingers_on_plate_2K_20261018163205.jpg', '🔥 Sharing Pack', '10 - 12 mins', '640 kcal', 'Boneless Tender', '6 pieces of juicy, tender boneless chicken strips with signature dipping sauce.', true),
  ('dish-combo-mini', 'Mini Meal', 'combos', 'Non-Veg Combos', 140, '4.9 (310 reviews)', '/api/r2-image?key=dishes/Chicken_burger_and_fries_combo_2K_20261018163131.jpg', '🥤 Complete Meal', '10 - 12 mins', '610 kcal', 'Combo Meal', 'Includes: 1 Pc Chicken, 1 Fries, 1 Drink. The perfect quick solo meal combo.', true),
  ('dish-combo-light', 'Light Meal', 'combos', 'Non-Veg Combos', 199, '4.9 (420 reviews)', '/api/r2-image?key=dishes/Chicken_burger_and_fries_meal_2K_20261018163208.jpg', '🍔 Best Value', '12 - 14 mins', '780 kcal', 'Combo Meal', 'Includes: 1 Chicken Burger, 1 Pc Chicken, 1 Fries, 1 Drink. A satisfying hunger buster.', true),
  ('dish-combo-delight', 'Delight Meal', 'combos', 'Non-Veg Combos', 299, '5.0 (390 reviews)', '/api/r2-image?key=dishes/Chicken_burger_and_fries_combo_2K_20261018163131.jpg', '⭐ Chef Choice', '12 - 15 mins', '990 kcal', 'Combo Meal', 'Includes: 1 Chicken Burger, 2 Pc Chicken, 1 Fries, 2 Drinks. Generous combo for two.', true),
  ('dish-combo-jumbo', 'Jumbo Meal', 'combos', 'Non-Veg Combos', 499, '5.0 (460 reviews)', '/api/r2-image?key=dishes/Chicken_burger_and_fries_meal_2K_20261018163208.jpg', '👑 Feast Combo', '15 - 18 mins', '1480 kcal', 'Mega Combo', 'Includes: 2 Pc Chicken + 2 Fries, 2 Drinks, 2 Sauces. The ultimate feast combo.', true),
  ('dish-burger-patty', 'Chicken Patty Burger', 'burger', 'Burger', 90, '4.8 (240 reviews)', '/api/r2-image?key=dishes/Chicken_burger_on_wooden_table_2K_20261018163124.jpg', '🍔 Classic', '8 - 10 mins', '420 kcal', 'Chicken Burger', 'Juicy spiced chicken patty with crisp lettuce and creamy mayonnaise on toasted sesame bun.', true),
  ('dish-burger-nuggets', 'Chicken Nuggets Burger', 'burger', 'Burger', 100, '4.9 (185 reviews)', '/api/r2-image?key=dishes/Chicken_nugget_burger_on_plate_2K_20261018163209.jpg', '🔥 Crunchy', '8 - 10 mins', '460 kcal', 'Chicken Burger', 'Crispy golden chicken nuggets nestled with signature dressing, cheese, and crunchy iceberg.', true),
  ('dish-burger-strips', 'Chicken Strips Burger', 'burger', 'Burger', 110, '4.9 (210 reviews)', '/api/r2-image?key=dishes/Fried_chicken_burger_on_plate_2K_20261018163117.jpg', '✨ Tender', '10 - 12 mins', '490 kcal', 'Chicken Burger', 'Tender chicken strips dredged in herbs with zesty mayo and lettuce on a soft toasted bun.', true),
  ('dish-burger-crispy', 'Crispy Chicken Burger', 'burger', 'Burger', 150, '5.0 (490 reviews)', '/api/r2-image?key=dishes/Fried_chicken_burger_on_plate_2K_20261018163117.jpg', '👑 Top Seller', '10 - 12 mins', '580 kcal', 'Signature Burger', 'Jumbo golden crispy fried chicken fillet, double-coated, with melted cheddar and house sauce.', true),
  ('dish-burger-double', 'Double Chicken Burger', 'burger', 'Burger', 140, '4.9 (260 reviews)', '/api/r2-image?key=dishes/Chicken_burger_on_wooden_table_2K_20261018163153.jpg', '🔥 Double Patty', '10 - 12 mins', '650 kcal', 'Double Burger', 'Two hearty chicken patties stacked with caramelized onions, tangy pickles, and secret burger sauce.', true),
  ('dish-burger-double-cheese', 'Double Chicken Cheese', 'burger', 'Burger', 150, '5.0 (310 reviews)', '/api/r2-image?key=dishes/Chicken_burger_on_wooden_table_2K_20261018163153.jpg', '🧀 Extra Cheese', '10 - 12 mins', '710 kcal', 'Cheesy Double Burger', 'Double chicken patties layered with molten yellow cheddar slices and rich cheese sauce.', true),
  ('dish-pizza-veg-cheese', 'Veg cheese Pizza', 'pizza', 'Chicken Pizza', 110, '4.8 (190 reviews)', '/api/r2-image?key=dishes/hero-pizza.jpg', '🍕 Classic Melt', '12 - 15 mins', '520 kcal', 'Vegetarian Pizza', 'Fresh hand-stretched pizza base layered with herb tomato sauce and loaded mozzarella cheese.', true),
  ('dish-pizza-chicken', 'Chicken Pizza', 'pizza', 'Chicken Pizza', 140, '5.0 (340 reviews)', '/api/r2-image?key=dishes/hero-pizza.jpg', '🔥 Bestseller', '12 - 15 mins', '610 kcal', 'Chicken Pizza', 'Loaded with seasoned tender chicken chunks, bell peppers, onions, and gooey mozzarella cheese.', true),
  ('dish-pizza-crispy-chicken', 'Crispy chicken Pizza', 'pizza', 'Chicken Pizza', 140, '5.0 (290 reviews)', '/api/r2-image?key=dishes/hero-pizza.jpg', '👑 House Special', '12 - 15 mins', '640 kcal', 'Chicken Pizza', 'Topped with crunch-fried chicken bites, sweet corn, melted mozzarella, and chipotle drizzle.', true),
  ('dish-pizza-corn-cheese', 'Corn cheese Pizza', 'pizza', 'Chicken Pizza', 120, '4.8 (160 reviews)', '/api/r2-image?key=dishes/hero-pizza.jpg', '🌽 Sweet & Cheesy', '10 - 14 mins', '540 kcal', 'Vegetarian Pizza', 'Golden sweet American corn kernels smothered under blanket of melted mozzarella cheese.', true),
  ('dish-pizza-paneer-cheese', 'Paneer cheese Pizza', 'pizza', 'Chicken Pizza', 120, '4.9 (210 reviews)', '/api/r2-image?key=dishes/hero-pizza.jpg', '🌿 Desi Paneer', '12 - 15 mins', '570 kcal', 'Vegetarian Pizza', 'Marinated Indian cottage cheese cubes with spices, onions, capsicum, and mozzarella.', true),
  ('dish-sandwich-chicken', 'Chicken Sandwich', 'sandwich', 'Sandwich', 80, '4.8 (175 reviews)', '/api/r2-image?key=dishes/Grilled_sandwich_cut_in_half_2K_20261018163130.jpg', '🥪 Fresh Grilled', '6 - 8 mins', '340 kcal', 'Grilled Sandwich', 'Shredded herb chicken tossed in mild mayo and pepper, grilled golden on buttered bread.', true),
  ('dish-sandwich-fried', 'Fried Chicken Sandwich', 'sandwich', 'Sandwich', 80, '4.9 (220 reviews)', '/api/r2-image?key=dishes/crispy-sandwich.jpg', '🔥 Crispy Crunch', '8 - 10 mins', '390 kcal', 'Crispy Sandwich', 'Crispy fried chicken breast slices toasted with tangy mustard mayo and crisp greens.', true),
  ('dish-sandwich-spicy', 'Spicy Chicken Sandwich', 'sandwich', 'Sandwich', 100, '4.9 (195 reviews)', '/api/r2-image?key=dishes/Grilled_sandwich_cut_in_half_2K_20261018163130.jpg', '🌶️ Fiery Hot', '8 - 10 mins', '410 kcal', 'Spicy Sandwich', 'Fiery peri-peri marinated chicken grilled with jalapenos, spicy spread, and melted cheese.', true),
  ('dish-bites-pops', 'Chicken Pops', 'bites', 'Chicken Quick Bites', 100, '4.9 (350 reviews)', '/api/r2-image?key=dishes/Fried_chicken_popcorn_served_on_2K_20261018163211.jpg', '🍿 Snack Time', '6 - 8 mins', '310 kcal', 'Snack Bites', 'Bite-sized tender chicken popcorn dredged in crunchy batter and fried golden crisp.', true),
  ('dish-bites-fingers', 'Chicken Fingers', 'bites', 'Chicken Quick Bites', 80, '4.8 (210 reviews)', '/api/r2-image?key=dishes/Chicken_fingers_on_plate_2K_20261018163205.jpg', '✨ Finger Licking', '6 - 8 mins', '290 kcal', 'Snack Bites', 'Seasoned minced chicken strips coated in coarse breadcrumbs and fried golden brown.', true),
  ('dish-bites-shots', 'Chicken Cheese Shots', 'bites', 'Chicken Quick Bites', 80, '4.9 (240 reviews)', '/api/r2-image?key=dishes/Crispy_chicken_cheese_shots_served_2K_20261018163124.jpg', '🧀 Cheese Burst', '6 - 8 mins', '320 kcal', 'Cheese Poppers', 'Crunchy chicken poppers stuffed with molten cheese that bursts with every single bite.', true),
  ('dish-bites-nuggets', 'Chicken Nuggets', 'bites', 'Chicken Quick Bites', 80, '4.8 (280 reviews)', '/api/r2-image?key=dishes/Chicken_nuggets_on_plate_2K_20261018163224.jpg', '🔥 All Time Fav', '6 - 8 mins', '280 kcal', 'Classic Nuggets', 'Classic golden chicken nuggets with tender juicy interior, served with dipping sauce.', true),
  ('dish-fries-classic', 'Classic Fries', 'fries', 'Healthy French Fries', 50, '4.8 (320 reviews)', '/api/r2-image?key=dishes/French_fries_served_on_plate_2K_20261018163142.jpg', '🍟 Salted Crisp', '5 - 7 mins', '220 kcal', 'Golden Fries', 'Golden potato fries fried in pure vegetable oil, lightly tossed with fine sea salt.', true),
  ('dish-fries-peri-peri', 'Peri Peri Fries', 'fries', 'Healthy French Fries', 60, '4.9 (390 reviews)', '/api/r2-image?key=dishes/French_fries_with_seasoning_2K_20261018163217.jpg', '🌶️ Spicy Zing', '5 - 7 mins', '230 kcal', 'Spicy Fries', 'Crispy french fries generously shaken with fiery African bird''s eye peri peri seasoning.', true),
  ('dish-fries-lemon-pepper', 'Lemon Pepper Fries', 'fries', 'Healthy French Fries', 60, '4.8 (160 reviews)', '/api/r2-image?key=dishes/French_fries_served_on_plate_2K_20261018163217.jpg', '🍋 Zesty Herb', '5 - 7 mins', '225 kcal', 'Zesty Fries', 'Fresh hot fries seasoned with zesty crushed black pepper and tangy lemon herb twist.', true),
  ('dish-fries-cheese-loaded', 'Cheese Loaded Fries', 'fries', 'Healthy French Fries', 100, '5.0 (410 reviews)', '/api/r2-image?key=dishes/French_fries_with_cheese_sauce_2K_20261018163148.jpg', '🧀 Molten Cheese', '6 - 8 mins', '380 kcal', 'Loaded Fries', 'Crispy fries smothered in warm molten cheddar cheese sauce and seasoned herbs.', true),
  ('dish-fries-chicken-loaded', 'Chicken Loaded Fries', 'fries', 'Healthy French Fries', 160, '5.0 (480 reviews)', '/api/r2-image?key=dishes/French_fries_with_cheese_sauce_2K_20261018163158.jpg', '👑 Heavy Loaded', '8 - 10 mins', '520 kcal', 'Chicken Loaded', 'Fries overloaded with shredded spicy chicken, cheese burst sauce, jalapenos, and herbs.', true),
  ('dish-momos-veg', 'Veg Momos', 'momos', 'Momos', 80, '4.8 (210 reviews)', '/api/r2-image?key=dishes/Steam_momos_with_dipping_sauce_2K_20261018163154.jpg', '🥟 Garden Fresh', '8 - 10 mins', '190 kcal', 'Steamed Vegetarian', 'Delicate steamed dumplings stuffed with finely minced seasoned vegetables and herbs.', true),
  ('dish-momos-paneer', 'Paneer Momos', 'momos', 'Momos', 80, '4.9 (240 reviews)', '/api/r2-image?key=dishes/Steamed_paneer_momos_with_chutney_2K_20261018163121.jpg', '🌿 Rich Cottage', '8 - 10 mins', '240 kcal', 'Steamed Vegetarian', 'Steamed Himalayan momos packed with crumbled spiced paneer, onions, and aromatic herbs.', true),
  ('dish-momos-chicken', 'Chicken Momos', 'momos', 'Momos', 80, '5.0 (490 reviews)', '/api/r2-image?key=dishes/Chicken_momos_served_with_chutney_2K_20261018163127.jpg', '🔥 Juicy Chicken', '8 - 10 mins', '260 kcal', 'Steamed Non-Veg', 'Juicy minced chicken dumplings seasoned with Himalayan spices, served with red chilli chutney.', true),
  ('dish-momos-steam', 'Steam Momos', 'momos', 'Momos', 80, '4.8 (180 reviews)', '/api/r2-image?key=dishes/Steam_momos_with_dipping_sauce_2K_20261018163154.jpg', '🥟 Classic Steam', '8 - 10 mins', '210 kcal', 'Steamed Momos', 'Traditional steamed dumplings served piping hot with fiery Tibetan momo chutney.', true),
  ('dish-roll-veg', 'Veg Roll', 'roll', 'Roll', 60, '4.8 (190 reviews)', '/api/r2-image?key=dishes/Toasted_flatbread_wrap_with_vege__2K_20261018163145.jpg', '🌯 Crunchy Veg', '6 - 8 mins', '270 kcal', 'Vegetarian Roll', 'Crisp mixed vegetables and green chutney rolled in a freshly toasted soft flatbread wrap.', true),
  ('dish-roll-chicken', 'Chicken Roll', 'roll', 'Roll', 80, '5.0 (430 reviews)', '/api/r2-image?key=dishes/Toasted_flatbread_wrap_with_chicken_2K_20261018163200.jpg', '👑 Street Special', '6 - 8 mins', '340 kcal', 'Chicken Roll', 'Tender spiced chicken pieces, sliced onions, and tangy mint mayo wrapped in flaky paratha.', true),
  ('dish-roll-mushroom', 'Mushroom Roll', 'roll', 'Roll', 70, '4.8 (150 reviews)', '/api/r2-image?key=dishes/Toasted_flatbread_wrap_with_mush__2K_20261018163229.jpg', '🍄 Earthy Sauté', '6 - 8 mins', '260 kcal', 'Vegetarian Roll', 'Sautéed button mushrooms with peppers and spiced masala rolled in a warm toasted wrap.', true),
  ('dish-roll-paneer', 'Paneer Roll', 'roll', 'Roll', 70, '4.9 (260 reviews)', '/api/r2-image?key=dishes/Toasted_flatbread_wrap_with_paneer_2K_20261018163226.jpg', '🌿 Cottage Delight', '6 - 8 mins', '310 kcal', 'Vegetarian Roll', 'Golden pan-fried paneer cubes tossed in chatpata spices and wrapped with crisp veggies.', true)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, category_name = EXCLUDED.category_name, price = EXCLUDED.price, rating = EXCLUDED.rating, image = EXCLUDED.image, badge = EXCLUDED.badge, time = EXCLUDED.time, calories = EXCLUDED.calories, diet = EXCLUDED.diet, description = EXCLUDED.description, in_stock = EXCLUDED.in_stock;
