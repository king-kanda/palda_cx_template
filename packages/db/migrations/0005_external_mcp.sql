CREATE TABLE "tenant_mcp_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret_enc" text,
	"agents" text[] DEFAULT ARRAY['wambo']::text[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_mcp_servers" ADD CONSTRAINT "tenant_mcp_servers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_mcp_servers_name_uq" ON "tenant_mcp_servers" USING btree ("tenant_id","name");
--> statement-breakpoint
-- Row-level security, same policy as every other tenant table.
ALTER TABLE tenant_mcp_servers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenant_mcp_servers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON tenant_mcp_servers;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tenant_mcp_servers
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
