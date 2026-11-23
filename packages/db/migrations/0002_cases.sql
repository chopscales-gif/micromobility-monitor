-- Findings are derived from the stored record, so they are cleared here and filed again, into cases, by the rule engine.
DELETE FROM "violations";
--> statement-breakpoint
DROP TABLE "violation_events";
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" bigserial NOT NULL,
	"rule_kind" text NOT NULL,
	"operator_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"outcome" text,
	"step" integer,
	"opened_at" timestamp with time zone NOT NULL,
	"notified_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"replied_at" timestamp with time zone,
	"status_changed_at" timestamp with time zone,
	"status_changed_by" text,
	CONSTRAINT "cases_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "case_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor_id" uuid,
	"actor_name" text NOT NULL,
	"kind" text NOT NULL,
	"from_operator" boolean DEFAULT false NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text NOT NULL,
	"operator_id" uuid,
	"urgent" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"emailed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"to_user_id" uuid,
	"to_name" text NOT NULL,
	"to_email" text NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL
);
--> statement-breakpoint
DROP INDEX "violations_queue";
--> statement-breakpoint
ALTER TABLE "violations" DROP COLUMN "status";
--> statement-breakpoint
ALTER TABLE "violations" DROP COLUMN "status_changed_at";
--> statement-breakpoint
ALTER TABLE "violations" DROP COLUMN "status_changed_by";
--> statement-breakpoint
ALTER TABLE "violations" ADD COLUMN "case_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "violations" ADD COLUMN "standing" text DEFAULT 'counted' NOT NULL;
--> statement-breakpoint
ALTER TABLE "violations" ADD COLUMN "hold" jsonb;
--> statement-breakpoint
ALTER TABLE "violations" ADD COLUMN "standing_by" text;
--> statement-breakpoint
ALTER TABLE "violations" ADD COLUMN "standing_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "violations" ADD COLUMN "standing_note" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "issued_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "issued_by" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "issue_note" text;
--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "violations" ADD CONSTRAINT "violations_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "cases_key" ON "cases" USING btree ("rule_kind","operator_id","week_start");
--> statement-breakpoint
CREATE INDEX "cases_queue" ON "cases" USING btree ("status","opened_at");
--> statement-breakpoint
CREATE INDEX "cases_operator" ON "cases" USING btree ("operator_id","opened_at");
--> statement-breakpoint
CREATE INDEX "case_events_case" ON "case_events" USING btree ("case_id","at");
--> statement-breakpoint
CREATE INDEX "violations_case" ON "violations" USING btree ("case_id","detected_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_key" ON "alerts" USING btree ("user_id","key");
--> statement-breakpoint
CREATE INDEX "alerts_user" ON "alerts" USING btree ("user_id","at");
--> statement-breakpoint
CREATE INDEX "outbox_time" ON "outbox" USING btree ("at");
