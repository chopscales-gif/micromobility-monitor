CREATE TABLE "rules" (
	"kind" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"params" jsonb NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "violation_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"violation_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor_id" uuid,
	"actor_name" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "violations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" bigserial NOT NULL,
	"rule_kind" text NOT NULL,
	"operator_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone,
	"subject" text DEFAULT '' NOT NULL,
	"device_id" uuid,
	"measured" real NOT NULL,
	"threshold" real NOT NULL,
	"rule_params" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"last_evaluated_at" timestamp with time zone NOT NULL,
	"status_changed_at" timestamp with time zone,
	"status_changed_by" text,
	CONSTRAINT "violations_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "zone_passes" (
	"trip_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"entered_at" timestamp with time zone NOT NULL,
	"limit_kph" real NOT NULL,
	"speeds" smallint[] NOT NULL,
	CONSTRAINT "zone_passes_trip_id_zone_id_pk" PRIMARY KEY("trip_id","zone_id")
);
--> statement-breakpoint
ALTER TABLE "zones" ADD COLUMN "effective_from" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "zones" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "zones" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "violation_events" ADD CONSTRAINT "violation_events_violation_id_violations_id_fk" FOREIGN KEY ("violation_id") REFERENCES "public"."violations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violations" ADD CONSTRAINT "violations_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "violation_events_violation" ON "violation_events" USING btree ("violation_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "violations_key" ON "violations" USING btree ("rule_kind","operator_id","period_start","subject");--> statement-breakpoint
CREATE INDEX "violations_queue" ON "violations" USING btree ("status","detected_at");--> statement-breakpoint
CREATE INDEX "violations_operator" ON "violations" USING btree ("operator_id","detected_at");--> statement-breakpoint
CREATE INDEX "zone_passes_operator" ON "zone_passes" USING btree ("operator_id","entered_at");--> statement-breakpoint
UPDATE "zones" SET "effective_from" = '2026-01-01T07:00:00Z' WHERE "source" = 'seed';
