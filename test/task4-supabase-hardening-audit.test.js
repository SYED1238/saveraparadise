import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const cashfreeColumns = [
  'is_paid_online',
  'payment_gateway',
  'cf_order_id',
  'cf_payment_id',
  'cf_payment_status',
  'doorstep_upi',
  'doorstep_upi_vpa'
];

test('Task 4: Supabase SQL Schema, RLS & Trigger Hardening', async (t) => {
  const setupSql = fs.readFileSync(path.join(rootDir, 'supabase_setup.sql'), 'utf8');
  const hardeningSql = fs.readFileSync(path.join(rootDir, 'supabase_production_security_hardening.sql'), 'utf8');
  const mig07Sql = fs.readFileSync(path.join(rootDir, 'supabase_migration_07_fix_clear_orders_rpc.sql'), 'utf8');
  const mig14Sql = fs.readFileSync(path.join(rootDir, 'supabase_migration_14_security_and_schema_alignment.sql'), 'utf8');
  const rollback14Sql = fs.readFileSync(path.join(rootDir, 'supabase_rollback_14_security_and_schema_alignment.sql'), 'utf8');

  await t.test('1. "public_create_orders" is strictly dropped and never created for public orders', () => {
    // In supabase_setup.sql, public_create_orders should not be created
    assert.strictEqual(
      /CREATE\s+POLICY\s+"public_create_orders"/i.test(setupSql),
      false,
      'supabase_setup.sql must not create public_create_orders policy'
    );
    assert.match(
      setupSql,
      /DROP\s+POLICY\s+IF\s+EXISTS\s+"public_create_orders"\s+ON\s+public\.orders/i,
      'supabase_setup.sql must drop public_create_orders'
    );

    // In hardening script and migration 14, public_create_orders must be dropped
    assert.match(
      hardeningSql,
      /DROP\s+POLICY\s+IF\s+EXISTS\s+"public_create_orders"\s+ON\s+public\.orders/i,
      'supabase_production_security_hardening.sql must drop public_create_orders'
    );
    assert.match(
      mig14Sql,
      /DROP\s+POLICY\s+IF\s+EXISTS\s+"public_create_orders"\s+ON\s+public\.orders/i,
      'migration 14 must drop public_create_orders'
    );
  });

  await t.test('2. Direct order mutations are revoked from authenticated role', () => {
    const checkRevoke = (sql, filename) => {
      assert.match(
        sql,
        /REVOKE\s+INSERT,\s*UPDATE,\s*DELETE\s+ON\s+(TABLE\s+)?public\.orders\s+FROM\s+authenticated/i,
        `${filename} must revoke INSERT, UPDATE, DELETE on public.orders from authenticated`
      );
    };

    checkRevoke(setupSql, 'supabase_setup.sql');
    checkRevoke(hardeningSql, 'supabase_production_security_hardening.sql');
    checkRevoke(mig14Sql, 'supabase_migration_14_security_and_schema_alignment.sql');
  });

  await t.test('3. All 7 Cashfree & Doorstep UPI columns exist in setup, hardening and migration 14', () => {
    for (const col of cashfreeColumns) {
      const regex = new RegExp(`ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+${col}\\b`, 'i');
      assert.match(setupSql, regex, `supabase_setup.sql missing column ${col}`);
      assert.match(hardeningSql, regex, `supabase_production_security_hardening.sql missing column ${col}`);
      assert.match(mig14Sql, regex, `migration 14 missing column ${col}`);
    }
  });

  await t.test('4. prevent_order_deletion() allows override via app.allow_order_deletion', () => {
    const overrideRegex = /IF\s+current_setting\('app\.allow_order_deletion',\s*true\)\s*=\s*'on'\s+THEN\s+RETURN\s+OLD;/i;
    assert.match(setupSql, overrideRegex, 'supabase_setup.sql prevent_order_deletion missing override');
    assert.match(mig14Sql, overrideRegex, 'migration 14 prevent_order_deletion missing override');
  });

  await t.test('5. clear_all_orders() RPC enforces search_path = public, pg_temp and service_role access', () => {
    const searchPathRegex = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.clear_all_orders\(\)[\s\S]*?SET\s+search_path\s*=\s*public,\s*pg_temp/i;
    assert.match(setupSql, searchPathRegex, 'supabase_setup.sql clear_all_orders must have search_path');
    assert.match(hardeningSql, searchPathRegex, 'hardening sql clear_all_orders must have search_path');
    assert.match(mig07Sql, searchPathRegex, 'migration 07 clear_all_orders must have search_path');
    assert.match(mig14Sql, searchPathRegex, 'migration 14 clear_all_orders must have search_path');

    const grantRegex = /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.clear_all_orders\(\)\s+TO\s+service_role/i;
    assert.match(setupSql, grantRegex);
    assert.match(hardeningSql, grantRegex);
    assert.match(mig07Sql, grantRegex);
    assert.match(mig14Sql, grantRegex);
  });

  await t.test('6. Migration 14 and Rollback 14 are well-formed and paired', () => {
    assert.match(mig14Sql, /^BEGIN;/m, 'Migration 14 must start with BEGIN;');
    assert.match(mig14Sql, /COMMIT;$/m, 'Migration 14 must end with COMMIT;');
    assert.match(rollback14Sql, /^BEGIN;/m, 'Rollback 14 must start with BEGIN;');
    assert.match(rollback14Sql, /COMMIT;$/m, 'Rollback 14 must end with COMMIT;');
    assert.match(rollback14Sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.prevent_order_deletion/i);
    assert.match(rollback14Sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.enforce_order_status_monotonicity/i);
  });
});
