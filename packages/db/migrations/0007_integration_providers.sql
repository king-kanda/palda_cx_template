ALTER TABLE "tenant_mcp_servers" ADD COLUMN "provider" text DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_mcp_servers" ADD COLUMN "label" text;