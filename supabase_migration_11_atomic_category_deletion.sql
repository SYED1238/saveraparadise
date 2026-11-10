-- ==============================================================================
-- SAVERA PARADISE — SUPABASE MIGRATION 11
-- Transactional & Atomic Category & Dishes Cascade Deletion RPC
-- ==============================================================================
-- 1. Provides public.delete_category_cascade() to safely delete a category and its
--    associated dishes in a single atomic database transaction.
-- 2. Strictly validates category existence BEFORE deleting dishes:
--    Locks category row (SELECT ... FOR UPDATE). If category is missing, aborts
--    immediately with 0 deletions, preventing orphaned dish deletions.
-- 3. Strict Security Definer Lockdown:
--    - Function execution is REVOKED from anon, authenticated, and public.
--    - Execution is granted EXCLUSIVELY to service_role (used by serverless API endpoints).
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
    v_matched_id TEXT;
    v_dishes_deleted INT := 0;
    v_categories_deleted INT := 0;
BEGIN
    IF p_category_id IS NULL OR TRIM(p_category_id) = '' THEN
        RAISE EXCEPTION 'Category ID is required';
    END IF;

    v_target_key := COALESCE(NULLIF(TRIM(p_category_key), ''), p_category_id);

    -- 1. Check and lock target category row FIRST before touching any dishes
    SELECT id INTO v_matched_id
    FROM public.categories
    WHERE id = p_category_id OR id = v_target_key
    LIMIT 1
    FOR UPDATE;

    -- If category does not exist, abort immediately with 0 changes
    IF v_matched_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'not_found', true,
            'error', 'Category not found in database',
            'dishes_deleted', 0,
            'categories_deleted', 0
        );
    END IF;

    -- 2. Delete all dishes matching either the category id or slug key
    WITH deleted_dishes AS (
        DELETE FROM public.dishes
        WHERE category = v_target_key OR category = p_category_id OR category = v_matched_id
        RETURNING id
    )
    SELECT COUNT(*) INTO v_dishes_deleted FROM deleted_dishes;

    -- 3. Delete the category record
    DELETE FROM public.categories
    WHERE id = v_matched_id;
    v_categories_deleted := 1;

    RETURN jsonb_build_object(
        'success', true,
        'category_id', v_matched_id,
        'dishes_deleted', v_dishes_deleted,
        'categories_deleted', v_categories_deleted
    );
END;
$$;

-- Revoke execute from public, anon, and authenticated to prevent unauthorized direct client invocation
REVOKE ALL ON FUNCTION public.delete_category_cascade(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_category_cascade(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.delete_category_cascade(TEXT, TEXT) FROM authenticated;

-- Grant execution strictly and exclusively to service_role (used by secure backend admin endpoints)
GRANT EXECUTE ON FUNCTION public.delete_category_cascade(TEXT, TEXT) TO service_role;

COMMIT;
