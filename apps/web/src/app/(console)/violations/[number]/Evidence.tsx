import type { DwellEvidence, EquityEvidence, FleetCapEvidence, MisparkReason, SlaEvidence } from "@mm/core/rules";
import { EvidenceMapLoader } from "@/components/map/EvidenceMapLoader";
import { count, dateTime, plainDate, span, timeOnly } from "@/lib/format";
import { STATES, stateOf, TYPES } from "@/lib/meaning";
import { hourOfDay, REASONS, type SpeedEvidenceStored } from "@/lib/violations";
import type { Violation } from "@/server/violations";

type Zones = GeoJSON.FeatureCollection;

/** One fact: a caption over its value, on a hairline. Used inside a `dl` grid. */
function Fact({ label, children, color }: { label: string; children: React.ReactNode; color?: string }) {
  return (
    <div className="border-b border-line py-3">
      <dt className="label">{label}</dt>
      <dd className="mt-0.5 font-semibold" style={{ color }}>
        {children}
      </dd>
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="panel px-6 pb-5 pt-5">
      <h2 className="heading">{title}</h2>
      {note && <p className="mt-2.5 text-[0.8125rem] text-dim">{note}</p>}
      {children}
    </section>
  );
}

/** The map is drawn dark in either theme, so it stands as its own raised block; its points take fixed `hex` colours. */
function MapPanel({ zones, points, note }: { zones: Zones; points: { lng: number; lat: number; label: string; sub: string; color: string }[]; note: string }) {
  return (
    <section>
      <h2 className="heading">Where</h2>
      <p className="mt-2.5 text-[0.8125rem] text-dim">{note}</p>
      <div data-theme="light" className="relative mt-3 h-[22rem] overflow-hidden rounded-xl bg-ink text-text shadow-[var(--shadow-md)]">
        <EvidenceMapLoader zones={zones} points={points} />
      </div>
    </section>
  );
}

// The dark-theme value of the "poor" judgement, fixed for the canvas: a vehicle that overstayed.
const OVERSTAY_HEX = STATES.elsewhere.hex;

const where = (reason: MisparkReason | null, zone: string | null) => (reason === null ? "A permitted spot" : reason === "outside_area" ? REASONS.outside_area.label : `${REASONS[reason].label}: ${zone ?? "unnamed"}`);

function FleetCap({ e }: { e: FleetCapEvidence }) {
  const top = Math.max(e.peak, e.permitted) * 1.08;
  return (
    <Panel title="Vehicles on the street, hour by hour" note="The most vehicles on the street in each hour, counted from the operator's own status changes. The line is the permit.">
      <dl className="grid grid-cols-2 gap-x-6 sm:grid-cols-4">
        <Fact label="Peak" color="var(--color-poor)">
          {count(e.peak)}
        </Fact>
        <Fact label="Peak reached">{timeOnly(e.peakAt)}</Fact>
        <Fact label="Time over the cap">{span(e.minutesOver)}</Fact>
        <Fact label="Longest unbroken spell">{span(e.longestRunMinutes)}</Fact>
      </dl>
      <div className="pt-9">
        <div className="relative h-44">
          <div className="flex h-full items-end gap-[3px]" aria-hidden="true">
            {Array.from({ length: 24 }, (_, hour) => {
              const n = e.hourly[hour];
              return (
                <div
                  key={hour}
                  title={n === undefined ? `${hourOfDay(hour)}: not yet` : `${hourOfDay(hour)}: ${count(n)} vehicles`}
                  className="flex-1 rounded-t-sm"
                  style={{ height: n === undefined ? "0%" : `${Math.max(1, (n / top) * 100)}%`, background: n !== undefined && n > e.permitted ? "var(--color-poor)" : "var(--color-faint)" }}
                />
              );
            })}
          </div>
          <div className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-text" style={{ bottom: `${(e.permitted / top) * 100}%` }}>
            <span className="absolute -top-6 right-0 rounded-sm bg-panel px-1 text-[0.8125rem] font-semibold">Permit: {count(e.permitted)}</span>
          </div>
        </div>
        <div className="mt-1.5 flex justify-between text-[0.8125rem] text-faint" aria-hidden="true">
          <span>12 AM</span>
          <span>6 AM</span>
          <span>12 PM</span>
          <span>6 PM</span>
          <span>12 AM</span>
        </div>
        <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[0.8125rem] text-dim">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-poor" /> Over the permit
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-faint" /> Within the permit
          </span>
        </p>
        <table className="sr-only">
          <caption>Most vehicles on the street in each hour</caption>
          <tbody>
            {e.hourly.map((n, hour) => (
              <tr key={hour}>
                <th scope="row">{hourOfDay(hour)}</th>
                <td>{n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Equity({ e, minimum }: { e: EquityEvidence; minimum: number }) {
  const top = Math.max(minimum * 1.5, ...e.days.map((d) => d.sharePct ?? 0));
  return (
    <Panel title={`The ${hourOfDay(e.checkHour)} count, day by day`} note={`Vehicles a rider could rent, and how many of them stood inside an equity zone (${e.zones.join(", ")}).`}>
      <div className="mt-1 overflow-x-auto">
        <table className="grid-table">
          <thead>
            <tr>
              <th>Day</th>
              <th className="r">Available</th>
              <th className="r">In equity zones</th>
              <th className="r">Share</th>
              <th className="w-2/5">Against the {minimum}% minimum</th>
            </tr>
          </thead>
          <tbody>
            {e.days.map((d) => (
              <tr key={d.date}>
                <td className="whitespace-nowrap">{plainDate(d.date)}</td>
                <td className="r">{count(d.available)}</td>
                <td className="r">{count(d.inZones)}</td>
                <td className="r font-semibold" style={{ color: d.sharePct !== null && d.sharePct < minimum ? "var(--color-poor)" : "var(--color-good)" }}>
                  {d.sharePct === null ? "no data" : `${d.sharePct.toFixed(1)}%`}
                </td>
                <td>
                  <div className="relative h-3 min-w-32 rounded-sm bg-raise">
                    <div className="h-full rounded-sm" style={{ width: `${((d.sharePct ?? 0) / top) * 100}%`, background: (d.sharePct ?? 0) < minimum ? "var(--color-poor)" : "var(--color-good)" }} />
                    <div className="absolute inset-y-[-3px] border-l-2 border-dashed border-text" style={{ left: `${(minimum / top) * 100}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Dwell({ e, zones }: { e: DwellEvidence; zones: Zones }) {
  const state = stateOf(e.lastState);
  return (
    <>
      <Panel title="The vehicle" note="A stay begins when the vehicle is parked and ends when it is ridden, collected or reported somewhere else.">
        <dl className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
          <Fact label="Vehicle">
            {e.code} · {TYPES[e.vehicleType] ?? e.vehicleType}
          </Fact>
          <Fact label="Parked">{dateTime(e.parkedAt)}</Fact>
          <Fact label="Moved" color={e.movedAt === null ? "var(--color-poor)" : undefined}>
            {e.movedAt === null ? "Still there" : dateTime(e.movedAt)}
          </Fact>
          <Fact label="Time in one spot" color="var(--color-poor)">
            {span(e.hours * 60)}
          </Fact>
          <Fact label="Last reported status" color={state.color}>
            {state.label}
          </Fact>
          <Fact label="Parked in" color={e.misparked ? REASONS[e.misparked].color : undefined}>
            {where(e.misparked, e.zone)}
          </Fact>
        </dl>
      </Panel>
      <MapPanel
        zones={zones}
        note="Where the vehicle stood, over the zones in force when it was parked."
        points={[{ lng: e.lng, lat: e.lat, label: e.code, sub: `${span(e.hours * 60)} in this spot`, color: OVERSTAY_HEX }]}
      />
    </>
  );
}

function Sla({ e, zones }: { e: SlaEvidence; zones: Zones }) {
  const reasons = (Object.keys(REASONS) as MisparkReason[]).filter((r) => e.byReason[r] > 0);
  return (
    <>
      <MapPanel
        zones={zones}
        note={`Each dot is a vehicle that was left where it may not be for more than ${e.hours} hours.`}
        points={e.vehicles.map((v) => ({ lng: v.lng, lat: v.lat, label: v.code, sub: `${where(v.reason, v.zone)}, ${span(v.hours * 60)}`, color: REASONS[v.reason].hex }))}
      />
      <Panel
        title={`The ${count(e.total)} vehicles that missed the deadline`}
        note={e.vehicles.length < e.total ? `The ${e.vehicles.length} left longest are listed. The clock runs from when a vehicle is parked until it is ridden or collected.` : "The clock runs from when a vehicle is parked until it is ridden or collected."}
      >
        <p className="flex flex-wrap gap-x-5 gap-y-1 pt-3 text-[0.8125rem]">
          {reasons.map((r) => (
            <span key={r} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: REASONS[r].color }} />
              {REASONS[r].label}
              <strong className="font-semibold">{count(e.byReason[r])}</strong>
            </span>
          ))}
        </p>
        <div className="mt-1 overflow-x-auto">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Vehicle</th>
                <th>Left</th>
                <th>Parked</th>
                <th>Moved</th>
                <th className="r">Time there</th>
              </tr>
            </thead>
            <tbody>
              {e.vehicles.map((v) => (
                <tr key={`${v.deviceId}-${v.parkedAt}`}>
                  <td className="font-semibold">{v.code}</td>
                  <td>
                    <span aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: REASONS[v.reason].color }} />
                    {v.reason === "outside_area" ? "Outside the service area" : v.zone}
                  </td>
                  <td className="whitespace-nowrap">{dateTime(v.parkedAt)}</td>
                  <td className="whitespace-nowrap" style={{ color: v.movedAt === null ? "var(--color-poor)" : undefined }}>
                    {v.movedAt === null ? "Still there" : dateTime(v.movedAt)}
                  </td>
                  <td className="r font-semibold">{span(v.hours * 60)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function Speed({ e }: { e: SpeedEvidenceStored }) {
  return (
    <>
      <Panel title="By zone" note={`A ride counts as over the limit when two location readings in a row are more than ${e.toleranceKph} km/h above it.`}>
        <div className="mt-1 overflow-x-auto">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Slow zone</th>
                <th className="r">Limit</th>
                <th className="r">Rides through</th>
                <th className="r">Over the limit</th>
                <th className="r">Share</th>
              </tr>
            </thead>
            <tbody>
              {e.zones.map((z) => (
                <tr key={z.zoneId}>
                  <td className="font-semibold">{z.name}</td>
                  <td className="r">{z.limitKph} km/h</td>
                  <td className="r">{count(z.passes)}</td>
                  <td className="r">{count(z.speeding)}</td>
                  <td className="r font-semibold" style={{ color: z.speeding > 0 ? "var(--color-poor)" : undefined }}>
                    {z.passes === 0 ? "no rides" : `${((z.speeding / z.passes) * 100).toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="The fastest rides of the day" note="For follow-up with the operator. Each ride's full route is in the operator's MDS trip record.">
        <div className="mt-1 overflow-x-auto">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Vehicle</th>
                <th>Zone</th>
                <th>Entered</th>
                <th className="r">Top speed</th>
                <th className="r">Readings over</th>
                <th>Trip</th>
              </tr>
            </thead>
            <tbody>
              {e.worst.map((w) => (
                <tr key={`${w.tripId}-${w.zoneId}`}>
                  <td className="font-semibold">{w.code}</td>
                  <td>{w.zone}</td>
                  <td className="whitespace-nowrap">{timeOnly(w.enteredAt)}</td>
                  <td className="r font-semibold text-poor">{w.maxKph.toFixed(1)} km/h</td>
                  <td className="r">
                    {w.readingsOver} of {w.readings}
                  </td>
                  <td className="text-[0.8125rem] text-dim" title={w.tripId}>
                    {w.tripId.slice(0, 8)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

/** The evidence behind a finding, laid out for the rule it breaks. */
export function Evidence({ v, zones }: { v: Violation; zones: Zones }) {
  switch (v.kind) {
    case "fleet_cap":
      return <FleetCap e={v.evidence as FleetCapEvidence} />;
    case "equity_minimum":
      return <Equity e={v.evidence as EquityEvidence} minimum={v.threshold} />;
    case "parking_dwell":
      return <Dwell e={v.evidence as DwellEvidence} zones={zones} />;
    case "rebalancing_sla":
      return <Sla e={v.evidence as SlaEvidence} zones={zones} />;
    case "slow_zone_speed":
      return <Speed e={v.evidence as SpeedEvidenceStored} />;
  }
}
