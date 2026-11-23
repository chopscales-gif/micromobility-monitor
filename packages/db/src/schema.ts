// Database schema. Times are timestamptz; money is integer cents; positions are
// WGS84 longitude and latitude, with PostGIS geometry where shapes are stored.

import { sql } from "drizzle-orm";
import {
  bigserial, boolean, customType, date, doublePrecision, index, integer, jsonb, pgTable, primaryKey, real, smallint, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

const geometry = (name: string, shape: "Polygon" | "MultiPolygon" | "LineString") =>
  customType<{ data: string }>({ dataType: () => `geometry(${shape}, 4326)` })(name);

const at = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

// --- Operators and their feeds ----------------------------------------------

export const operators = pgTable("operators", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  /** MDS provider_id the operator uses in its own data. */
  providerId: uuid("provider_id").notNull(),
  gbfsUrl: text("gbfs_url").notNull(),
  mdsUrl: text("mds_url").notNull(),
  /** Bearer token for the operator's MDS API, encrypted with TOKEN_ENCRYPTION_KEY. */
  mdsTokenEncrypted: text("mds_token_encrypted").notNull(),
  /** Hourly MDS files (trips, events, telemetry) are ingested up to, not including, this hour. */
  ingestedThrough: at("ingested_through"),
  /** Recent events are ingested up to this moment. */
  eventsThrough: at("events_through"),
  createdAt: at("created_at").notNull().defaultNow(),
});

/** One row for every request made to an operator's feed. Health scores are computed from these. */
export const feedPolls = pgTable(
  "feed_polls",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    operatorId: uuid("operator_id").notNull().references(() => operators.id),
    feed: text("feed").notNull(),
    polledAt: at("polled_at").notNull(),
    /** For hourly files: the hour the file covers. */
    periodHour: at("period_hour"),
    statusCode: integer("status_code"),
    /** ok | http_error | network_error | not_json | envelope_invalid */
    outcome: text("outcome").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    recordCount: integer("record_count").notNull().default(0),
    invalidCount: integer("invalid_count").notNull().default(0),
    /** Valid records that leave out an optional field the city relies on. */
    incompleteCount: integer("incomplete_count").notNull().default(0),
    /** Realtime feeds: how old the data said it was when it arrived. */
    dataAgeMs: integer("data_age_ms"),
    stale: boolean("stale").notNull().default(false),
    checkedAgainst: text("checked_against"),
    envelopeIssues: jsonb("envelope_issues"),
  },
  (t) => [index("feed_polls_operator_time").on(t.operatorId, t.polledAt), index("feed_polls_feed_time").on(t.operatorId, t.feed, t.polledAt)],
);

/** Records that failed schema validation, grouped by what was wrong, with one example kept. */
export const schemaErrors = pgTable(
  "schema_errors",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    pollId: integer("poll_id").notNull().references(() => feedPolls.id, { onDelete: "cascade" }),
    operatorId: uuid("operator_id").notNull().references(() => operators.id),
    feed: text("feed").notNull(),
    seenAt: at("seen_at").notNull(),
    path: text("path").notNull(),
    keyword: text("keyword").notNull(),
    /** The rule that was broken, without the offending value. */
    message: text("message").notNull(),
    count: integer("count").notNull(),
    sampleRecordId: text("sample_record_id"),
    sampleMessage: text("sample_message").notNull(),
    sampleRecord: jsonb("sample_record"),
  },
  (t) => [index("schema_errors_operator_time").on(t.operatorId, t.seenAt)],
);

// --- Vehicles -----------------------------------------------------------------

export const vehicles = pgTable(
  "vehicles",
  {
    deviceId: uuid("device_id").primaryKey(),
    operatorId: uuid("operator_id").notNull().references(() => operators.id),
    vehicleCode: text("vehicle_code").notNull(),
    /** scooter | bicycle */
    vehicleType: text("vehicle_type").notNull(),
    propulsion: text("propulsion").notNull(),
    firstSeen: at("first_seen").notNull(),
    lastSeen: at("last_seen").notNull(),
  },
  (t) => [index("vehicles_operator").on(t.operatorId)],
);

/** Where each vehicle is now, from the MDS vehicle status feed. */
export const vehicleStatus = pgTable(
  "vehicle_status",
  {
    deviceId: uuid("device_id").primaryKey(),
    operatorId: uuid("operator_id").notNull().references(() => operators.id),
    state: text("state").notNull(),
    eventTypes: text("event_types").array().notNull(),
    eventTime: at("event_time").notNull(),
    lng: doublePrecision("lng").notNull(),
    lat: doublePrecision("lat").notNull(),
    h3: text("h3").notNull(),
    battery: smallint("battery"),
    tripId: uuid("trip_id"),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [index("vehicle_status_operator").on(t.operatorId)],
);

/** Docks, for operators that have them. From GBFS station_information and station_status. */
export const stations = pgTable("stations", {
  stationId: text("station_id").primaryKey(),
  operatorId: uuid("operator_id").notNull().references(() => operators.id),
  name: text("name").notNull(),
  lng: doublePrecision("lng").notNull(),
  lat: doublePrecision("lat").notNull(),
  capacity: integer("capacity"),
  vehiclesAvailable: integer("vehicles_available"),
  docksAvailable: integer("docks_available"),
  updatedAt: at("updated_at"),
});

/** Every MDS status change. Time playback and (later) rule checks read from here. */
export const statusEvents = pgTable(
  "status_events",
  {
    eventId: uuid("event_id").primaryKey(),
    operatorId: uuid("operator_id").notNull().references(() => operators.id),
    deviceId: uuid("device_id").notNull(),
    state: text("state").notNull(),
    eventTypes: text("event_types").array().notNull(),
    ts: at("ts").notNull(),
    lng: doublePrecision("lng").notNull(),
    lat: doublePrecision("lat").notNull(),
    battery: smallint("battery"),
    tripId: uuid("trip_id"),
  },
  (t) => [index("status_events_device_time").on(t.deviceId, t.ts), index("status_events_operator_time").on(t.operatorId, t.ts)],
);

/** Raw location points. Kept only long enough to build each trip's route (about two days). */
export const telemetry = pgTable(
  "telemetry",
  {
    telemetryId: uuid("telemetry_id").primaryKey(),
    operatorId: uuid("operator_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    tripId: uuid("trip_id"),
    ts: at("ts").notNull(),
    lng: doublePrecision("lng").notNull(),
    lat: doublePrecision("lat").notNull(),
    speedMps: real("speed_mps"),
    battery: smallint("battery"),
  },
  (t) => [index("telemetry_trip").on(t.tripId), index("telemetry_time").on(t.ts)],
);

// --- Trips --------------------------------------------------------------------

export const trips = pgTable(
  "trips",
  {
    tripId: uuid("trip_id").primaryKey(),
    operatorId: uuid("operator_id").notNull().references(() => operators.id),
    deviceId: uuid("device_id").notNull(),
    vehicleType: text("vehicle_type").notNull(),
    startTime: at("start_time").notNull(),
    endTime: at("end_time").notNull(),
    /** Calendar month the trip ended in, in the city's time zone ("2026-10"). Invoices bill by this. */
    billingMonth: text("billing_month").notNull(),
    durationS: integer("duration_s").notNull(),
    distanceM: integer("distance_m").notNull(),
    startLng: doublePrecision("start_lng").notNull(),
    startLat: doublePrecision("start_lat").notNull(),
    endLng: doublePrecision("end_lng").notNull(),
    endLat: doublePrecision("end_lat").notNull(),
    startH3: text("start_h3").notNull(),
    endH3: text("end_h3").notNull(),
    touchesEquityZone: boolean("touches_equity_zone").notNull(),
    endsOutsideServiceArea: boolean("ends_outside_service_area").notNull(),
    /** The path ridden, built from telemetry. Removed once the retention window has passed. */
    route: geometry("route", "LineString"),
    maxSpeedKph: real("max_speed_kph"),
  },
  (t) => [
    index("trips_operator_end").on(t.operatorId, t.endTime),
    index("trips_billing").on(t.operatorId, t.billingMonth),
    index("trips_end").on(t.endTime),
  ],
);

// --- Zones --------------------------------------------------------------------

export const zones = pgTable("zones", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  /** service_area | no_ride | slow_ride | no_parking | required_parking | equity */
  type: text("type").notNull(),
  geom: geometry("geom", "MultiPolygon").notNull(),
  speedLimitKph: real("speed_limit_kph"),
  /** seed | upload | drawn */
  source: text("source").notNull().default("seed"),
  active: boolean("active").notNull().default(true),
  createdAt: at("created_at").notNull().defaultNow(),
  /** A zone binds from this moment and is never applied to what happened before it. */
  effectiveFrom: at("effective_from").notNull().defaultNow(),
  /** Set when the zone is retired. Shapes are never edited: a zone is retired and drawn again, so past findings keep the shape they were judged against. */
  retiredAt: at("retired_at"),
  retiredBy: text("retired_by"),
  createdBy: text("created_by"),
});

// --- Rules and violations ------------------------------------------------------

/** One row per kind of rule: fleet_cap | equity_minimum | parking_dwell | rebalancing_sla | slow_zone_speed */
export const rules = pgTable("rules", {
  kind: text("kind").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  params: jsonb("params").notNull(),
  /** When the current settings were adopted. Periods that ended before this are not judged by them. */
  effectiveFrom: at("effective_from").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: at("updated_at").notNull().defaultNow(),
});

/**
 * A case: everything one operator did against one rule in one week, Monday to Sunday.
 * The case is what staff work, what the operator is sent a notice about, and what the
 * escalation ladder counts. The findings inside it are the evidence.
 */
export const cases = pgTable(
  "cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The reference staff and operators quote, shown as C-00041. */
    number: bigserial("number", { mode: "number" }).notNull().unique(),
    ruleKind: text("rule_kind").notNull(),
    operatorId: uuid("operator_id").notNull().references(() => operators.id),
    /** The Monday the week begins, in the city's calendar. */
    weekStart: date("week_start").notNull(),
    /** held | open | notified | disputed | resolved */
    status: text("status").notNull().default("open"),
    /** Set when resolved: corrected (after a notice) | withdrawn (the city dropped it) | closed (no notice was needed) */
    outcome: text("outcome"),
    /** The rung of the escalation ladder the notice was recorded at. Fixed when the notice is recorded. */
    step: integer("step"),
    openedAt: at("opened_at").notNull(),
    notifiedAt: at("notified_at"),
    /** Notified: when the operator's response is due. Disputed: when the city's decision is due. */
    dueAt: at("due_at"),
    /** Set while an operator's reply is waiting to be read by staff. */
    repliedAt: at("replied_at"),
    statusChangedAt: at("status_changed_at"),
    statusChangedBy: text("status_changed_by"),
  },
  (t) => [uniqueIndex("cases_key").on(t.ruleKind, t.operatorId, t.weekStart), index("cases_queue").on(t.status, t.openedAt), index("cases_operator").on(t.operatorId, t.openedAt)],
);

/** What happened to a case, in order. Messages between the city and the operator are events too. */
export const caseEvents = pgTable(
  "case_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    at: at("at").notNull(),
    actorId: uuid("actor_id"),
    actorName: text("actor_name").notNull(),
    /** opened | notice | reply | dispute | upheld | withdrawn | follow_up | resolved | reopened | finding */
    kind: text("kind").notNull(),
    /** True when the operator wrote it. */
    fromOperator: boolean("from_operator").notNull().default(false),
    note: text("note"),
  },
  (t) => [index("case_events_case").on(t.caseId, t.at)],
);

/** One finding: a rule, an operator, and the day, week or parked vehicle it concerns. */
export const violations = pgTable(
  "violations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The reference staff and operators quote, shown as V-00412. */
    number: bigserial("number", { mode: "number" }).notNull().unique(),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    ruleKind: text("rule_kind").notNull(),
    operatorId: uuid("operator_id").notNull().references(() => operators.id),
    periodStart: at("period_start").notNull(),
    periodEnd: at("period_end"),
    /** The vehicle for a dwell finding; empty for findings about a whole fleet. */
    subject: text("subject").notNull().default(""),
    deviceId: uuid("device_id"),
    measured: real("measured").notNull(),
    threshold: real("threshold").notNull(),
    /** The rule's settings as they stood when the finding was made. */
    ruleParams: jsonb("rule_params").notNull(),
    evidence: jsonb("evidence").notNull(),
    /** counted | held (the data does not support it firmly enough) | set_aside (staff dropped it) */
    standing: text("standing").notNull().default("counted"),
    /** Why the rule engine held the finding back: a list of reasons, each with its figures. */
    hold: jsonb("hold"),
    /** Set when a member of staff decided the standing; the rule engine then leaves it alone. */
    standingBy: text("standing_by"),
    standingAt: at("standing_at"),
    standingNote: text("standing_note"),
    detectedAt: at("detected_at").notNull(),
    lastEvaluatedAt: at("last_evaluated_at").notNull(),
  },
  (t) => [uniqueIndex("violations_key").on(t.ruleKind, t.operatorId, t.periodStart, t.subject), index("violations_case").on(t.caseId, t.detectedAt), index("violations_operator").on(t.operatorId, t.detectedAt)],
);

/**
 * The speed readings each ride produced inside a slow zone. Kept after the ride's raw
 * location points are purged, because the speed rule is judged a day at a time.
 */
export const zonePasses = pgTable(
  "zone_passes",
  {
    tripId: uuid("trip_id").notNull(),
    zoneId: uuid("zone_id").notNull(),
    operatorId: uuid("operator_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    enteredAt: at("entered_at").notNull(),
    limitKph: real("limit_kph").notNull(),
    /** Tenths of a km/h; -1 marks a gap (the rider left and came back, or a point had no speed). */
    speeds: smallint("speeds").array().notNull(),
  },
  (t) => [primaryKey({ columns: [t.tripId, t.zoneId] }), index("zone_passes_operator").on(t.operatorId, t.enteredAt)],
);

// --- Fees ---------------------------------------------------------------------

export const feeSchedules = pgTable("fee_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  effectiveFrom: date("effective_from").notNull(),
  perDeviceAnnualCents: integer("per_device_annual_cents").notNull(),
  perRideCents: integer("per_ride_cents").notNull(),
  minBillableTripSeconds: integer("min_billable_trip_seconds").notNull(),
  exemptEquityZoneTrips: boolean("exempt_equity_zone_trips").notNull(),
  discrepancyTolerancePct: real("discrepancy_tolerance_pct").notNull(),
  discrepancyToleranceTrips: integer("discrepancy_tolerance_trips").notNull(),
  note: text("note"),
  createdBy: text("created_by").notNull(),
  createdAt: at("created_at").notNull().defaultNow(),
});

export const permits = pgTable("permits", {
  id: uuid("id").primaryKey().defaultRandom(),
  operatorId: uuid("operator_id").notNull().references(() => operators.id),
  devices: integer("devices").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  note: text("note"),
});

/** What the operator itself says it carried, from its MDS monthly report. */
export const operatorReports = pgTable(
  "operator_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operatorId: uuid("operator_id").notNull().references(() => operators.id),
    month: text("month").notNull(),
    vehicleType: text("vehicle_type").notNull(),
    specialGroup: text("special_group").notNull(),
    /** -1 means the operator withheld a count between 1 and 9, as MDS requires. */
    tripCount: integer("trip_count").notNull(),
    riderCount: integer("rider_count").notNull(),
    fetchedAt: at("fetched_at").notNull(),
  },
  (t) => [uniqueIndex("operator_reports_key").on(t.operatorId, t.month, t.vehicleType, t.specialGroup)],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: text("number").notNull().unique(),
    operatorId: uuid("operator_id").notNull().references(() => operators.id),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    /** draft | issued */
    status: text("status").notNull().default("draft"),
    /** The fee schedule as it stood when the invoice was calculated. */
    schedule: jsonb("schedule").notNull(),
    totalCents: integer("total_cents").notNull(),
    deviceDays: integer("device_days").notNull(),
    observedTrips: integer("observed_trips").notNull(),
    billableTrips: integer("billable_trips").notNull(),
    exemptEquityTrips: integer("exempt_equity_trips").notNull(),
    exemptShortTrips: integer("exempt_short_trips").notNull(),
    /** Trip records the operator sent that failed validation, so are not counted or billed. */
    rejectedTripRecords: integer("rejected_trip_records").notNull(),
    reportedTrips: integer("reported_trips"),
    deltaTrips: integer("delta_trips"),
    deltaPct: real("delta_pct"),
    feeAtRiskCents: integer("fee_at_risk_cents"),
    flagged: boolean("flagged").notNull().default(false),
    generatedAt: at("generated_at").notNull(),
    /** Set when finance signs the invoice off. An issued invoice is never recalculated. */
    issuedAt: at("issued_at"),
    issuedBy: text("issued_by"),
    issueNote: text("issue_note"),
  },
  (t) => [uniqueIndex("invoices_period").on(t.operatorId, t.year, t.month)],
);

export const invoiceLines = pgTable("invoice_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  kind: text("kind").notNull(),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  unitLabel: text("unit_label").notNull(),
  amountCents: integer("amount_cents").notNull(),
});

// --- People and the audit trail -------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  title: text("title").notNull(),
  /** admin | program_manager | finance | analyst | read_only | operator */
  role: text("role").notNull(),
  /** Set for operator-portal users: the one operator whose data they may see. */
  operatorId: uuid("operator_id").references(() => operators.id),
});

/** Every read and change of data made through the application, by whom and when. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: at("at").notNull().default(sql`now()`),
    userId: uuid("user_id"),
    userName: text("user_name").notNull(),
    role: text("role").notNull(),
    /** What was done, e.g. "read", "export", "change". */
    action: text("action").notNull(),
    /** What it was done to, e.g. "invoice", "live_map". */
    resource: text("resource").notNull(),
    operatorId: uuid("operator_id"),
    allowed: boolean("allowed").notNull().default(true),
    detail: jsonb("detail"),
  },
  (t) => [index("audit_log_time").on(t.at)],
);

// --- Alerts and the outbox ------------------------------------------------------

/** Something a person needs to know. One row per person and subject, so nobody is told the same thing twice. */
export const alerts = pgTable(
  "alerts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** What the alert is about, e.g. "case.overdue:<case>:<due date>". Unique per person. */
    key: text("key").notNull(),
    kind: text("kind").notNull(),
    at: at("at").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    href: text("href").notNull(),
    operatorId: uuid("operator_id"),
    /** Urgent alerts are emailed at once; the rest wait for the morning digest. */
    urgent: boolean("urgent").notNull().default(false),
    readAt: at("read_at"),
    emailedAt: at("emailed_at"),
  },
  (t) => [uniqueIndex("alerts_key").on(t.userId, t.key), index("alerts_user").on(t.userId, t.at)],
);

/** Email the application would have sent. Nothing leaves the demonstration: messages stop here, where they can be read. */
export const outbox = pgTable(
  "outbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: at("at").notNull(),
    toUserId: uuid("to_user_id").references(() => users.id, { onDelete: "set null" }),
    toName: text("to_name").notNull(),
    toEmail: text("to_email").notNull(),
    /** alert | digest | report */
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    /** A file the message would carry. Kept as a name and an address inside the console, and drawn when opened. */
    attachmentName: text("attachment_name"),
    attachmentHref: text("attachment_href"),
  },
  (t) => [index("outbox_time").on(t.at)],
);
