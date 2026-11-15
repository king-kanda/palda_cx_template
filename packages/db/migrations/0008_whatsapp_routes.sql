CREATE TABLE "whatsapp_routes" (
	"phone_number_id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"waba_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_routes" ADD CONSTRAINT "whatsapp_routes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Carry over any number already recorded on an integration row, so existing routing keeps working.
INSERT INTO whatsapp_routes (phone_number_id, tenant_id, waba_id)
SELECT meta->>'phoneNumberId', tenant_id, meta->>'wabaId'
FROM tenant_integrations
WHERE kind = 'whatsapp' AND coalesce(meta->>'phoneNumberId', '') <> ''
ON CONFLICT (phone_number_id) DO NOTHING;
