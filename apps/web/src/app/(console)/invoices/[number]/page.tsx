import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@mm/core/access";
import { CITY_NAME, monthLabel } from "@mm/core/city";
import { formatCents } from "@mm/core/fees";
import { OperatorMark, Status } from "@/components/Mark";
import { Refusal } from "@/components/Refusal";
import { count, dateTime, plainDate } from "@/lib/format";
import { verdict } from "@/lib/invoice";
import { operatorColor } from "@/lib/meaning";
import { attempt } from "@/server/attempt";
import { invoiceDetail } from "@/server/fees";
import { Refused } from "@/server/guard";
import { currentPerson } from "@/server/session";
import { issue, recalculate } from "../actions";

type Props = { params: Promise<{ number: string }>; searchParams: Promise<{ recalculated?: string; refused?: string; issued?: string; problem?: string }> };

// The invoice is drawn as a sheet of paper, and paper is the same in both themes, so its secondary text and its
// rules are fixed here rather than taken from the theme. They are used only inside the paper sheet. Both text
// colours hold 4.5:1 on the paper in either theme (#fdfcf9 light, #ece8dd dark).
const PAPER = {
  "--paper-dim": "#5b6168",
  "--paper-rule": "#c9c3b4",
  "--paper-hair": "#ddd8cb",
  "--paper-stamp": "#a33a20",
} as React.CSSProperties;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Invoice ${(await params).number}` };
}

export default async function InvoicePage({ params, searchParams }: Props) {
  const person = await currentPerson();
  const { number } = await params;
  const notice = await searchParams;
  const invoice = await attempt(() => invoiceDetail(person, number));
  if (invoice instanceof Refused) return <Refusal person={person} permission={invoice.permission} />;
  if (!invoice) notFound();

  const v = verdict(invoice);
  const mayExport = can(person.role, "invoices.export");
  const issued = invoice.status === "issued";
  const mayRecalculate = can(person.role, "invoices.generate") && !issued;
  const maySign = can(person.role, "invoices.issue");
  const signing = person.role !== "operator" && !issued && maySign;
  const needsNote = v.key !== "agree";
  const busiest = Math.max(1, ...invoice.daily.map((d) => d.trips));
  const base = `/invoices/${invoice.number}`;

  return (
    <main className="mx-auto w-full max-w-[84rem] space-y-8 px-4 py-8 lg:px-8 lg:py-11">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Link href="/invoices" className="link text-dim">
          All invoices
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {mayExport ? (
            <>
              {/* The one primary action is the sign-off when this seat can give it; otherwise it is the PDF. */}
              <a className={`btn ${signing ? "" : "btn-signal"}`} href={`${base}/pdf`}>
                Download PDF
              </a>
              <a className="btn" href={`${base}/csv`}>
                Invoice as CSV
              </a>
              <a className="btn" href={`${base}/trips`} title="One row per trip counted on this invoice. No routes and no rider details.">
                Trip ledger as CSV
              </a>
            </>
          ) : (
            <p className="text-[0.8125rem] text-dim">This seat can read invoices but not export them.</p>
          )}
          {mayRecalculate && (
            <form action={recalculate}>
              <input type="hidden" name="number" value={invoice.number} />
              <button className="btn" title="Runs the calculation again from the trip records now on file">
                Recalculate
              </button>
            </form>
          )}
        </div>
      </div>
      {notice.recalculated && (
        <p className="no-print flash text-good">
          <span>Recalculated from the trip records on file at {dateTime(invoice.generatedAt)}. The change is in the audit log.</span>
        </p>
      )}
      {notice.refused && (
        <p className="no-print flash text-poor">
          <span>This seat may not do that. The attempt is in the audit log.</span>
        </p>
      )}
      {notice.problem && (
        <p className="no-print flash text-poor">
          <span>{notice.problem}</span>
        </p>
      )}
      {notice.issued && (
        <p className="no-print flash text-good">
          <span>
            Signed off and issued. {invoice.operatorName} can now see this invoice, and it will not be recalculated.
          </span>
        </p>
      )}

      {person.role !== "operator" && (
        <section className="no-print panel p-6">
          <h2 className="heading">
            {issued ? "Signed off and issued" : maySign ? "Next step: check it and sign it off" : "Awaiting finance sign-off"}
            <Status color={issued ? "var(--color-good)" : "var(--color-fair)"} className="aside !font-semibold">
              {issued ? "Issued" : "Draft"}
            </Status>
          </h2>
          <div className="mt-4 grid items-start gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1fr)_26rem]">
            <div className="min-w-0">
              {issued ? (
                <p>
                  Signed off by <strong className="font-semibold">{invoice.issuedBy}</strong>
                  {invoice.issuedAt ? ` on ${dateTime(invoice.issuedAt)}` : ""}. {invoice.operatorName} can see it. An issued invoice is a sent document and is not recalculated.
                </p>
              ) : (
                <>
                  <p className="text-dim">
                    This is a draft. {invoice.operatorName} cannot see it until finance signs it off, and it can still be recalculated from the trip records.
                  </p>
                  <p className="mt-3">
                    <Status color={v.color}>{v.label}</Status>
                  </p>
                  <p className="mt-1">{v.headline}</p>
                </>
              )}
              {issued && invoice.issueNote && <p className="note mt-3 whitespace-pre-line text-[0.8125rem] text-dim">{invoice.issueNote}</p>}
            </div>
            {signing && (
              <form action={issue} className="space-y-3">
                <input type="hidden" name="number" value={invoice.number} />
                <label className="block">
                  <span className="label">{needsNote ? (v.key === "waiting" ? "Why issue it without the operator's report" : "Why issue it although the counts disagree") : "Note for the file (optional)"}</span>
                  <textarea name="note" required={needsNote} maxLength={600} rows={needsNote ? 3 : 2} className="field mt-1" placeholder={needsNote ? "For example: billed on the city's count as the fee schedule requires; operator told of the gap." : undefined} />
                </label>
                <button className="btn btn-signal w-full">Sign off and issue {formatCents(invoice.totalCents)}</button>
              </form>
            )}
          </div>
        </section>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* The invoice itself, as the operator receives it */}
        <article className="min-w-0 rounded-sm bg-paper p-6 text-paper-ink shadow-[var(--shadow-lg)] sm:p-9" style={PAPER}>
          <p className="border border-dashed border-[var(--paper-stamp)] px-3 py-1.5 text-center text-[0.8125rem] font-semibold text-[var(--paper-stamp)]">Demonstration document · simulated data · not a real bill</p>
          <header className="mt-6 flex flex-wrap items-start justify-between gap-4 border-b-2 border-paper-ink pb-5">
            <div className="min-w-0">
              <p className="text-[0.8125rem] text-[var(--paper-dim)]">Shared mobility permit fees</p>
              <h1 className="mt-1 text-[1.75rem] font-semibold leading-tight tracking-tight">Invoice {invoice.number}</h1>
              <p className="mt-1 text-[var(--paper-dim)]">
                {CITY_NAME} (simulated) · billing period {monthLabel(invoice.year, invoice.month)}
              </p>
            </div>
            <div className="sm:text-right">
              <p className="text-[0.8125rem] text-[var(--paper-dim)]">Billed to</p>
              <p className="mt-1 flex items-center gap-2 text-lg font-semibold sm:justify-end">
                <OperatorMark slug={invoice.operator} className="ring-1 ring-paper-ink" />
                {invoice.operatorName}
              </p>
              <p className="text-[var(--paper-dim)]">a fictional operator</p>
            </div>
          </header>

          <table className="mt-5 w-full border-collapse">
            <thead>
              <tr className="border-b border-[var(--paper-rule)] text-left text-[0.8125rem] text-[var(--paper-dim)]">
                <th className="py-2 pr-3 font-normal">Charge</th>
                <th className="hidden py-2 pr-3 text-right font-normal sm:table-cell">Quantity</th>
                <th className="py-2 text-right font-normal">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l) => (
                <tr key={l.kind} className={`border-b border-[var(--paper-hair)] align-top ${l.kind.startsWith("exempt") ? "text-[var(--paper-dim)]" : ""}`}>
                  <td className="py-2.5 pr-3">
                    {l.description}
                    <span className="block text-[0.8125rem] text-[var(--paper-dim)] sm:hidden">
                      {count(l.quantity)} {l.unitLabel}
                    </span>
                  </td>
                  <td className="hidden whitespace-nowrap py-2.5 pr-3 text-right sm:table-cell">
                    {count(l.quantity)} <span className="text-[0.8125rem] text-[var(--paper-dim)]">{l.unitLabel}</span>
                  </td>
                  <td className="whitespace-nowrap py-2.5 text-right font-semibold">{l.kind.startsWith("exempt") ? "no charge" : formatCents(l.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 flex items-baseline justify-end gap-4">
            <span className="font-semibold">Amount due</span>
            <span className="text-2xl font-semibold">{formatCents(invoice.totalCents)}</span>
          </p>

          <section className="mt-7 grid gap-5 border-t border-[var(--paper-rule)] pt-5 text-[0.8125rem] sm:grid-cols-2">
            <div>
              <h2 className="font-semibold">How the device fee was prorated</h2>
              <ul className="mt-2 space-y-1.5">
                {invoice.permits.map((p) => (
                  <li key={`${p.startDate}-${p.devices}`}>
                    <strong className="font-semibold">{count(p.devices)} devices</strong> from {plainDate(p.startDate)}
                    {p.endDate ? ` to ${plainDate(p.endDate)}` : ""}
                    {p.note ? <span className="text-[var(--paper-dim)]"> · {p.note}</span> : null}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[var(--paper-dim)]">
                {count(invoice.deviceDays)} device-days in the month, at {formatCents(invoice.schedule.perDeviceAnnualCents)} per device per year.
              </p>
            </div>
            <div>
              <h2 className="font-semibold">How the rides were counted</h2>
              <ul className="mt-2 space-y-1">
                {[
                  ["Trip records received and valid", invoice.observedTrips],
                  ["Less: equity-zone rides (exempt)", -invoice.exemptEquityTrips],
                  [`Less: rides under ${invoice.schedule.minBillableTripSeconds} seconds (exempt)`, -invoice.exemptShortTrips],
                ].map(([label, n]) => (
                  <li key={label as string} className="flex justify-between gap-3">
                    <span>{label}</span>
                    <span>{(n as number) < 0 ? `−${count(-(n as number))}` : count(n as number)}</span>
                  </li>
                ))}
                <li className="flex justify-between gap-3 border-t border-[var(--paper-rule)] pt-1 font-semibold">
                  <span>Billable rides at {formatCents(invoice.schedule.perRideCents)}</span>
                  <span>{count(invoice.billableTrips)}</span>
                </li>
              </ul>
            </div>
          </section>
          <p className="mt-6 text-[0.8125rem] text-[var(--paper-dim)]">Calculated {dateTime(invoice.generatedAt)} from the fee schedule in force for the period.</p>
        </article>

        {/* The audit: the city's count beside the operator's */}
        <div className="no-print min-w-0 space-y-6">
          <section className="panel px-6 pb-5 pt-5">
            <h2 className="heading">
              Reconciliation
              <small>against the operator&rsquo;s report</small>
              <Status color={v.color} className="aside !font-semibold">
                {v.label}
              </Status>
            </h2>
            <dl className="grid grid-cols-2 divide-x divide-line border-b border-line">
              <div className="min-w-0 py-4 pr-4">
                <dt className="label">The city counted</dt>
                <dd className="figure text-[2.375rem]">{count(invoice.observedTrips)}</dd>
                <dd className="mt-1 text-[0.8125rem] text-dim">valid trip records received</dd>
              </div>
              <div className="min-w-0 py-4 pl-4">
                <dt className="label">The operator reported</dt>
                <dd className="figure text-[2.375rem]">{invoice.reportedTrips === null ? "–" : count(invoice.reportedTrips)}</dd>
                <dd className="mt-1 text-[0.8125rem] text-dim">in its monthly report</dd>
              </div>
            </dl>
            {invoice.deltaTrips !== null && (
              <dl>
                {[
                  ["Difference", `${invoice.deltaTrips > 0 ? "+" : invoice.deltaTrips < 0 ? "−" : ""}${count(Math.abs(invoice.deltaTrips))}`],
                  ["Of the city's count", `${(invoice.deltaPct ?? 0).toFixed(2)}%`],
                  ["Fee at risk", formatCents(invoice.feeAtRiskCents ?? 0)],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-4 border-b border-line py-2.5">
                    <dt className="text-dim">{label}</dt>
                    <dd className="font-semibold" style={{ color: invoice.flagged ? v.color : undefined }}>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="mt-4 font-semibold leading-snug">{v.headline}</p>
            <p className="mt-1.5 text-dim">{v.explanation}</p>
            <p className="mt-3 text-[0.8125rem] text-faint">
              Tolerance: flagged only when the gap is over {invoice.schedule.discrepancyTolerancePct}% and over {invoice.schedule.discrepancyToleranceTrips} rides.
            </p>
          </section>

          <section className="panel px-6 pb-3 pt-5">
            <h2 className="heading">
              Trip records rejected this month
              {invoice.rejected.length > 0 && (
                <Link href="/health" className="aside link">
                  See sample records in Data health
                </Link>
              )}
            </h2>
            {invoice.rejected.length === 0 ? (
              <p className="py-3 text-dim">None. Every trip record passed the schema{invoice.rejectedTripRecords > 0 ? ` (${count(invoice.rejectedTripRecords)} were rejected, details no longer kept)` : ""}.</p>
            ) : (
              <>
                <p className="border-b border-line py-3 text-dim">
                  <strong className="font-semibold text-text">{count(invoice.rejectedTripRecords)}</strong> records failed the schema and are not counted or billed. A record can fail for more than one reason.
                </p>
                <ul>
                  {invoice.rejected.map((r) => (
                    <li key={`${r.path}|${r.message}`} className="row grid-cols-[minmax(0,1fr)_auto]">
                      <span className="min-w-0 break-words">
                        <span className="font-medium">{r.path || "(whole record)"}</span>
                        <span className="block text-[0.8125rem] text-dim">{r.message}</span>
                      </span>
                      <span className="text-right font-semibold">{count(r.count)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="panel px-6 pb-5 pt-5">
            <h2 className="heading">
              Rides counted, day by day
              <small>busiest day {count(busiest)}</small>
            </h2>
            <div className="mt-4 flex h-24 items-end gap-[2px]">
              {invoice.daily.map((d) => (
                <div key={d.date} className="flex h-full min-w-0 flex-1 items-end" title={`${plainDate(d.date)}: ${count(d.trips)} rides`}>
                  <div className="w-full rounded-t-sm" style={{ height: `${Math.max(2, (d.trips / busiest) * 100)}%`, background: operatorColor(invoice.operator) }} />
                </div>
              ))}
            </div>
            {invoice.daily.length > 0 && (
              <p className="mt-1.5 flex justify-between gap-3 text-[0.8125rem] text-faint">
                <span>{plainDate(invoice.daily[0]!.date)}</span>
                <span>{plainDate(invoice.daily.at(-1)!.date)}</span>
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
