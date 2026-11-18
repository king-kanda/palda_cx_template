-- A WhatsApp Business account belongs to exactly ONE business. A number already could not be shared (phone_number_id is the
-- primary key); this makes it impossible for two businesses to hold numbers on the same account, enforced by PostgreSQL itself.
-- btree_gist is installed by 0001 (it also powers the booking overlap constraint).
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "whatsapp_routes" ADD CONSTRAINT "whatsapp_routes_one_business_per_account"
  EXCLUDE USING gist ("waba_id" WITH =, "tenant_id" WITH <>) WHERE ("waba_id" IS NOT NULL);
