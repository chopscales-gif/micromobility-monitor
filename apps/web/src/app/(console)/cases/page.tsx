import type { Metadata } from "next";
import Link from "next/link";
import { CASE_STATUSES as STATUS_ORDER, type CaseStatus } from "@mm/core/cases";
import { RULE_KINDS, RULES, type RuleKind } from "@mm/core/rules";
import { CaseCard } from "@/components/CaseCard";
import { Filter } from "@/components/Filter";
import { OperatorMark } from "@/components/Mark";
import { PageHead } from "@/components/PageHead";
import { Refusal } from "@/components/Refusal";
import { CASE_STATUSES, isCaseStatus } from "@/lib/cases";
import { count } from "@/lib/format";
import { attempt } from "@/server/attempt";
import { caseQueue, FLAGS, PAGE_SIZE, type Flag } from "@/server/cases";
import { Refused } from "@/server/guard";
import { currentPerson } from "@/server/session";

export const metadata: Metadata = { title: "Cases" };

type Props = { searchParams: Promise<{ status?: string; operator?: string; rule?: string; flag?: string; page?: string }> };

/** The order a person works them in: what needs a decision first, finished work last. */
const WORK_ORDER: CaseStatus[] = ["open", "disputed", "notified", "held", "resolved"];

export default async function CasesPage({ searchParams }: Props) {
  const [person, search] = await Promise.all([currentPerson(), searchParams]);
  const isOperator = person.role === "operator";
  const flag = FLAGS.includes(search.flag as Flag) ? (search.flag as Flag) : null;
  const fallback: CaseStatus = isOperator ? "notified" : "open";
  const status: CaseStatus | "all" = flag ? "notified" : search.status === "all" ? "all" : isCaseStatus(search.status) ? search.status : fallback;
  const rule = RULE_KINDS.includes(search.rule as RuleKind) ? (search.rule as RuleKind) : null;
  const page = Math.max(1, Math.min(500, Number.parseInt(search.page ?? "1", 10) || 1));

  const queue = await attempt(() => caseQueue(person, { status, operator: search.operator ?? null, rule, flag, page }));
  if (queue instanceof Refused) return <Refusal person={person} permission={queue.permission} />;
  const operator = queue.operators.find((o) => o.slug === search.operator)?.slug ?? null;
  const now = Date.now();

  const href = (change: Partial<{ status: string; operator: string | null; rule: string | null; flag: Flag | null; page: number }>) => {
    const next = { status, operator, rule, flag: "status" in change ? null : flag, page: 1, ...change };
    const query = new URLSearchParams();
    if (next.flag) query.set("flag", next.flag);
    else if (next.status !== fallback) query.set("status", next.status);
    if (next.operator) query.set("operator", next.operator);
    if (next.rule) query.set("rule", next.rule);
    if (next.page > 1) query.set("page", String(next.page));
    const text = query.toString();
    return text ? `/cases?${text}` : "/cases";
  };

  const { totals } = queue;
  const tiles: [label: string, value: number, note: string, color: string, link: string][] = isOperator
    ? [
        ["Waiting on you", totals.notified - totals.replies, totals.overdue > 0 ? `${count(totals.overdue)} past the reply date` : "notices the city is waiting to hear back on", totals.overdue > 0 ? "var(--color-poor)" : "var(--color-fair)", href({ status: "notified" })],
        ["With the city", totals.replies + totals.disputed, "you have replied or disputed; the city decides next", "var(--color-disputed)", href({ status: totals.disputed > 0 ? "disputed" : "notified" })],
        ["Closed", totals.resolved, `${count(totals.resolvedRecently)} in the last 30 days`, "var(--color-good)", href({ status: "resolved" })],
      ]
    : [
        ["To notify", totals.open, "firm findings the operator has not been told about", "var(--color-poor)", href({ status: "open" })],
        ["Replies to read", totals.replies, "the operator has answered; check and close", "var(--color-trip)", href({ flag: "reply" })],
        ["Past the reply date", totals.overdue, "notified, no reply, deadline gone", totals.overdue > 0 ? "var(--color-poor)" : "var(--color-good)", href({ flag: "overdue" })],
        ["Disputes to decide", totals.disputed, "the operator says the finding is wrong", "var(--color-disputed)", href({ status: "disputed" })],
        ["Held for a data check", totals.held, "not firm enough to send; nothing has gone out", "var(--color-held)", href({ status: "held" })],
      ];

  const pages = Math.max(1, Math.ceil(queue.matching / PAGE_SIZE));
  const first = (page - 1) * PAGE_SIZE + 1;
  const statuses = WORK_ORDER.filter((s) => STATUS_ORDER.includes(s) && (!isOperator || (s !== "open" && s !== "held")));

  const heading = isOperator ? (status === "all" ? "All notices" : `Notices: ${CASE_STATUSES[status].label.toLowerCase()}`) : status === "all" ? "All cases" : CASE_STATUSES[status].label;

  return (
    <main className="mx-auto w-full max-w-[84rem] space-y-8 px-4 py-8 lg:px-8 lg:py-11">
      <PageHead title={isOperator ? `Notices to ${person.operatorName}` : "Cases"}>
        {isOperator ? (
          <>Each notice covers one rule in one week, with every finding behind it and the evidence for each. You can reply to a notice or dispute it; the city closes it.</>
        ) : (
          <>
            A case is everything one operator did against one rule in one week. The rule engine files each finding into its case every ten minutes; findings the data cannot firmly support are held
            for a check instead of counted. Nothing is sent, and nothing is closed, without a member of staff.
          </>
        )}
      </PageHead>

      <dl className={`stats grid overflow-hidden sm:grid-cols-2 ${isOperator ? "lg:grid-cols-3" : "lg:grid-cols-5"}`}>
        {tiles.map(([label, value, note, color, link]) => (
          <Link key={label} href={link} className="block border-line px-5 py-4 transition-colors hover:bg-raise max-lg:border-b max-lg:last:border-b-0 sm:max-lg:odd:border-r lg:border-r lg:last:border-r-0">
            <dt className="label">{label}</dt>
            <dd className="figure text-[2.375rem]" style={{ color: value > 0 ? color : "var(--color-faint)" }}>
              {count(value)}
            </dd>
            <dd className="mt-1 text-[0.8125rem] text-dim">{note}</dd>
          </Link>
        ))}
      </dl>

      <section className="panel space-y-3 p-6" aria-label="Filters">
        <Filter
          label="Status"
          options={[
            ...statuses.map((s) => ({ href: href({ status: s }), label: CASE_STATUSES[s].label, n: queue.counts.status(s), on: status === s && !flag })),
            { href: href({ status: "all" }), label: "All", n: queue.counts.status("all"), on: status === "all" },
          ]}
        />
        {!isOperator && (
          <Filter
            label="Operator"
            options={[
              { href: href({ operator: null }), label: "All operators", n: queue.counts.operator(null), on: operator === null },
              ...queue.operators.map((o) => ({ href: href({ operator: o.slug }), label: o.name, n: queue.counts.operator(o.slug), on: operator === o.slug, mark: <OperatorMark slug={o.slug} /> })),
            ]}
          />
        )}
        <Filter
          label="Rule"
          options={[
            { href: href({ rule: null }), label: "All rules", n: queue.counts.rule(null), on: rule === null },
            ...RULE_KINDS.map((k) => ({ href: href({ rule: k }), label: RULES[k].label, n: queue.counts.rule(k), on: rule === k })),
          ]}
        />
        {flag && (
          <p className="border-t border-line pt-3">
            Showing only notified cases <strong className="font-semibold">{flag === "reply" ? "with a reply waiting to be read" : "past the reply date with no reply"}</strong>.{" "}
            <Link href={href({ flag: null })} className="link font-medium">
              Show all notified
            </Link>
          </p>
        )}
        {!flag && status !== "all" && <p className="border-t border-line pt-3 text-[0.8125rem] text-dim">{CASE_STATUSES[status].hint}.</p>}
      </section>

      <section className="panel px-6 pb-3 pt-5">
        <h2 className="heading">
          {heading}
          <small>
            {queue.rows.length === 0 ? "none to show" : `${count(first)} to ${count(first + queue.rows.length - 1)} of ${count(queue.matching)}`}
          </small>
        </h2>
        {queue.rows.length === 0 ? (
          <p className="py-3 text-dim">{queue.matching === 0 ? "Nothing matches these filters." : "There is no such page."}</p>
        ) : (
          <ul>
            {queue.rows.map((c) => (
              <li key={c.number} className="@container">
                <CaseCard c={c} now={now} forOperator={isOperator} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {queue.rows.length > 0 && (
        <nav className="flex flex-wrap items-center justify-between gap-3 text-dim" aria-label="Pages">
          <p>
            Showing <strong className="font-semibold text-text">{count(first)}</strong> to <strong className="font-semibold text-text">{count(first + queue.rows.length - 1)}</strong> of{" "}
            <strong className="font-semibold text-text">{count(queue.matching)}</strong>
            {pages > 1 ? `, page ${count(page)} of ${count(pages)}` : ""}
          </p>
          {pages > 1 && (
            <p className="flex gap-2">
              {page > 1 && (
                <Link href={href({ page: page - 1 })} className="btn">
                  Newer
                </Link>
              )}
              {page < pages && (
                <Link href={href({ page: page + 1 })} className="btn">
                  Older
                </Link>
              )}
            </p>
          )}
        </nav>
      )}
    </main>
  );
}
