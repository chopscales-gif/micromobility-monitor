import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RULES, type RuleKind } from "@mm/core/rules";
import { Operator, Status } from "@/components/Mark";
import { PageHead } from "@/components/PageHead";
import { Refusal } from "@/components/Refusal";
import { dateTime } from "@/lib/format";
import { CASE_STATUSES, stepLabel, weekLabel } from "@/lib/cases";
import { headline, HOLD_LABELS, holdSentence, METHODS, period, reference, ruleSentence, STANDINGS, title } from "@/lib/violations";
import { attempt } from "@/server/attempt";
import { Refused } from "@/server/guard";
import { currentPerson } from "@/server/session";
import { violationDetail } from "@/server/violations";
import { Evidence } from "./Evidence";

type Props = { params: Promise<{ number: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const number = Number((await params).number);
  return { title: Number.isInteger(number) ? `Finding ${reference(number)}` : "Finding" };
}

const one = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(1));

/** The two numbers a finding turns on, with the words that go under each. */
const MEASURES: Record<RuleKind, { found: string; allowed: string; unit: string }> = {
  fleet_cap: { found: "On the street at the peak", allowed: "Permitted", unit: "" },
  equity_minimum: { found: "In equity zones, weekly average", allowed: "Minimum", unit: "%" },
  parking_dwell: { found: "Hours in one spot", allowed: "Hours allowed", unit: "" },
  rebalancing_sla: { found: "Deadlines missed that day", allowed: "Tolerated per day", unit: "" },
  slow_zone_speed: { found: "Rides over the limit", allowed: "Tolerated", unit: "%" },
};

export default async function FindingPage({ params }: Props) {
  const [person, { number: raw }] = await Promise.all([currentPerson(), params]);
  const number = /^\d{1,9}$/.test(raw) ? Number(raw) : Number.NaN;
  if (Number.isNaN(number)) notFound();

  const v = await attempt(() => violationDetail(person, number));
  if (v instanceof Refused) return <Refusal person={person} permission={v.permission} />;
  if (v === null) notFound();

  const s = STANDINGS[v.standing];
  const cs = CASE_STATUSES[v.case.status];
  const m = MEASURES[v.kind];
  const isOperator = person.role === "operator";
  const ruleChanged = v.ruleNow !== null && JSON.stringify(Object.entries(v.ruleNow.params as object).sort()) !== JSON.stringify(Object.entries(v.params as object).sort());

  return (
    <main className="mx-auto w-full max-w-[84rem] space-y-8 px-4 py-8 lg:px-8 lg:py-11">
      <PageHead
        title={title(v, v.operatorName)}
        above={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/cases/${v.case.number}#findings`} className="link">
              Back to case {v.case.ref}
            </Link>
            <span aria-hidden="true">·</span>
            <span className="font-medium text-text">{v.ref}</span>
            <span aria-hidden="true">·</span>
            <Operator slug={v.operator} name={v.operatorName} className="text-text" />
            <span aria-hidden="true">·</span>
            {RULES[v.kind].label}
          </span>
        }
        aside={<Status color={s.color}>{s.label}</Status>}
      >
        <strong>{period(v)}.</strong> {headline(v)}
      </PageHead>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-6">
          <dl className="stats grid divide-line overflow-hidden max-sm:divide-y sm:grid-cols-2 sm:divide-x">
            <div className="px-5 py-4">
              <dt className="label">{m.found}</dt>
              <dd className="figure text-[2.375rem] text-poor">
                {one(v.measured)}
                {m.unit}
              </dd>
            </div>
            <div className="px-5 py-4">
              <dt className="label">{m.allowed}</dt>
              <dd className="figure text-[2.375rem]">
                {one(v.threshold)}
                {m.unit}
              </dd>
            </div>
          </dl>
          <Evidence v={v} zones={v.zones} />
        </div>

        <aside className="space-y-6">
          <section className="panel p-6">
            <h2 className="heading">Part of case {v.case.ref}</h2>
            <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Status color={cs.color}>{cs.label}</Status>
              <span className="text-dim">{weekLabel(v.case.week)}</span>
            </p>
            {v.case.step !== null && <p className="mt-2 font-semibold">{stepLabel(v.case.step)}</p>}
            <p className="mt-2 text-[0.8125rem] text-dim">
              {isOperator ? "Reply to the notice, or dispute it, on the case." : "Findings are not acted on one at a time. Notices, replies and decisions are recorded on the case this finding belongs to."}
            </p>
            <p className="mt-4">
              <Link href={`/cases/${v.case.number}`} className="btn w-full">
                Open case {v.case.ref}
              </Link>
            </p>
          </section>

          {!isOperator && (
            <section className="panel p-6">
              <h2 className="heading">How firm this finding is</h2>
              <p className="mt-3">
                <strong className="font-semibold" style={{ color: s.color }}>
                  {s.label}.
                </strong>{" "}
                <span className="text-dim">{s.hint}.</span>
              </p>
              {v.hold.length > 0 && (
                <ul className="mt-3 border-t border-line">
                  {v.hold.map((h) => (
                    <li key={h.code} className="border-b border-line py-2.5 text-[0.8125rem]">
                      <strong className="font-semibold text-held">{HOLD_LABELS[h.code]}.</strong> <span className="text-dim">{holdSentence(h)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {v.standingBy && (
                <p className="mt-3 text-[0.8125rem] text-dim">
                  {v.standing === "counted" ? "Checked and counted" : "Set aside"} by <strong className="font-semibold text-text">{v.standingBy}</strong>
                  {v.standingAt ? `, ${dateTime(v.standingAt)}` : ""}
                  {v.standingNote ? `: “${v.standingNote}”` : ""}
                </p>
              )}
              <p className="mt-3 text-[0.8125rem] text-dim">Evidence last checked against the feeds {dateTime(v.lastEvaluatedAt)}.</p>
            </section>
          )}

          <section className="panel p-6">
            <h2 className="heading">The rule, as applied</h2>
            <p className="mt-3">{ruleSentence(v.kind, v.params)}</p>
            <p className="mt-2 text-[0.8125rem] text-dim">{METHODS[v.kind]}</p>
            {ruleChanged && <p className="note mt-3 text-[0.8125rem] text-dim">The rule&rsquo;s settings have been changed since. This finding is judged by the settings in force for its own period.</p>}
            <p className="mt-3 text-[0.8125rem]">
              <Link href="/rules" className="link">
                See all rules
              </Link>
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}
