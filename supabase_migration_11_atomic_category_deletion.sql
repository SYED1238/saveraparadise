-- ==============================================================================
-- SAVERA PARADISE — SUPABASE MIGRATION 11
-- Transactional & Atomic Category & Dishes Cascade Deletion RPC
-- ==============================================================================
-- 1. Provides public.delete_category_cascade() to safely delete a category and its
--    associated dishes in a single atomic database transaction.
-- 2. Eliminates orphaned dish records if category deletion fails midway.
-- 3. Restricts execution to service_role and authenticated staff.
-- ==============================================================================

BEGIN;

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.delete_category_cascade(
    p_category_id TEXT,
    p_category_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target_key TEXT;
    v_dishes_deleted INT := 0;
    v_categories_deleted INT := 0;
BEGIN
    IF p_category_id IS NULL OR TRIM(p_category_id) = '' THEN
        RAISE EXCEPTION 'Category ID is required';
    END IF;

    v_target_key := COALESCE(NULLIF(TRIM(p_category_key), ''), p_category_id);

    -- 1. Delete all dishes associated with this category id or category slug key
    WITH deleted_dishes AS (
        DELETE FROM public.dishes
        WHERE category = v_target_key OR category = p_category_id
        RETURNING id
    )
    SELECT COUNT(*) INTO v_dishes_deleted FROM deleted_dishes;

    -- 2. Delete the category record
    WITH deleted_cat AS (
        DELETE FROM public.categories
        WHERE id = p_category_id OR id = v_target_key
        RETURNING id
    )
    SELECT COUNT(*) INTO v_categories_deleted FROM deleted_cat;

    IF v_categories_deleted = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Category not found in database',
            'dishes_deleted', v_dishes_deleted,
            'categories_deleted', 0
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'category_id', p_category_id,
        'dishes_deleted', v_dishes_deleted,
        'categories_deleted', v_categories_deleted
    );
END;
$$;

-- Revoke execute from public and anon
REVOKE ALL ON FUNCTION public.delete_category_cascade(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_category_cascade(TEXT, TEXT) FROM anon;

-- Grant execution strictly to service_role and authenticated
GRANT EXECUTE ON FUNCTION public.delete_category_cascade(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_category_cascade(TEXT, TEXT) TO authenticated;

COMMIT;
