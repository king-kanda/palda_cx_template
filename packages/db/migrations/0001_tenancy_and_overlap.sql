-- 0001: database-level guarantees that Drizzle cannot express.
--   1. btree_gist so uuids can take part in an exclusion constraint.
--   2. resource_occupancy_no_overlap: the last line of defence against double booking.
--   3. Row Level Security on every tenant-scoped table (application sets app.tenant_id
--      per transaction; the policy is a backstop if a query forgets its tenant filter).

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- Double-booking prevention
-- ---------------------------------------------------------------------------
-- One row per occupied (resource, interval). The '[)' range means a booking that
-- ends at 10:00 and the next that starts at 10:00 do not conflict.
ALTER TABLE "resource_occupancy"
  ADD CONSTRAINT "resource_occupancy_no_overlap"
  EXCLUDE USING gist (
    "tenant_id" WITH =,
    "resource_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("status" = 'active');

CREATE INDEX IF NOT EXISTS "resource_occupancy_lookup_idx"
  ON "resource_occupancy" ("tenant_id", "resource_id", "starts_at", "ends_at");

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Policies read a transaction-local setting:
--   SELECT set_config('app.tenant_id', '<uuid>', true);
-- withTenant() in @garden/db does this inside every transaction.
--
-- NOTE: PostgreSQL superusers and roles with BYPASSRLS ignore these policies.
-- In production connect as a dedicated, non-superuser application role (see
-- docs/runbook.md) so RLS is a real second line of defence.

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'users',
    'tenant_config',
    'tenant_integrations',
    'tenant_vertical',
    'customers',
    'customer_sensitive',
    'resources',
    'offerings',
    'addons',
    'bookings',
    'booking_resources',
    'resource_occupancy',
    'booking_items',
    'blocks',
    'invoices',
    'payments',
    'expenses',
    'reminders',
    'conversations',
    'messages',
    'handoffs',
    'reviews',
    'audit_log',
    'approvals',
    'agent_versions',
    'agent_pointers',
    'agent_runs',
    'idempotency_keys',
    'counters',
    'webhook_events',
    'integrations_log'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)
         WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t
    );
  END LOOP;

  -- The tenants table is keyed by its own id rather than tenant_id. Branding and
  -- slug are public routing metadata (login and webhook routing need to resolve a
  -- slug before a tenant context exists), so reads are open; writes stay scoped.
  EXECUTE 'ALTER TABLE tenants ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE tenants FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON tenants';
  EXECUTE 'DROP POLICY IF EXISTS tenants_read ON tenants';
  EXECUTE 'DROP POLICY IF EXISTS tenants_write ON tenants';
  EXECUTE 'CREATE POLICY tenants_read ON tenants FOR SELECT USING (true)';
  EXECUTE 'CREATE POLICY tenants_write ON tenants FOR ALL
             USING (id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)
             WITH CHECK (id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)';
END
$$;
