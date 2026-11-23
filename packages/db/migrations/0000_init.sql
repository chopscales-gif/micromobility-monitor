CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"user_name" text NOT NULL,
	"role" text NOT NULL,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"operator_id" uuid,
	"allowed" boolean DEFAULT true NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "fee_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"effective_from" date NOT NULL,
	"per_device_annual_cents" integer NOT NULL,
	"per_ride_cents" integer NOT NULL,
	"min_billable_trip_seconds" integer NOT NULL,
	"exempt_equity_zone_trips" boolean NOT NULL,
	"discrepancy_tolerance_pct" real NOT NULL,
	"discrepancy_tolerance_trips" integer NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_polls" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"operator_id" uuid NOT NULL,
	"feed" text NOT NULL,
	"polled_at" timestamp with time zone NOT NULL,
	"period_hour" timestamp with time zone,
	"status_code" integer,
	"outcome" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"record_count" integer DEFAULT 0 NOT NULL,
	"invalid_count" integer DEFAULT 0 NOT NULL,
	"incomplete_count" integer DEFAULT 0 NOT NULL,
	"data_age_ms" integer,
	"stale" boolean DEFAULT false NOT NULL,
	"checked_against" text,
	"envelope_issues" jsonb
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_label" text NOT NULL,
	"amount_cents" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"operator_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"schedule" jsonb NOT NULL,
	"total_cents" integer NOT NULL,
	"device_days" integer NOT NULL,
	"observed_trips" integer NOT NULL,
	"billable_trips" integer NOT NULL,
	"exempt_equity_trips" integer NOT NULL,
	"exempt_short_trips" integer NOT NULL,
	"rejected_trip_records" integer NOT NULL,
	"reported_trips" integer,
	"delta_trips" integer,
	"delta_pct" real,
	"fee_at_risk_cents" integer,
	"flagged" boolean DEFAULT false NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "operator_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"month" text NOT NULL,
	"vehicle_type" text NOT NULL,
	"special_group" text NOT NULL,
	"trip_count" integer NOT NULL,
	"rider_count" integer NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"provider_id" uuid NOT NULL,
	"gbfs_url" text NOT NULL,
	"mds_url" text NOT NULL,
	"mds_token_encrypted" text NOT NULL,
	"ingested_through" timestamp with time zone,
	"events_through" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operators_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "permits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"devices" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "schema_errors" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"poll_id" integer NOT NULL,
	"operator_id" uuid NOT NULL,
	"feed" text NOT NULL,
	"seen_at" timestamp with time zone NOT NULL,
	"path" text NOT NULL,
	"keyword" text NOT NULL,
	"message" text NOT NULL,
	"count" integer NOT NULL,
	"sample_record_id" text,
	"sample_message" text NOT NULL,
	"sample_record" jsonb
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"station_id" text PRIMARY KEY NOT NULL,
	"operator_id" uuid NOT NULL,
	"name" text NOT NULL,
	"lng" double precision NOT NULL,
	"lat" double precision NOT NULL,
	"capacity" integer,
	"vehicles_available" integer,
	"docks_available" integer,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "status_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"operator_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"state" text NOT NULL,
	"event_types" text[] NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"lng" double precision NOT NULL,
	"lat" double precision NOT NULL,
	"battery" smallint,
	"trip_id" uuid
);
--> statement-breakpoint
CREATE TABLE "telemetry" (
	"telemetry_id" uuid PRIMARY KEY NOT NULL,
	"operator_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"trip_id" uuid,
	"ts" timestamp with time zone NOT NULL,
	"lng" double precision NOT NULL,
	"lat" double precision NOT NULL,
	"speed_mps" real,
	"battery" smallint
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"trip_id" uuid PRIMARY KEY NOT NULL,
	"operator_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"vehicle_type" text NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"billing_month" text NOT NULL,
	"duration_s" integer NOT NULL,
	"distance_m" integer NOT NULL,
	"start_lng" double precision NOT NULL,
	"start_lat" double precision NOT NULL,
	"end_lng" double precision NOT NULL,
	"end_lat" double precision NOT NULL,
	"start_h3" text NOT NULL,
	"end_h3" text NOT NULL,
	"touches_equity_zone" boolean NOT NULL,
	"ends_outside_service_area" boolean NOT NULL,
	"route" geometry(LineString, 4326),
	"max_speed_kph" real
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"title" text NOT NULL,
	"role" text NOT NULL,
	"operator_id" uuid,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vehicle_status" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"operator_id" uuid NOT NULL,
	"state" text NOT NULL,
	"event_types" text[] NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"lng" double precision NOT NULL,
	"lat" double precision NOT NULL,
	"h3" text NOT NULL,
	"battery" smallint,
	"trip_id" uuid,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"operator_id" uuid NOT NULL,
	"vehicle_code" text NOT NULL,
	"vehicle_type" text NOT NULL,
	"propulsion" text NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"geom" geometry(MultiPolygon, 4326) NOT NULL,
	"speed_limit_kph" real,
	"source" text DEFAULT 'seed' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zones_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "feed_polls" ADD CONSTRAINT "feed_polls_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_reports" ADD CONSTRAINT "operator_reports_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permits" ADD CONSTRAINT "permits_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schema_errors" ADD CONSTRAINT "schema_errors_poll_id_feed_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."feed_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schema_errors" ADD CONSTRAINT "schema_errors_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "stations_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_events" ADD CONSTRAINT "status_events_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_status" ADD CONSTRAINT "vehicle_status_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_time" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "feed_polls_operator_time" ON "feed_polls" USING btree ("operator_id","polled_at");--> statement-breakpoint
CREATE INDEX "feed_polls_feed_time" ON "feed_polls" USING btree ("operator_id","feed","polled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_period" ON "invoices" USING btree ("operator_id","year","month");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_reports_key" ON "operator_reports" USING btree ("operator_id","month","vehicle_type","special_group");--> statement-breakpoint
CREATE INDEX "schema_errors_operator_time" ON "schema_errors" USING btree ("operator_id","seen_at");--> statement-breakpoint
CREATE INDEX "status_events_device_time" ON "status_events" USING btree ("device_id","ts");--> statement-breakpoint
CREATE INDEX "status_events_operator_time" ON "status_events" USING btree ("operator_id","ts");--> statement-breakpoint
CREATE INDEX "telemetry_trip" ON "telemetry" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "telemetry_time" ON "telemetry" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "trips_operator_end" ON "trips" USING btree ("operator_id","end_time");--> statement-breakpoint
CREATE INDEX "trips_billing" ON "trips" USING btree ("operator_id","billing_month");--> statement-breakpoint
CREATE INDEX "trips_end" ON "trips" USING btree ("end_time");--> statement-breakpoint
CREATE INDEX "vehicle_status_operator" ON "vehicle_status" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "vehicles_operator" ON "vehicles" USING btree ("operator_id");--> statement-breakpoint
-- Raw location points are short-lived working data, rebuilt from the feeds if lost, so they skip the write-ahead log.
ALTER TABLE "telemetry" SET UNLOGGED;
