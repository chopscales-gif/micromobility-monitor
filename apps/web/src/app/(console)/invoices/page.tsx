import type { Metadata } from "next";
import Link from "next/link";
import { can } from "@mm/core/access";
import { monthLabel } from "@mm/core/city";
import { formatCents } from "@mm/core/fees";
import { Operator, Status } from "@/components/Mark";
import { PageHead } from "@/components/PageHead";
import { Refusal } from "@/components/Refusal";
import { count, dateTime } from "@/lib/format";
import { verdict } from "@/lib/invoice";
import { attempt } from "@/server/attempt";
import { invoiceList, type InvoiceSummary } from "@/server/fees";
import { Refused } from "@/server/guard";
import { currentPerson } from "@/server/session";

export const metadata: Metadata = { title: "Invoices" };

type Tile = [label: string, value: string, note: string, color?: string];

/** One group of invoices on one sheet, a line each, with the same column slots down the list. */
function Group({ title, note, invoices }: { title: string; note?: string; invoices: InvoiceSummary[] }) {
  if (invoices.length === 0) return null;
  return (
    <section className="panel px-6 pb-3 pt-5">
      <h2 className="heading">
        {title}
        {note && <small>{note}</small>}
      </h2>
      <ul>
        {invoices.map((i) => {
          const v = verdict(i);
          return (
            <li key={i.number}>
              <Link href={`/invoices/${i.number}`} className="row grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[10.5rem_minmax(0,1fr)_9.5rem_6.5rem]">
                <span className="min-w-0">
                  <Operator slug={i.operator} name={i.operatorName} />
                  <span className="block text-[0.8125rem] text-faint">
                    {i.number} · {monthLabel(i.year, i.month)}
                  </span>
                </span>
                <span className="min-w-0 max-md:order-3 max-md:col-span-2">
                  <span className="font-medium">{v.headline}</span>
                  <span className="block text-[0.8125rem] text-dim">
                    City counted {count(i.observedTrips)} rides; operator {i.reportedTrips === null ? "has not filed" : `reported ${count(i.reportedTrips)}`}
                    {i.deltaTrips ? <span className={i.flagged ? "font-semibold text-poor" : ""}>, {i.deltaTrips > 0 ? `${count(i.deltaTrips)} short` : `${count(-i.deltaTrips)} over`}</span> : null}.
                  </span>
                  <span className="block text-[0.8125rem] text-faint">{i.status === "issued" && i.issuedAt ? `Signed off by ${i.issuedBy}, ${dateTime(i.issuedAt)}.` : `Calculated ${dateTime(i.generatedAt)}.`}</span>
                </span>
                <Status color={v.color} className="max-md:order-4 max-md:col-span-2">
                  {v.label}
                </Status>
                <span className="text-right font-semibold max-md:order-2">{formatCents(i.totalCents)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default async function InvoicesPage() {
  const person = await currentPerson();
  const invoices = await attempt(() => invoiceList(person));
  if (invoices instanceof Refused) return <Refusal person={person} permission={invoices.permission} />;

  const billed = invoices.reduce((sum, i) => sum + i.totalCents, 0);
  const flagged = invoices.filter((i) => i.flagged);
  const atRisk = invoices.reduce((sum, i) => sum + (i.feeAtRiskCents ?? 0), 0);
  const drafts = invoices.filter((i) => i.status === "draft");
  const issued = invoices.filter((i) => i.status !== "draft");
  const isOperator = person.role === "operator";
  const maySign = can(person.role, "invoices.issue");
  const tiles: Tile[] = [
    isOperator
      ? ["Billed to you", formatCents(billed), `${invoices.length} invoice${invoices.length === 1 ? "" : "s"} issued`]
      : ["Awaiting sign-off", String(drafts.length), drafts.length === 0 ? "every invoice has been issued" : maySign ? "yours to check and issue" : "with finance", drafts.length > 0 ? "var(--color-fair)" : "var(--color-good)"],
    ...(isOperator ? [] : [["Billed", formatCents(billed), `${invoices.length} invoice${invoices.length === 1 ? "" : "s"}`] as Tile]),
    ...(isOperator ? [["Rides counted by the city", count(invoices.reduce((sum, i) => sum + i.observedTrips, 0)), "from your trip records"] as Tile] : []),
    ["Counts that disagree", String(flagged.length), flagged.length === 0 ? "every report reconciled" : flagged.map((i) => i.operatorName).join(", "), flagged.length > 0 ? "var(--color-poor)" : "var(--color-good)"],
    ["Caught by the audit", formatCents(atRisk), isOperator ? "fees your own count would have missed" : "fees an operator's own count would have missed", atRisk > 0 ? "var(--color-poor)" : undefined],
  ];

  return (
    <main className="mx-auto w-full max-w-[84rem] space-y-8 px-4 py-8 lg:px-8 lg:py-11">
      <PageHead title={isOperator ? "Your monthly invoices, checked against your own report" : "Monthly invoices, checked against each operator's own report"}>
        Each invoice is calculated from the trip records the city received, never from the operator&rsquo;s summary. The operator&rsquo;s monthly report is then set beside it, and any gap
        larger than the tolerance is flagged. {isOperator ? "An invoice appears here once the city's finance office has signed it off." : "Finance signs each invoice off before the operator sees it; from then on it is never recalculated."}
      </PageHead>

      <dl className="stats grid divide-line overflow-hidden max-sm:divide-y sm:grid-cols-2 lg:grid-cols-4 lg:divide-x">
        {tiles.map(([label, value, note, color]) => (
          <div key={label} className="min-w-0 px-5 py-4">
            <dt className="label">{label}</dt>
            <dd className="figure text-[2.375rem]" style={{ color }}>
              {value}
            </dd>
            <dd className="mt-1 text-[0.8125rem] text-dim">{note}</dd>
          </div>
        ))}
      </dl>

      {invoices.length === 0 ? (
        <p className="panel p-6 text-dim">{isOperator ? "No invoice has been issued to you yet. The city's finance office signs each one off before it appears here." : "No invoices yet. One is drawn up for each operator once its monthly report arrives."}</p>
      ) : (
        <>
          <Group title="Awaiting sign-off" note={maySign ? "yours to check and issue" : "with finance; the operator cannot see these yet"} invoices={drafts} />
          <Group title={isOperator ? "Issued to you" : "Issued"} note={isOperator ? undefined : "sent to the operator and never recalculated"} invoices={issued} />
        </>
      )}
    </main>
  );
}
