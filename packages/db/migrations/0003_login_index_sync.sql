-- Keep login_index (email -> tenant) in sync with users so sign-in needs only an email + password.
-- login_index is deliberately NOT row-level-secured (users is, so a cross-tenant lookup is otherwise
-- impossible for the restricted app role). It stores no secrets: only which businesses an email belongs to.

CREATE INDEX IF NOT EXISTS "login_index_email_idx" ON "login_index" ("email");
--> statement-breakpoint

CREATE OR REPLACE FUNCTION sync_login_index() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    DELETE FROM login_index WHERE tenant_id = OLD.tenant_id AND email = lower(OLD.email);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    INSERT INTO login_index (email, tenant_id) VALUES (lower(NEW.email), NEW.tenant_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS users_login_index_sync ON users;
--> statement-breakpoint

CREATE TRIGGER users_login_index_sync
AFTER INSERT OR UPDATE OF email, tenant_id OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION sync_login_index();
--> statement-breakpoint

-- Backfill existing users. Under a superuser / BYPASSRLS migration role this sees every tenant. If the
-- migration role is subject to FORCE ROW LEVEL SECURITY it sees nothing; run `pnpm engine:reindex`
-- afterwards (it rebuilds the index one tenant context at a time) - see docs/runbook.md.
INSERT INTO login_index (email, tenant_id)
SELECT lower(email), tenant_id FROM users
ON CONFLICT DO NOTHING;
