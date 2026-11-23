import type { Metadata } from "next";
import Link from "next/link";
import { LADDER, LADDER_WINDOW_MONTHS, stepInfo } from "@mm/core/cases";
import type { RuleParams } from "@mm/core/rules";
import { Operator, Status } from "@/components/Mark";
import { PageHead } from "@/components/PageHead";
import { Refusal } from "@/components/Refusal";
import { CASE_STATUSES, OUTCOMES, ruleLabel, weekLabel } from "@/lib/cases";
import { count, dateTime, plainDate } from "@/lib/format";
import { hourOfDay } from "@/lib/violations";
import { attempt } from "@/server/attempt";
import { Refused } from "@/server/guard";
import { currentPerson } from "@/server/session";
import { standing, type FleetNow, type OperatorStanding, type RuleStanding } from "@/server/standing";

export const metadata: Metadata = { title: "Compliance" };

const GOOD = "var(--color-good)";
const FAIR = "var(--color-fair)";
const POOR = "var(--color-poor)";
const TOP = LADDER.length;
/** The colour of a place on the ladder: nothing against you, a warning, a fine, the permit itself. */
const rungColor = (counted: number) => (counted >= TOP - 1 ? POOR : counted >= 1 ? FAIR : GOOD);
const one = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** The four rungs as a short scale, filled as far as the notices that count reach. */
function Rungs({ counted }: { counted: number }) {
  const reached = Math.min(counted, TOP);
  return (
    <span className="flex gap-1" role="img" aria-label={reached === 0 ? "No rung reached" : `Rung ${reached} of ${TOP} reached`}>
      {LADDER.map((rung) => (
        <span key={rung.step} className="h-1.5 w-7 rounded-full" style={{ background: rung.step <= reached ? rungColor(counted) : "var(--color-rule)" }} />
      ))}
    </span>
  );
}

function RuleRow({ r, you }: { r: RuleStanding; you: boolean }) {
  const next = stepInfo(r.next);
  const reached = r.counted > 0 ? stepInfo(Math.min(r.counted, TOP)) : null;
  return (
    <li className="grid gap-x-8 gap-y-3 border-b border-line py-4 last:border-b-0 md:grid-cols-[13rem_minmax(0,1fr)_minmax(0,1fr)]">
      <div>
        <Link href={`/rules#${r.kind}`} className="link font-semibold">
          {ruleLabel(r.kind)}
        </Link>
        <div className="mt-2">
          <Rungs counted={r.counted} />
        </div>
        {!r.enabled && <p className="mt-2 text-[0.8125rem] text-faint">Switched off by the city. No new findings are made.</p>}
      </div>
      <div className="min-w-0">
        <p className="font-semibold" style={{ color: rungColor(r.counted) }}>
          {reached ? `${count(r.counted)} notice${r.counted === 1 ? "" : "s"} count${r.counted === 1 ? "s" : ""} · ${reached.label}` : "Nothing counts against " + (you ? "you" : "this operator")}
        </p>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-dim">
          A {r.counted > 0 ? "further" : "first"} notice on this rule would bring <span className={`font-semibold ${next.step >= TOP ? "text-poor" : "text-text"}`}>a {next.label.toLowerCase()}</span>
          {next.step >= TOP ? `: ${next.consequence.charAt(0).toLowerCase()}${next.consequence.slice(1)}` : "."}
          {r.easesOn && <> The oldest of these stops counting on {plainDate(r.easesOn)}.</>}
        </p>
      </div>
      <div className="min-w-0">
        {r.notices.length === 0 ? (
          <p className="text-[0.8125rem] text-faint">No notice in the last {LADDER_WINDOW_MONTHS} months.</p>
        ) : (
          <ul className="space-y-1.5 text-[0.8125rem]">
            {r.notices.map((n) => (
              <li key={n.number} className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-x-3">
                <Link href={`/cases/${n.number}`} className="link text-dim">
                  {n.ref}
                </Link>
                <span className={n.counts ? "" : "text-faint"}>
                  {weekLabel(n.week)} · {n.counts ? stepInfo(n.step).label : "does not count"}
                  <span className="block text-dim" style={n.status === "resolved" ? undefined : { color: CASE_STATUSES[n.status].color }}>
                    {n.status === "resolved" ? (n.outcome ? OUTCOMES[n.outcome] : "Closed") : n.status === "disputed" ? "Disputed, with the city" : "Open"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/** A reading against a limit: the figure, the limit, and a bar showing how much room is left. */
function Reading({ label, href, value, of, state, color, share, children }: { label: string; href: string; value: string; of: string; state: string; color: string; share: number | null; children: React.ReactNode }) {
  return (
    <div className="min-w-0 px-5 py-4">
      <dt>
        <Link href={href} className="link label">
          {label}
        </Link>
      </dt>
      <dd className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="figure text-[1.75rem]">{value}</span>
        <span className="text-dim">{of}</span>
      </dd>
      {share !== null && (
        <dd className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--color-rule)" }} aria-hidden="true">
          <span className="block h-full rounded-full" style={{ width: `${Math.round(Math.min(Math.max(share, 0), 1) * 100)}%`, background: color }} />
        </dd>
      )}
      <dd className="mt-2">
        <Status color={color}>{state}</Status>
      </dd>
      <dd className="mt-1 text-[0.8125rem] leading-relaxed text-dim">{children}</dd>
    </div>
  );
}

function Now({ n, rules, you }: { n: FleetNow; rules: RuleStanding[]; you: boolean }) {
  const params = <K extends keyof RuleParams>(kind: K) => rules.find((r) => r.kind === kind)!.params as unknown as RuleParams[K];
  const cap = params("fleet_cap");
  const equity = params("equity_minimum");
  const dwell = params("parking_dwell");
  const over = n.onStreet - n.permitted;
  const sharePct = n.available > 0 ? (n.inEquity / n.available) * 100 : null;
  const short = sharePct !== null && sharePct < equity.minSharePct;
  const needed = Math.max(Math.ceil((equity.minSharePct / 100) * n.available) - n.inEquity, 0);
  const your = you ? "your" : "its";
  if (n.asOf === null) return <p className="py-4 text-dim">No vehicle status has been read from {you ? "your" : "this operator's"} feed yet.</p>;
  return (
    <>
      <dl className="-mx-5 grid divide-line max-lg:divide-y lg:grid-cols-3 lg:divide-x">
        <Reading
          label="Fleet cap"
          href="/rules#fleet_cap"
          value={count(n.onStreet)}
          of={`on the street, of ${count(n.permitted)} permitted`}
          share={n.permitted > 0 ? n.onStreet / n.permitted : null}
          color={over > 0 ? POOR : n.permitted > 0 && n.onStreet / n.permitted >= 0.97 ? FAIR : GOOD}
          state={over > 0 ? `${count(over)} over the cap` : `${count(-over)} under the cap`}
        >
          {over > 0 ? `Being over for more than ${cap.graceMinutes} minutes in a day becomes a finding.` : `Being over for ${cap.graceMinutes} minutes or less in a day is forgiven.`}
        </Reading>
        <Reading
          label="Equity zone minimum"
          href="/rules#equity_minimum"
          value={sharePct === null ? "No reading" : `${one(Math.round(sharePct * 10) / 10)}%`}
          of={sharePct === null ? "" : `of ${count(n.available)} available vehicles, ${count(n.inEquity)} in an equity zone`}
          share={sharePct === null ? null : sharePct / Math.max(equity.minSharePct * 2, 1)}
          color={n.equityZones === 0 || sharePct === null ? "var(--color-dim)" : short ? POOR : GOOD}
          state={n.equityZones === 0 ? "No equity zone is in force" : sharePct === null ? "No vehicle is available" : short ? `${count(needed)} more needed in the zones` : `Above the ${one(equity.minSharePct)}% minimum`}
        >
          The rule is judged on the count at {hourOfDay(equity.checkHour)} each day, averaged over the week. This is the share at this moment.
        </Reading>
        <Reading
          label="Parking dwell limit"
          href="/rules#parking_dwell"
          value={count(n.nearingDwell + n.pastDwell)}
          of={`vehicle${n.nearingDwell + n.pastDwell === 1 ? "" : "s"} standing over ${n.dwellWarningHours} hours`}
          share={null}
          color={n.pastDwell > 0 ? POOR : n.nearingDwell > 0 ? FAIR : GOOD}
          state={n.pastDwell > 0 ? `${count(n.pastDwell)} past the ${dwell.limitHours}-hour limit` : n.nearingDwell > 0 ? `None past ${dwell.limitHours} hours yet` : "None near the limit"}
        >
          Parked vehicles whose status has not changed in that time. Riding or collecting one ends its stay. <Link href="/map" className="link">Find them on the map</Link>.
        </Reading>
      </dl>
      <p className="-mx-5 border-t border-line px-5 pb-2 pt-3 text-[0.8125rem] leading-relaxed text-faint">
        Read from {your} own vehicle status feed at {dateTime(n.asOf)}. These are readings, not findings: a finding is made only by the method set out on the rules page, and counts only once the city records a
        notice. The rebalancing deadline and slow zone speed are judged from the full record of a day and have no reading at a single moment.
      </p>
    </>
  );
}

function Summary({ s, you }: { s: OperatorStanding; you: boolean }) {
  const worst = [...s.rules].sort((a, b) => b.counted - a.counted)[0]!;
  const total = s.rules.reduce((sum, r) => sum + r.counted, 0);
  const open = s.rules.flatMap((r) => r.notices).filter((n) => n.status !== "resolved").length;
  const left = Math.max(TOP - 1 - worst.counted, 0);
  return (
    <dl className="panel grid divide-line overflow-hidden max-sm:divide-y sm:grid-cols-3 sm:divide-x">
      <div className="px-5 py-4">
        <dt className="label">Closest to a permit review</dt>
        <dd className="figure mt-1 text-[1.375rem]" style={{ color: rungColor(worst.counted) }}>
          {worst.counted === 0 ? "No rule" : ruleLabel(worst.kind)}
        </dd>
        <dd className="mt-1 text-[0.8125rem] text-dim">
          {worst.counted === 0
            ? `nothing counts against ${you ? "you" : "this operator"} on any rule`
            : worst.counted >= TOP
              ? "the permit has been referred for a suspension review"
              : left === 0
                ? "the next notice on it refers the permit for review"
                : `${count(left)} more notice${left === 1 ? "" : "s"} before one that refers the permit`}
        </dd>
      </div>
      <div className="px-5 py-4">
        <dt className="label">Notices that count, last {LADDER_WINDOW_MONTHS} months</dt>
        <dd className="figure mt-1 text-[1.375rem]">{count(total)}</dd>
        <dd className="mt-1 text-[0.8125rem] text-dim">across {count(s.rules.filter((r) => r.counted > 0).length)} of {s.rules.length} rules; withdrawn notices are left out</dd>
      </div>
      <div className="px-5 py-4">
        <dt className="label">Still open</dt>
        <dd className="figure mt-1 text-[1.375rem]" style={{ color: open > 0 ? FAIR : GOOD }}>
          {count(open)}
        </dd>
        <dd className="mt-1 text-[0.8125rem] text-dim">
          {open === 0 ? "every notice has been closed" : <Link href="/cases" className="link">{you ? "reply to them, or see where they stand" : "see them in the case queue"}</Link>}
        </dd>
      </div>
    </dl>
  );
}

export default async function CompliancePage() {
  const person = await currentPerson();
  const all = await attempt(() => standing(person));
  if (all instanceof Refused) return <Refusal person={person} permission={all.permission} />;
  const you = person.role === "operator";

  return (
    <main className="mx-auto w-full max-w-[84rem] space-y-6 px-4 py-8 lg:px-8">
      <PageHead title={you ? "Where you stand on each rule" : "Where each operator stands on each rule"}>
        {you ? (
          <>
            The notices that count against {person.operatorName}, what the next one on each rule would bring, and how your fleet measures against the rules at this moment. Built from your own data and the notices
            the city has sent you, and nothing else.
          </>
        ) : (
          <>The notices that count against each operator, what the next one on each rule would bring, and how each fleet measures against the rules at this moment. An operator sees this page for itself alone.</>
        )}
      </PageHead>

      {all.map((s) => (
        <div key={s.slug} className="space-y-6">
          {!you && (
            <h2 className="pt-2 text-lg font-semibold tracking-tight">
              <Operator slug={s.slug} name={s.name} className="!font-semibold" />
            </h2>
          )}
          <Summary s={s} you={you} />
          <section className="panel px-5 pt-4">
            <h2 className="heading">
              {you ? "Your fleet against the rules, right now" : "The fleet against the rules, right now"}
              <small>a reading to act on before it becomes a finding</small>
            </h2>
            <Now n={s.now} rules={s.rules} you={you} />
          </section>
          <section className="panel px-5 pb-1 pt-4">
            <h2 className="heading">
              The escalation ladder, rule by rule
              <small>
                notices in the last {LADDER_WINDOW_MONTHS} months
              </small>
              <Link href="/rules#ladder" className="aside link">
                How the ladder works
              </Link>
            </h2>
            <ul>
              {s.rules.map((r) => (
                <RuleRow key={r.kind} r={r} you={you} />
              ))}
            </ul>
          </section>
        </div>
      ))}
    </main>
  );
}
