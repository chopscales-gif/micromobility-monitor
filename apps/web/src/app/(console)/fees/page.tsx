import type { Metadata } from "next";
import { can } from "@mm/core/access";
import { localDate } from "@mm/core/city";
import { formatCents } from "@mm/core/fees";
import { Operator, Status } from "@/components/Mark";
import { PageHead } from "@/components/PageHead";
import { Refusal } from "@/components/Refusal";
import { count, dateOnly, plainDate } from "@/lib/format";
import { attempt } from "@/server/attempt";
import { feeSchedules, type Schedule } from "@/server/fees";
import { Refused } from "@/server/guard";
import { currentPerson } from "@/server/session";
import { adopt, withdraw } from "./actions";

export const metadata: Metadata = { title: "Fee schedule" };

type Props = { searchParams: Promise<{ problem?: string; adopted?: string; withdrawn?: string; refused?: string }> };

const terms = (s: Schedule): [label: string, value: string, note: string][] => [
  ["Per permitted device", formatCents(s.perDeviceAnnualCents), "a year, prorated by the days a permit is in force"],
  ["Per ride", formatCents(s.perRideCents), "for each billable ride in the month"],
  ["Shortest billable ride", `${s.minBillableTripSeconds} s`, "shorter rides are treated as false starts and not charged"],
  ["Equity-zone rides", s.exemptEquityZoneTrips ? "Exempt" : "Charged", s.exemptEquityZoneTrips ? "rides starting or ending in an equity zone are free of the ride fee" : "no exemption for equity zones"],
  ["Audit tolerance", `${s.discrepancyTolerancePct}% and ${count(s.discrepancyToleranceTrips)} rides`, "an operator's count is flagged only when it is off by more than both"],
];

const Adopted = ({ s }: { s: Schedule }) => (
  <p className="text-[0.8125rem] text-dim">
    {s.note ? <span className="text-text">&ldquo;{s.note}&rdquo; </span> : null}
    Adopted by {s.createdBy}, {dateOnly(s.createdAt)}.
  </p>
);

export default async function FeesPage({ searchParams }: Props) {
  const person = await currentPerson();
  const notice = await searchParams;
  const fees = await attempt(() => feeSchedules(person));
  if (fees instanceof Refused) return <Refusal person={person} permission={fees.permission} />;

  const mayChange = can(person.role, "fees.change");
  const { current, upcoming } = fees;
  const today = localDate(Date.now());
  const tomorrow = localDate(Date.now() + 86_400_000);
  const byOperator = new Map<string, typeof fees.permits>();
  for (const p of fees.permits) byOperator.set(p.operator, [...(byOperator.get(p.operator) ?? []), p]);
  const start = current ?? fees.history[0];

  return (
    <main className="mx-auto w-full max-w-[84rem] space-y-6 px-4 py-8 lg:px-8">
      <PageHead title="The fee schedule every invoice is calculated from">
        A schedule is never edited. A new one is adopted with a date it takes effect, the old one stays on record, and each invoice keeps a copy of the terms it was calculated under.
      </PageHead>

      {notice.adopted && (
        <p className="flash text-good">
          <span>New schedule adopted. It is listed below and the change is in the audit log.</span>
        </p>
      )}
      {notice.withdrawn && (
        <p className="flash text-good">
          <span>Upcoming schedule withdrawn. The change is in the audit log.</span>
        </p>
      )}
      {notice.refused && (
        <p className="flash text-poor">
          <span>This seat may not change the fee schedule. The attempt is in the audit log.</span>
        </p>
      )}
      {notice.problem && (
        <p className="flash text-poor">
          <span>Not adopted. {notice.problem}</span>
        </p>
      )}

      {current ? (
        <section className="panel px-5 pb-4 pt-4">
          <h2 className="heading">
            In force since {plainDate(current.effectiveFrom)}
            <Status color="var(--color-good)" className="aside !font-semibold">
              In force
            </Status>
          </h2>
          <div className="overflow-x-auto">
            {/* On a phone each term's explanation drops under it, so nothing is cut off at the edge. */}
            <table className="grid-table max-sm:block">
              <thead className="max-sm:block">
                <tr className="max-sm:grid max-sm:grid-cols-[1fr_auto]">
                  <th>Term</th>
                  <th className="r">Rate</th>
                  <th className="max-sm:hidden">How it applies</th>
                </tr>
              </thead>
              <tbody className="max-sm:block">
                {terms(current).map(([label, value, note]) => (
                  <tr key={label} className="max-sm:grid max-sm:grid-cols-[1fr_auto]">
                    <td className="font-medium max-sm:border-b-0 max-sm:pb-0">{label}</td>
                    <td className="r whitespace-nowrap font-semibold max-sm:border-b-0 max-sm:pb-0 max-sm:pr-0">{value}</td>
                    <td className="text-dim max-sm:col-span-2 max-sm:pt-1 max-sm:text-[0.8125rem] sm:min-w-[14rem]">{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3">
            <Adopted s={current} />
          </div>
        </section>
      ) : (
        <p className="panel p-5 text-dim">No fee schedule is in force yet.</p>
      )}

      {upcoming.map((s) => (
        <section key={s.id} className="panel px-5 pb-4 pt-4">
          <h2 className="heading">
            Takes effect {plainDate(s.effectiveFrom)}
            <Status color="var(--color-fair)" className="aside !font-semibold">
              Upcoming
            </Status>
          </h2>
          <div className="overflow-x-auto">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Term</th>
                  <th className="r">From that date</th>
                  <th className="r">Now</th>
                </tr>
              </thead>
              <tbody>
                {terms(s).map(([label, value], i) => {
                  const was = current ? terms(current)[i]![1] : value;
                  return (
                    <tr key={label}>
                      <td className="font-medium">{label}</td>
                      <td className="r whitespace-nowrap font-semibold" style={{ color: was !== value ? "var(--color-fair)" : undefined }}>
                        {value}
                      </td>
                      <td className="r whitespace-nowrap text-dim">{was !== value ? was : "no change"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <Adopted s={s} />
            {mayChange && (
              <form action={withdraw}>
                <input type="hidden" name="id" value={s.id} />
                <button className="btn">Withdraw</button>
              </form>
            )}
          </div>
        </section>
      ))}

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <section className="panel min-w-0 px-5 pb-4 pt-4">
          <h2 className="heading">
            Permitted devices
            <small>the device fee is charged on these, for the days each permit is in force</small>
          </h2>
          <div className="overflow-x-auto">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Operator</th>
                  <th className="r">Devices</th>
                  <th>In force</th>
                  <th className="max-sm:hidden">Note</th>
                </tr>
              </thead>
              {[...byOperator].map(([operator, permits]) => {
                const live = permits.filter((p) => p.startDate <= today && (!p.endDate || p.endDate >= today));
                return (
                  <tbody key={operator}>
                    <tr>
                      <td>
                        <Operator slug={operator} name={permits[0]!.operatorName} />
                      </td>
                      <td className="r font-semibold">{count(live.reduce((sum, p) => sum + p.devices, 0))}</td>
                      <td className="font-medium">Today</td>
                      <td className="max-sm:hidden" />
                    </tr>
                    {permits.map((p) => (
                      <tr key={p.id} className="text-dim">
                        <td />
                        <td className="r">{count(p.devices)}</td>
                        <td className="sm:whitespace-nowrap">
                          From {plainDate(p.startDate)}
                          {p.endDate ? ` to ${plainDate(p.endDate)}` : ""}
                          {p.note ? <span className="block text-[0.8125rem] sm:hidden">{p.note}</span> : null}
                        </td>
                        <td className="min-w-[10rem] max-sm:hidden">{p.note}</td>
                      </tr>
                    ))}
                  </tbody>
                );
              })}
            </table>
          </div>
        </section>

        <div className="min-w-0 space-y-6">
          {mayChange ? (
            <section className="panel p-5">
              <h2 className="heading">
                Adopt a new schedule
                <small>takes effect on a future date; invoices already issued keep the terms they were calculated under</small>
              </h2>
              <form action={adopt} className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="label">Takes effect</span>
                  <input className="field mt-1" type="date" name="effectiveFrom" min={tomorrow} required />
                </label>
                <label className="block">
                  <span className="label">Per device, per year ($)</span>
                  <input className="field mt-1" name="perDevice" inputMode="decimal" defaultValue={start ? (start.perDeviceAnnualCents / 100).toFixed(2) : "35.00"} required />
                </label>
                <label className="block">
                  <span className="label">Per ride ($)</span>
                  <input className="field mt-1" name="perRide" inputMode="decimal" defaultValue={start ? (start.perRideCents / 100).toFixed(2) : "0.20"} required />
                </label>
                <label className="block">
                  <span className="label">Shortest billable ride (seconds)</span>
                  <input className="field mt-1" name="minSeconds" inputMode="numeric" defaultValue={start?.minBillableTripSeconds ?? 60} required />
                </label>
                <label className="flex items-center gap-2 self-end pb-2">
                  <input type="checkbox" name="exemptEquity" defaultChecked={start?.exemptEquityZoneTrips ?? true} className="h-4 w-4" />
                  Equity-zone rides are exempt
                </label>
                <label className="block">
                  <span className="label">Audit tolerance (%)</span>
                  <input className="field mt-1" name="tolerancePct" inputMode="decimal" defaultValue={start?.discrepancyTolerancePct ?? 1} required />
                </label>
                <label className="block">
                  <span className="label">Audit tolerance (rides)</span>
                  <input className="field mt-1" name="toleranceTrips" inputMode="numeric" defaultValue={start?.discrepancyToleranceTrips ?? 25} required />
                </label>
                <label className="block sm:col-span-2">
                  <span className="label">Why it is changing</span>
                  <input className="field mt-1" name="note" maxLength={200} placeholder="For the record, in a sentence" required />
                </label>
                <div className="sm:col-span-2">
                  <button className="btn btn-signal">Adopt schedule</button>
                </div>
              </form>
            </section>
          ) : (
            <p className="panel p-5 text-dim">
              Only the program manager can adopt a new fee schedule. This seat, <strong className="font-semibold text-text">{person.name}</strong>, can read it.
            </p>
          )}

          <section className="panel px-5 pb-4 pt-4">
            <h2 className="heading">Every schedule on record</h2>
            <div className="overflow-x-auto">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Effective</th>
                    <th className="r">Device, per year</th>
                    <th className="r">Ride</th>
                    <th>Adopted by</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {fees.history.map((s) => {
                    const state = s.id === current?.id ? "In force" : s.effectiveFrom > today ? "Upcoming" : "Superseded";
                    return (
                      <tr key={s.id}>
                        <td className="whitespace-nowrap">{plainDate(s.effectiveFrom)}</td>
                        <td className="r">{formatCents(s.perDeviceAnnualCents)}</td>
                        <td className="r">{formatCents(s.perRideCents)}</td>
                        <td className="whitespace-nowrap">{s.createdBy}</td>
                        <td>
                          <Status color={state === "In force" ? "var(--color-good)" : state === "Upcoming" ? "var(--color-fair)" : "var(--color-dim)"}>{state}</Status>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
