CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fields" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"type" text NOT NULL,
	"page" integer NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"w" double precision NOT NULL,
	"h" double precision NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"label" text,
	"placeholder" text,
	"default_value" text,
	"options" text,
	"value" text,
	"value_image" "bytea",
	"filled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"brand_name" text DEFAULT 'TRACE.SIGN' NOT NULL,
	"logo_png" "bytea",
	"accent_color" text DEFAULT '#FF5A33' NOT NULL,
	"email_from_name" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"date_format" text DEFAULT 'MMM d, yyyy' NOT NULL,
	"completion_delivery" text DEFAULT 'attachment' NOT NULL,
	"attach_audit_to_email" boolean DEFAULT true NOT NULL,
	"seal_pdf" boolean DEFAULT true NOT NULL,
	"seal_p12_enc" text,
	"seal_cert_pem" text,
	"retention_days" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "organizations" ("id", "name", "brand_name") VALUES ('default', 'TRACE.STUDIO', 'TRACE.SIGN') ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"message" text,
	"file_name" text NOT NULL,
	"file_data" "bytea" NOT NULL,
	"file_sha256" text NOT NULL,
	"page_count" integer NOT NULL,
	"page_info" text NOT NULL,
	"signing_order" text DEFAULT 'parallel' NOT NULL,
	"roles" text NOT NULL,
	"fields_json" text NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"last_login_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"endpoint_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"event" text NOT NULL,
	"payload" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"response_code" integer,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"url" text NOT NULL,
	"secret_enc" text NOT NULL,
	"events" text DEFAULT '*' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "recipients_doc_email_uq";--> statement-breakpoint
ALTER TABLE "document_events" ADD COLUMN "seq" integer;--> statement-breakpoint
ALTER TABLE "document_events" ADD COLUMN "actor" text;--> statement-breakpoint
ALTER TABLE "document_events" ADD COLUMN "recipient_id" text;--> statement-breakpoint
ALTER TABLE "document_events" ADD COLUMN "ip" text;--> statement-breakpoint
ALTER TABLE "document_events" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "document_events" ADD COLUMN "prev_hash" text;--> statement-breakpoint
ALTER TABLE "document_events" ADD COLUMN "hash" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "org_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "sender_email" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "signing_order" text DEFAULT 'parallel' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "expires_in_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "page_count" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "page_info" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "audit_pdf" "bytea";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "audit_sha256" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "sealed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "template_id" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "source" text DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "recipients" ADD COLUMN "routing_order" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "recipients" ADD COLUMN "color" text DEFAULT '#3B6FF5' NOT NULL;--> statement-breakpoint
ALTER TABLE "recipients" ADD COLUMN "role_label" text;--> statement-breakpoint
ALTER TABLE "recipients" ADD COLUMN "consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recipients" ADD COLUMN "signature_method" text;--> statement-breakpoint
ALTER TABLE "recipients" ADD COLUMN "signature_png" "bytea";--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fields" ADD CONSTRAINT "fields_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fields" ADD CONSTRAINT "fields_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_uq" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_org_idx" ON "api_keys" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "fields_doc_idx" ON "fields" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "fields_recipient_idx" ON "fields" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "templates_org_idx" ON "templates" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_org_idx" ON "users" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_idem_uq" ON "webhook_deliveries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due_idx" ON "webhook_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_org_idx" ON "webhook_endpoints" USING btree ("org_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_events_seq_uq" ON "document_events" USING btree ("document_id","seq");--> statement-breakpoint
CREATE INDEX "documents_org_idx" ON "documents" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "recipients_doc_idx" ON "recipients" USING btree ("document_id");