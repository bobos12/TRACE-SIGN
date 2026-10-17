CREATE TABLE "document_events" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"type" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"message" text,
	"file_name" text NOT NULL,
	"file_data" "bytea" NOT NULL,
	"file_sha256" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"sender_name" text DEFAULT 'TRACE.SIGN' NOT NULL,
	"expires_at" timestamp with time zone,
	"reminder_every_days" integer DEFAULT 3 NOT NULL,
	"max_reminders" integer DEFAULT 3 NOT NULL,
	"sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completed_pdf" "bytea",
	"completed_sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_events" (
	"id" text PRIMARY KEY NOT NULL,
	"email_id" text NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"kind" text NOT NULL,
	"to_email" text NOT NULL,
	"to_name" text,
	"subject" text NOT NULL,
	"payload" text NOT NULL,
	"document_id" text,
	"recipient_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"message_id" text,
	"smtp_response" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"smtp_host" text,
	"smtp_port" integer DEFAULT 465,
	"smtp_security" text DEFAULT 'ssl' NOT NULL,
	"smtp_user" text,
	"smtp_pass_enc" text,
	"from_email" text DEFAULT 'trace.sign@trace-studio.tech' NOT NULL,
	"from_name" text DEFAULT 'TRACE.SIGN' NOT NULL,
	"reply_to" text,
	"alias_status" text DEFAULT 'unknown' NOT NULL,
	"alias_detail" text,
	"last_smtp_test_at" timestamp with time zone,
	"last_smtp_test_ok" boolean,
	"last_smtp_error" text,
	"imap_enabled" boolean DEFAULT false NOT NULL,
	"imap_host" text,
	"imap_port" integer DEFAULT 993,
	"imap_secure" boolean DEFAULT true NOT NULL,
	"imap_use_smtp_login" boolean DEFAULT true NOT NULL,
	"imap_user" text,
	"imap_pass_enc" text,
	"imap_mailbox" text DEFAULT 'INBOX' NOT NULL,
	"imap_read_only" boolean DEFAULT true NOT NULL,
	"imap_uid_validity" text,
	"imap_last_uid" integer DEFAULT 0 NOT NULL,
	"imap_last_sync_at" timestamp with time zone,
	"imap_last_error" text,
	"imap_initial_lookback_days" integer DEFAULT 14 NOT NULL,
	"admin_notify_email" text,
	"notify_on_open" boolean DEFAULT true NOT NULL,
	"notify_on_decline" boolean DEFAULT true NOT NULL,
	"notify_on_complete" boolean DEFAULT true NOT NULL,
	"notify_on_expire" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_emails" (
	"id" text PRIMARY KEY NOT NULL,
	"mailbox" text NOT NULL,
	"uid_validity" text NOT NULL,
	"uid" integer NOT NULL,
	"message_id" text NOT NULL,
	"from_email" text,
	"from_name" text,
	"to_list" text,
	"subject" text,
	"sent_at" timestamp with time zone,
	"in_reply_to" text,
	"references_hdr" text,
	"text_body" text,
	"raw_source" text NOT NULL,
	"kind" text DEFAULT 'reply' NOT NULL,
	"document_id" text,
	"matched_by" text,
	"related_email_id" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_locks" (
	"name" text PRIMARY KEY NOT NULL,
	"locked_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipients" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"token_version" integer DEFAULT 1 NOT NULL,
	"invited_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"signature_text" text,
	"signer_ip" text,
	"signer_agent" text,
	"declined_at" timestamp with time zone,
	"decline_reason" text,
	"reminder_count" integer DEFAULT 0 NOT NULL,
	"last_reminder_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_events" ADD CONSTRAINT "document_events_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_email_id_email_messages_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."email_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."recipients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipients" ADD CONSTRAINT "recipients_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_events_doc_idx" ON "document_events" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "documents_status_expires_idx" ON "documents" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "email_events_email_idx" ON "email_events" USING btree ("email_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_messages_idem_uq" ON "email_messages" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "email_messages_msgid_uq" ON "email_messages" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "email_messages_due_idx" ON "email_messages" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "email_messages_doc_idx" ON "email_messages" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_msgid_uq" ON "inbound_emails" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_uid_uq" ON "inbound_emails" USING btree ("mailbox","uid_validity","uid");--> statement-breakpoint
CREATE INDEX "inbound_doc_idx" ON "inbound_emails" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipients_doc_email_uq" ON "recipients" USING btree ("document_id","email");--> statement-breakpoint
CREATE INDEX "recipients_email_idx" ON "recipients" USING btree ("email");