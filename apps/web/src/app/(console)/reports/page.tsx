import type { Metadata } from "next";
import Link from "next/link";
import { can } from "@mm/core/access";
import { formatCents } from "@mm/core/fees";
import { Bands, Columns } from "@/components/charts";
import { Operator, OperatorMark, Status } from "@/components/Mark";
import { Choice, PageHead } from "@/components/PageHead";
import { Refusal } from "@/components/Refusal";
import { count, percent, plainDay, plainShort } from "@/lib/format";
import { operatorColor } from "@/lib/meaning";
import { hourLabel, hourSpan, km, minutes, rate, typeLine } from "@/lib/report";
import { attempt } from "@/server/attempt";
import { Refused } from "@/server/guard";
import { defaultMonth, monthlyReport, reportMonths, type MonthlyReport } from "@/server/reports";
import { currentPerson } from "@/server/session";

export const metadata: Metadata = { title: "Monthly report" };

function Sheet({ title, note, aside, children }: { title: string; note?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel min-w-0 px-5 pb-3 pt-4">
      <h2 className="heading">
        {title}
        {note && <small>{note}</small>}
        {aside && <span className="aside">{aside}</span>}
      </h2>
      {children}
    </section>
  );
}

function Legend({ operators }: { operators: { slug: string; name: string }[] }) {
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1">
      {operators.map((o) => (
        <span key={o.slug} className="inline-flex items-center gap-1.5">
          <OperatorMark slug={o.slug} />
          {o.name}
        </span>
      ))}
    </span>
  );
}

function Daily({ report }: { report: MonthlyReport }) {
  // Segments stack from the top down, so the biggest fleet goes last and sits on the baseline.
  const order = [...report.operators].reverse();
  return (
    <Sheet
      title="Rides per day"
      note={report.busiest && report.quietest ? `busiest ${plainDay(report.busiest.date)} with ${count(report.busiest.total)}, quietest ${plainDay(report.quietest.date)} with ${count(report.quietest.total)}` : undefined}
    >
      <div className="pt-4">
        <Columns
          ariaLabel={`Rides per day in ${report.label}, by operator. The figures are in the table below.`}
          columns={report.daily.map((d, i) => ({
            key: d.date,
            title: `${plainDay(d.date)}: ${count(d.total)} rides (${report.operators.map((o) => `${o.name} ${count(d.byOperator[o.slug] ?? 0)}`).join(", ")})`,
            tick: i % 7 === 0 ? plainShort(d.date) : undefined,
            segments: order.map((o) => ({ key: o.slug, value: d.byOperator[o.slug] ?? 0, color: operatorColor(o.slug) })),
          }))}
        />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 pb-1 text-[0.8125rem] text-dim">
        <Legend operators={report.operators} />
        <details className="min-w-0 max-sm:w-full">
          <summary className="link cursor-pointer">Show the figures</summary>
          <div className="mt-2 max-h-72 overflow-auto">
            <table className="grid-table text-[0.875rem] text-text">
              <thead>
                <tr>
                  <th>Day</th>
                  {report.operators.map((o) => (
                    <th key={o.slug} className="r">
                      {o.name.split(" ")[0]}
                    </th>
                  ))}
                  <th className="r">All</th>
                </tr>
              </thead>
              <tbody>
                {report.daily.map((d) => (
                  <tr key={d.date}>
                    <td className="whitespace-nowrap">{plainDay(d.date)}</td>
                    {report.operators.map((o) => (
                      <td key={o.slug} className="r">
                        {count(d.byOperator[o.slug] ?? 0)}
                      </td>
                    ))}
                    <td className="r font-semibold">{count(d.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </Sheet>
  );
}

function Fleets({ report }: { report: MonthlyReport }) {
  const share = (trips: number) => percent(trips / report.city.trips);
  return (
    <Sheet title="By operator" note="rides per vehicle per day counts every vehicle on the operator's roster during the month">
      <div className="overflow-x-auto">
        <table className="grid-table stack">
          <thead>
            <tr>
              <th>Operator</th>
              <th className="r">Rides</th>
              <th className="r">Share</th>
              <th className="r">Vehicles</th>
              <th className="r">Rides per vehicle per day</th>
              <th className="r">Typical distance</th>
              <th className="r">Typical time</th>
              <th className="r">Touching an equity zone</th>
            </tr>
          </thead>
          <tbody>
            {report.operators.map((o) => (
              <tr key={o.slug}>
                <td>
                  <Operator slug={o.slug} name={o.name} />
                </td>
                <td className="r font-semibold" data-label="Rides">{count(o.trips)}</td>
                <td className="r" data-label="Share">{share(o.trips)}</td>
                <td className="r" data-label="Vehicles">{count(o.vehicles)}</td>
                <td className="r font-semibold" data-label="Rides per vehicle per day">{rate(o.perVehicleDay)}</td>
                <td className="r" data-label="Typical distance">{km(o.medianDistanceM)}</td>
                <td className="r" data-label="Typical time">{minutes(o.medianDurationS)}</td>
                <td className="r" data-label="Touching an equity zone">{o.trips > 0 ? percent(o.equityTrips / o.trips, 0) : "no data"}</td>
              </tr>
            ))}
            {report.types.map((t) => (
              <tr key={t.type} className="text-dim">
                <td>{typeLine(t.type)}</td>
                <td className="r" data-label="Rides">{count(t.trips)}</td>
                <td className="r" data-label="Share">{share(t.trips)}</td>
                <td className="r" data-label="Vehicles">{count(t.vehicles)}</td>
                <td className="r" data-label="Rides per vehicle per day">{rate(t.perVehicleDay)}</td>
                <td className="r" data-label="Typical distance">{km(t.medianDistanceM)}</td>
                <td className="r" data-label="Typical time">{minutes(t.medianDurationS)}</td>
                <td className="r" data-label="Touching an equity zone">{t.trips > 0 ? percent(t.equityTrips / t.trips, 0) : "no data"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pt-2 text-[0.8125rem] text-faint">Typical distance and time are medians: half of rides were shorter, half longer.</p>
    </Sheet>
  );
}

function Hours({ report }: { report: MonthlyReport }) {
  if (!report.peak) return null;
  const max = Math.max(...report.hours.map((h) => Math.max(h.weekday, h.weekend)));
  const row = (key: "weekday" | "weekend", name: string) => (
    <div>
      <p className="pb-1">
        <span className="font-semibold">{name}</span> <span className="text-[0.8125rem] text-dim">busiest {hourSpan(report.peak![key].hour)}, about {count(Math.round(report.peak![key][key]))} rides</span>
      </p>
      <Columns
        height={84}
        ariaLabel={`Average rides started in each hour on ${name.toLowerCase()}`}
        columns={report.hours.map((h) => ({
          key: String(h.hour),
          title: `${hourSpan(h.hour)}: about ${count(Math.round(h[key]))} rides`,
          tick: h.hour % 6 === 0 ? hourLabel(h.hour) : undefined,
          segments: [{ key: "n", value: h[key], color: "var(--color-control)" }],
        }))}
        scale={max}
      />
    </div>
  );
  return (
    <Sheet title="Peak hours" note="rides started in each hour, on an average day">
      <div className="space-y-3 pt-4">
        {row("weekday", "Weekdays")}
        {row("weekend", "Weekends")}
      </div>
    </Sheet>
  );
}

function Compliance({ report }: { report: MonthlyReport }) {
  const c = report.compliance;
  if (!c) return null;
  const weeks = c.weeks.length;
  return (
    <Sheet
      title="Rules kept"
      note={`weeks without a confirmed breach, out of ${weeks} ${weeks === 1 ? "week" : "weeks"} beginning in ${report.label}${report.closed ? "" : ", the latest still in progress"}`}
      aside={
        <Link href="/cases" className="link">
          Cases
        </Link>
      }
    >
      <div className="overflow-x-auto">
        <table className="grid-table stack">
          <thead>
            <tr>
              <th>Operator</th>
              {c.rules.map((r) => (
                <th key={r.kind} className="r">
                  {r.label}
                </th>
              ))}
              <th className="r">All rules</th>
              <th className="r">Notices sent</th>
            </tr>
          </thead>
          <tbody>
            {c.operators.map((o) => (
              <tr key={o.slug}>
                <td>
                  <Operator slug={o.slug} name={o.name} />
                </td>
                {c.rules.map((r) => {
                  const clear = weeks - (o.byRule[r.kind] ?? 0);
                  return (
                    <td key={r.kind} className="r" data-label={r.label} style={{ color: clear === weeks ? undefined : clear === 0 ? "var(--color-poor)" : "var(--color-fair)" }}>
                      <span className={clear === weeks ? "" : "font-semibold"}>
                        {clear} of {weeks}
                      </span>
                    </td>
                  );
                })}
                <td className="r font-semibold" data-label="All rules">{percent(o.rate, 0)}</td>
                <td className="r" data-label="Notices sent">{count(o.notices)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pt-2 text-[0.8125rem] text-faint">
        A week counts against an operator once an analyst has checked and counted at least one finding in it. Findings held for doubtful data, set aside, or in a withdrawn case do not count.
      </p>
    </Sheet>
  );
}

function Revenue({ report }: { report: MonthlyReport }) {
  const r = report.revenue;
  if (!r) return null;
  return (
    <Sheet
      title="Permit fees"
      note={r.rows.length === 0 ? undefined : `${formatCents(r.issuedCents)} issued, ${formatCents(r.totalCents - r.issuedCents)} still in draft`}
      aside={
        <Link href="/invoices" className="link">
          Invoices
        </Link>
      }
    >
      {r.rows.length === 0 ? (
        <p className="py-3 text-dim">{report.closed ? "No invoices have been calculated for this month." : "Invoices are calculated once the month has closed."}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="grid-table stack">
              <thead>
                <tr>
                  <th>Operator</th>
                  <th>Invoice</th>
                  <th className="r">Device fees</th>
                  <th className="r">Ride fees</th>
                  <th className="r">Billable rides</th>
                  <th className="r">Waived for equity zones</th>
                  <th className="r">Total</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((i) => (
                  <tr key={i.number}>
                    <td>
                      <Operator slug={i.slug} name={i.name} />
                    </td>
                    <td className="whitespace-nowrap" data-label="Invoice">
                      <span>
                        <Link href={`/invoices/${i.number}`} className="link">
                          {i.number}
                        </Link>{" "}
                        <Status color={i.status === "issued" ? "var(--color-good)" : "var(--color-held)"} className="ml-2">
                          {i.status === "issued" ? "Issued" : "Draft"}
                        </Status>
                      </span>
                    </td>
                    <td className="r" data-label="Device fees">{formatCents(i.deviceCents)}</td>
                    <td className="r" data-label="Ride fees">{formatCents(i.rideCents)}</td>
                    <td className="r" data-label="Billable rides">{count(i.billableTrips)}</td>
                    <td className="r" data-label="Waived for equity zones">{formatCents(i.waivedCents)}</td>
                    <td className="r font-semibold" data-label="Total">{formatCents(i.totalCents)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="font-semibold" colSpan={2}>
                    All operators
                  </td>
                  <td className="r" data-label="Device fees">{formatCents(r.rows.reduce((s, i) => s + i.deviceCents, 0))}</td>
                  <td className="r" data-label="Ride fees">{formatCents(r.rows.reduce((s, i) => s + i.rideCents, 0))}</td>
                  <td className="r" data-label="Billable rides">{count(r.rows.reduce((s, i) => s + i.billableTrips, 0))}</td>
                  <td className="r" data-label="Waived for equity zones">{formatCents(r.waivedCents)}</td>
                  <td className="r font-semibold" data-label="Total">{formatCents(r.totalCents)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="pt-2 text-[0.8125rem] text-faint">Waived for equity zones is the ride fee the city gave up on rides that touched an equity zone, at the rate on each invoice.</p>
        </>
      )}
    </Sheet>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const [person, search] = await Promise.all([currentPerson(), searchParams]);
  const months = await reportMonths();
  const chosen = months.find((m) => m.period === search.month) ?? defaultMonth(months);
  const report = await attempt(async () => monthlyReport(person, chosen?.period ?? "none"));
  if (report instanceof Refused) return <Refusal person={person} permission={report.permission} />;

  const picker = months.length > 1 && (
    <Choice current={chosen?.period ?? ""} options={[...months].reverse().map((m) => ({ key: m.period, href: `/reports?month=${m.period}`, label: m.closed ? m.label : `${m.label} so far` }))} />
  );

  if (!report || !chosen) {
    return (
      <main className="mx-auto w-full max-w-[84rem] space-y-6 px-4 py-8 lg:px-8">
        <PageHead title="Monthly report" aside={picker}>
          There are no rides on record for this month yet.
        </PageHead>
      </main>
    );
  }

  const perDay = report.city.trips / report.days;
  const figures: [label: string, value: string, note: string][] = [
    ["Rides", count(report.city.trips), `${count(Math.round(perDay))} a day on average`],
    ["Rides per vehicle per day", rate(report.city.perVehicleDay), `across ${count(report.city.vehicles)} vehicles on the rosters`],
  ];
  if (report.compliance) figures.push(["Rules kept", percent(report.compliance.rate, 0), `${count(report.compliance.ruleWeeks - report.compliance.breached)} of ${count(report.compliance.ruleWeeks)} weekly checks without a confirmed breach`]);
  if (report.revenue) figures.push(["Permit fees", report.revenue.rows.length > 0 ? formatCents(report.revenue.totalCents) : "Not yet", report.revenue.rows.length > 0 ? `${formatCents(report.revenue.issuedCents)} of it issued` : "invoiced once the month closes"]);

  const equityShare = report.city.equityTrips / report.city.trips;

  return (
    <main className="mx-auto w-full max-w-[84rem] space-y-6 px-4 py-8 lg:px-8">
      <PageHead
        title={`${report.label}${report.closed ? "" : " so far"}`}
        above="Monthly report"
        aside={
          <div className="flex flex-wrap items-center gap-3">
            {picker}
            {report.closed && can(person.role, "reports.export") && (
              <a className="btn btn-signal no-print" href={`/reports/${report.period}/pdf`}>
                Download PDF
              </a>
            )}
          </div>
        }
      >
        {report.closed ? (
          <>
            The three operators carried <strong>{count(report.city.trips)} rides</strong> on {count(report.city.vehicles)} vehicles. This is the report staff are sent on the first of the following month.
          </>
        ) : (
          <>
            <strong>{count(report.city.trips)} rides</strong> in the first {Math.floor(report.days)} days. The month is still running, so every figure here will move; the PDF is sent once it closes.
          </>
        )}
      </PageHead>

      <dl className={`panel grid divide-line overflow-hidden max-sm:divide-y sm:grid-cols-2 ${figures.length >= 4 ? "lg:grid-cols-4" : figures.length === 3 ? "lg:grid-cols-3" : ""} lg:divide-x`}>
        {figures.map(([label, value, note]) => (
          <div key={label} className="px-5 py-4">
            <dt className="label">{label}</dt>
            <dd className="figure mt-1 text-[1.75rem]">{value}</dd>
            <dd className="mt-1 text-[0.8125rem] text-dim">{note}</dd>
          </div>
        ))}
      </dl>

      <Daily report={report} />
      <Fleets report={report} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Hours report={report} />
        <Sheet title="Equity zones" note={`${percent(equityShare, 0)} of rides started, ended or passed through one`}>
          <div className="overflow-x-auto">
          <table className="grid-table stack">
            <thead>
              <tr>
                <th>Zone</th>
                <th className="r">Rides started</th>
                <th className="r">Rides ended</th>
              </tr>
            </thead>
            <tbody>
              {report.equityZones.map((z) => (
                <tr key={z.name}>
                  <td>
                    <Status color="var(--color-zone-equity)">{z.name}</Status>
                  </td>
                  <td className="r font-semibold" data-label="Rides started">{count(z.starts)}</td>
                  <td className="r font-semibold" data-label="Rides ended">{count(z.ends)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <ul className="pt-1">
            {report.operators.map((o) => (
              <li key={o.slug} className="row grid-cols-[minmax(0,1fr)_auto] last:border-b-0">
                <Operator slug={o.slug} name={o.name} />
                <span>
                  <span className="font-semibold">{o.trips > 0 ? percent(o.equityTrips / o.trips, 0) : "no data"}</span> <span className="text-[0.8125rem] text-faint">of its rides touched one</span>
                </span>
              </li>
            ))}
          </ul>
        </Sheet>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Sheet title="Ride distance" note={`typical ride ${km(report.city.medianDistanceM)}`}>
          <Bands bands={report.distance.map((b) => ({ label: b.label, value: b.trips }))} />
        </Sheet>
        <Sheet title="Ride time" note={`typical ride ${minutes(report.city.medianDurationS)}`}>
          <Bands bands={report.duration.map((b) => ({ label: b.label, value: b.trips }))} />
        </Sheet>
      </div>

      <Compliance report={report} />
      <Revenue report={report} />
      {!report.compliance && <p className="note">Your seat does not include compliance cases, so the report leaves out how the operators kept to the rules.</p>}
      {!report.revenue && <p className="note">Your seat does not include invoices, so the report leaves out permit fees.</p>}
    </main>
  );
}
