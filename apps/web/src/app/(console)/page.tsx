import type { Metadata } from "next";
import Link from "next/link";
import { can, ROLE_LABELS, ROLE_PURPOSES } from "@mm/core/access";
import { dueDate, dueState, LADDER_WINDOW_MONTHS, stepInfo } from "@mm/core/cases";
import { monthLabel } from "@mm/core/city";
import { formatCents } from "@mm/core/fees";
import { CaseCard } from "@/components/CaseCard";
import { Operator, Status } from "@/components/Mark";
import { PageHead } from "@/components/PageHead";
import { sentence } from "@/lib/audit";
import { CASE_STATUSES, ruleLabel } from "@/lib/cases";
import { ago, count, dateTime, plainDay, timeOnly } from "@/lib/format";
import { verdict } from "@/lib/invoice";
import { GRADES } from "@/lib/meaning";
import { myAlerts, type AlertRow } from "@/server/alerts";
import { liveCases, type CaseRow } from "@/server/cases";
import { invoiceList, type InvoiceSummary } from "@/server/fees";
import { auditPulse, feedsNow, outboxPulse, records, type FeedNow, type Record12 } from "@/server/home";
import { currentPerson, listPeople, type Person } from "@/server/session";

export const metadata: Metadata = { title: "Home" };

const TODAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "long", month: "long", day: "numeric" });

type Tile = [label: string, value: string, note: string, color: string | undefined, href: string];

/** The few counts a seat steers by, on one sheet, each a link to the list behind it. */
function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <dl className={`panel grid divide-line overflow-hidden max-sm:divide-y sm:grid-cols-2 ${tiles.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"} lg:divide-x`}>
      {tiles.map(([label, value, note, color, href]) => (
        <Link key={label} href={href} className="block px-5 py-4 transition-colors hover:bg-raise">
          <dt className="label">{label}</dt>
          <dd className="figure mt-1 text-[1.75rem]" style={{ color }}>
            {value}
          </dd>
          <dd className="mt-1 text-[0.8125rem] text-dim">{note}</dd>
        </Link>
      ))}
    </dl>
  );
}

/** A sheet with a heading, and optionally a link to the page behind it. */
function Sheet({ title, note, more, children, id }: { title: React.ReactNode; note?: React.ReactNode; more?: { href: string; label: string }; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="panel scroll-mt-4 px-5 pb-2 pt-4">
      <h2 className="heading">
        {title}
        {note && <small>{note}</small>}
        {more && (
          <Link href={more.href} className="aside link">
            {more.label}
          </Link>
        )}
      </h2>
      {children}
    </section>
  );
}

/** A group of cases that all need the same thing done, most pressing first. */
function Group({ title, why, color, cases, now, more, forOperator }: { title: string; why: string; color: string; cases: CaseRow[]; now: number; more: string; forOperator?: boolean }) {
  if (cases.length === 0) return null;
  const shown = cases.slice(0, 4);
  return (
    <Sheet
      title={
        <>
          <span style={{ color }}>{cases.length}</span> {title}
        </>
      }
      note={why}
      more={cases.length > shown.length ? { href: more, label: `See all ${cases.length}` } : undefined}
    >
      <ul>
        {shown.map((c) => (
          <li key={c.number} className="@container">
            <CaseCard c={c} now={now} forOperator={forOperator} />
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function feedState(f: FeedNow): { label: string; color: string; line: string } {
  if (f.downSince !== null) return { label: "Not answering", color: "var(--color-poor)", line: `No answer since ${timeOnly(f.downSince)}. Nothing new is arriving from this operator.` };
  const g = GRADES[f.health.grade];
  const failed = f.failedPolls > 0 ? `${count(f.failedPolls)} of ${count(f.polls)} requests failed in the last 24 hours.` : f.polls > 0 ? "Every request in the last 24 hours was answered." : "No requests on record in the last 24 hours.";
  return { label: g.label, color: g.color, line: failed };
}

function Feeds({ feeds, title = "Feeds, last 24 hours", own }: { feeds: FeedNow[]; title?: string; own?: boolean }) {
  return (
    <Sheet title={title} more={{ href: "/health", label: "Data health" }}>
      <ul>
        {feeds.map((f) => {
          const s = feedState(f);
          return (
            <li key={f.slug} className="border-b border-line py-3 last:border-b-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <Operator slug={f.slug} name={own ? "Your feeds" : f.name} />
                <Status color={s.color}>
                  {f.health.score !== null && f.downSince === null ? `${f.health.score} · ` : ""}
                  {s.label}
                </Status>
              </div>
              <p className="mt-1 text-[0.8125rem] text-dim">{s.line}</p>
              {f.held !== null && f.held > 0 && (
                <p className="mt-1 text-[0.8125rem] text-dim">
                  <Link href={`/cases?status=held&operator=${f.slug}`} className="link font-medium text-text">
                    {count(f.held)} finding{f.held === 1 ? "" : "s"} held
                  </Link>{" "}
                  because the data behind them is not firm.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

function Latest({ alerts }: { alerts: AlertRow[] }) {
  const unread = alerts.filter((a) => !a.read).slice(0, 4);
  return (
    <Sheet title="Unread alerts" more={{ href: "/alerts", label: "All alerts" }}>
      {unread.length === 0 ? (
        <p className="py-3 text-dim">Nothing unread.</p>
      ) : (
        <ul>
          {unread.map((a) => (
            <li key={a.id} className="border-b border-line py-2.5 last:border-b-0">
              <Link href="/alerts" className="font-medium leading-snug hover:underline">
                {a.urgent && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-poor align-middle" aria-label="Urgent" />}
                {a.title}
              </Link>
              <p className="text-[0.8125rem] text-faint">{ago(a.at)}</p>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function InvoiceRows({ invoices, maySign }: { invoices: InvoiceSummary[]; maySign: boolean }) {
  return (
    <ul>
      {invoices.map((i) => {
        const v = verdict(i);
        return (
          <li key={i.number}>
            <Link href={`/invoices/${i.number}`} className="row grid-cols-[1fr_auto] md:grid-cols-[10.5rem_minmax(0,1fr)_9rem_6.5rem]">
              <span>
                <Operator slug={i.operator} name={i.operatorName} />
                <span className="block text-[0.8125rem] text-faint">
                  {i.number} · {monthLabel(i.year, i.month)}
                </span>
              </span>
              <span className="min-w-0 max-md:order-3 max-md:col-span-2">
                <span className="font-medium">{v.headline}</span>
                <span className="block text-[0.8125rem] text-dim">{i.status === "issued" ? `Signed off by ${i.issuedBy}${i.issuedAt ? `, ${dateTime(i.issuedAt)}` : ""}` : v.key === "agree" ? (maySign ? "Ready for your sign-off." : "Ready for finance to sign off.") : maySign ? "Needs a note from you before it can be issued." : "Finance must explain the gap before issuing it."}</span>
              </span>
              <Status color={v.color} className="max-md:order-4">
                {v.label}
              </Status>
              <span className="text-right font-semibold max-md:order-2">{formatCents(i.totalCents)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** One operator on one line each: the three things a manager or a council office asks about it. */
function Standing({ feeds, record, cases, invoices, now }: { feeds: FeedNow[]; record: Record12[]; cases: CaseRow[]; invoices: InvoiceSummary[]; now: number }) {
  const rows = feeds
    .map((f) => {
      const r = record.find((x) => x.operatorId === f.operatorId);
      const mine = cases.filter((c) => c.operatorId === f.operatorId);
      const invoice = invoices.find((i) => i.operatorId === f.operatorId);
      return { f, top: r?.topStep ?? 0, notices: r?.notices ?? 0, worst: r?.rules[0] ?? null, live: mine.length, overdue: mine.filter((c) => c.status === "notified" && !c.replied && dueState(c.dueAt, now) === "overdue").length, disputed: mine.filter((c) => c.status === "disputed").length, invoice };
    })
    .sort((a, b) => b.top - a.top || b.notices - a.notices);
  return (
    <ol>
      {rows.map(({ f, top, notices, worst, live, overdue, disputed, invoice }, i) => {
        const color = top >= 4 ? "var(--color-poor)" : top >= 2 ? "var(--color-fair)" : top === 1 ? "var(--color-text)" : "var(--color-good)";
        const feed = feedState(f);
        const v = invoice ? verdict(invoice) : null;
        return (
          <li key={f.slug} className="grid gap-x-8 gap-y-4 border-b border-line py-4 last:border-b-0 md:grid-cols-[11rem_repeat(3,minmax(0,1fr))]">
            <div>
              <Operator slug={f.slug} name={f.name} className="text-base !font-semibold" />
              <p className="label mt-0.5">
                Standing {i + 1} of {rows.length}
              </p>
            </div>
            <div>
              <p className="label">Compliance, {LADDER_WINDOW_MONTHS} months</p>
              <p className="mt-0.5 font-semibold" style={{ color }}>
                {top === 0 ? "No notices" : `Step ${top} · ${stepInfo(top).label}`}
              </p>
              <p className="mt-1 text-[0.8125rem] text-dim">
                {top === 0 ? "Nothing has been put to this operator." : `${count(notices)} notice${notices === 1 ? "" : "s"} in all; furthest on ${worst ? ruleLabel(worst.kind).toLowerCase() : "one rule"}.`}{" "}
                <Link href={`/cases?status=all&operator=${f.slug}`} className="link font-medium text-text">
                  {count(live)} open case{live === 1 ? "" : "s"}
                </Link>
                {overdue > 0 ? <span className="text-poor">, {count(overdue)} past the reply date</span> : null}
                {disputed > 0 ? <span className="text-disputed">, {count(disputed)} disputed</span> : null}.
              </p>
            </div>
            <div>
              <p className="label">Data feeds, 24 hours</p>
              <p className="mt-0.5 font-semibold" style={{ color: feed.color }}>
                {f.health.score !== null && f.downSince === null ? `${f.health.score} · ` : ""}
                {feed.label}
              </p>
              <p className="mt-1 text-[0.8125rem] text-dim">{feed.line}</p>
            </div>
            <div>
              <p className="label">Latest invoice</p>
              {invoice && v ? (
                <>
                  <p className="mt-0.5 font-semibold">
                    {formatCents(invoice.totalCents)} <span style={{ color: v.color }}>· {v.label}</span>
                  </p>
                  <p className="mt-1 text-[0.8125rem] text-dim">
                    <Link href={`/invoices/${invoice.number}`} className="link font-medium text-text">
                      {monthLabel(invoice.year, invoice.month)}
                    </Link>
                    , {invoice.status === "issued" ? "issued" : "awaiting finance sign-off"}.
                  </p>
                </>
              ) : (
                <p className="mt-0.5 text-dim">None yet.</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const Clear = ({ children }: { children: React.ReactNode }) => (
  <div className="panel px-5 py-4">
    <p className="status text-good">All clear</p>
    <p className="mt-1 text-dim">{children}</p>
  </div>
);

const byDue = (a: CaseRow, b: CaseRow) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity);
const isOverdue = (c: CaseRow, now: number) => c.status === "notified" && !c.replied && dueState(c.dueAt, now) === "overdue";
const latestPerOperator = (invoices: InvoiceSummary[]) => invoices.filter((i, n) => invoices.findIndex((x) => x.operatorId === i.operatorId) === n);

async function Analyst({ person, now }: { person: Person; now: number }) {
  const [cases, feeds, alerts] = await Promise.all([liveCases(person), feedsNow(person), myAlerts(person)]);
  const disputes = cases.filter((c) => c.status === "disputed").sort(byDue);
  const replies = cases.filter((c) => c.status === "notified" && c.replied);
  const overdue = cases.filter((c) => isOverdue(c, now)).sort(byDue);
  const mayEscalate = can(person.role, "violations.escalate");
  const firm = cases.filter((c) => c.status === "open").sort((a, b) => b.nextStep - a.nextStep);
  // A permit-review notice is the program manager's to record, so it is not on the analyst's list of things to do.
  const toNotify = firm.filter((c) => mayEscalate || !stepInfo(c.nextStep).needsProgramManager);
  const withManager = firm.filter((c) => !toNotify.includes(c));
  const held = cases.filter((c) => c.status === "held");
  const waiting = cases.filter((c) => c.status === "notified" && !c.replied && !isOverdue(c, now)).sort(byDue);
  const mine = disputes.length + replies.length + overdue.length + toNotify.length + held.length;
  return (
    <>
      <PageHead title={`Today, ${TODAY.format(now)}`}>
        {mine === 0 ? "Nothing is waiting on you." : `${count(mine)} case${mine === 1 ? "" : "s"} waiting on you, in the order they are best worked.`} Cases waiting on an operator are at the bottom.
      </PageHead>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-6">
          {mine === 0 && <Clear>Every case is either closed or waiting on an operator. New findings are filed every ten minutes.</Clear>}
          <Group title="Disputes to decide" why="The city's own deadline is running" color={CASE_STATUSES.disputed.color} cases={disputes} now={now} more="/cases?status=disputed" />
          <Group title="Replies to read" why="The operator has answered: check it, then close or write back" color="var(--color-trip)" cases={replies} now={now} more="/cases?flag=reply" />
          <Group title="Past the reply date" why="Notified, no reply: follow up" color="var(--color-poor)" cases={overdue} now={now} more="/cases?flag=overdue" />
          <Group title="To notify" why="Firm findings the operator has not been told about" color={CASE_STATUSES.open.color} cases={toNotify} now={now} more="/cases" />
          <Group title="Held for a data check" why="Not firm enough to send as they stand" color={CASE_STATUSES.held.color} cases={held} now={now} more="/cases?status=held" />
          <Group title="With the program manager" why="Step 4 puts a permit at risk: only the program manager can record it" color="var(--color-dim)" cases={withManager} now={now} more="/cases" />
          {waiting.length > 0 && (
            <Sheet title="Waiting on operators">
              <p className="py-3 text-dim">
                <Link href="/cases?status=notified" className="link font-medium text-text">
                  {count(waiting.length)} notified case{waiting.length === 1 ? "" : "s"}
                </Link>{" "}
                inside the reply date. The next falls due {waiting[0]!.dueAt ? plainDay(dueDate(waiting[0]!.dueAt)) : "soon"} ({waiting[0]!.operatorName}, {ruleLabel(waiting[0]!.kind).toLowerCase()}).
              </p>
            </Sheet>
          )}
        </div>
        <aside className="space-y-6">
          <Feeds feeds={feeds} />
          <Latest alerts={alerts} />
        </aside>
      </div>
    </>
  );
}

async function Manager({ person, now }: { person: Person; now: number }) {
  const [cases, feeds, record, invoices, alerts] = await Promise.all([liveCases(person), feedsNow(person), records(person), invoiceList(person), myAlerts(person)]);
  const reviews = cases.filter((c) => c.status === "open" && stepInfo(c.nextStep).needsProgramManager);
  const flagged = invoices.filter((i) => i.status === "draft" && i.flagged);
  const drafts = invoices.filter((i) => i.status === "draft");
  const down = feeds.filter((f) => f.downSince !== null || f.health.grade === "poor");
  const overdue = cases.filter((c) => isOverdue(c, now));
  const tiles: Tile[] = [
    ["Permit-review notices", String(reviews.length), reviews.length === 0 ? "none waiting on you" : "only you can record these", reviews.length > 0 ? "var(--color-poor)" : "var(--color-good)", "#decisions"],
    ["Invoices not reconciling", String(flagged.length), flagged.length === 0 ? `${count(drafts.length)} awaiting finance sign-off` : flagged.map((i) => i.operatorName).join(", "), flagged.length > 0 ? "var(--color-poor)" : "var(--color-good)", "/invoices"],
    ["Feeds in trouble", String(down.length), down.length === 0 ? "all three operators answering" : down.map((f) => f.name).join(", "), down.length > 0 ? "var(--color-poor)" : "var(--color-good)", "/health"],
    ["Past the reply date", String(overdue.length), "notices an operator has not answered", overdue.length > 0 ? "var(--color-fair)" : "var(--color-good)", "/cases?flag=overdue"],
  ];
  return (
    <>
      <PageHead title="The program today">
        Where each operator stands, and the decisions only you can make. The compliance analyst works the cases day to day; finance signs off the invoices.
      </PageHead>
      <Tiles tiles={tiles} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-6">
          <Sheet title="Operators by standing" note={`furthest up the escalation ladder in the last ${LADDER_WINDOW_MONTHS} months first`}>
            <Standing feeds={feeds} record={record} cases={cases} invoices={latestPerOperator(invoices)} now={now} />
          </Sheet>
          <div id="decisions" className="scroll-mt-4">
            {reviews.length === 0 ? (
              <Sheet title="Decisions waiting on you">
                <p className="py-3 text-dim">No case is at the permit-review step. When one reaches it, the analyst cannot send the notice and you are alerted.</p>
              </Sheet>
            ) : (
              <Group title="Permit-review notices waiting on you" why="Step 4 puts a permit at risk, so the analyst cannot record it" color="var(--color-poor)" cases={reviews} now={now} more="/cases" />
            )}
          </div>
          {flagged.length > 0 && (
            <Sheet title="Invoices where the counts disagree" note="the ones an operator is likely to call you about">
              <InvoiceRows invoices={flagged} maySign={false} />
            </Sheet>
          )}
        </div>
        <aside className="space-y-6">
          <Latest alerts={alerts} />
          <Feeds feeds={feeds} />
        </aside>
      </div>
    </>
  );
}

async function Finance({ person }: { person: Person }) {
  const [invoices, feeds, alerts] = await Promise.all([invoiceList(person), feedsNow(person), myAlerts(person)]);
  const drafts = invoices.filter((i) => i.status === "draft");
  const issued = invoices.filter((i) => i.status === "issued");
  const ready = drafts.filter((i) => verdict(i).key === "agree");
  const tiles: Tile[] = [
    ["To sign off", String(drafts.length), drafts.length === 0 ? "nothing is waiting" : `${formatCents(drafts.reduce((sum, i) => sum + i.totalCents, 0))} in all`, drafts.length > 0 ? "var(--color-fair)" : "var(--color-good)", "/invoices"],
    ["Reconciled and ready", String(ready.length), "the operator's report agrees with the city's count", "var(--color-good)", "/invoices"],
    ["Need a note first", String(drafts.length - ready.length), "counts disagree, or no report was filed", drafts.length - ready.length > 0 ? "var(--color-poor)" : "var(--color-good)", "/invoices"],
    ["Issued", String(issued.length), issued.length === 0 ? "none yet" : `${formatCents(issued.reduce((sum, i) => sum + i.totalCents, 0))} billed`, undefined, "/invoices"],
  ];
  return (
    <>
      <PageHead title="Invoices waiting for your sign-off">
        Each invoice is calculated from the trip records the city received and set beside the operator&rsquo;s own report. An operator sees its invoice only once you issue it, and an issued invoice is never recalculated.
      </PageHead>
      <Tiles tiles={tiles} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-6">
          {drafts.length === 0 ? <Clear>Every invoice has been issued. The next ones are drawn up when the month&rsquo;s operator reports arrive.</Clear> : (
            <Sheet title="To sign off">
              <InvoiceRows invoices={drafts} maySign />
            </Sheet>
          )}
          {issued.length > 0 && (
            <Sheet title="Issued">
              <InvoiceRows invoices={issued} maySign />
            </Sheet>
          )}
        </div>
        <aside className="space-y-6">
          <Latest alerts={alerts} />
          <Feeds feeds={feeds} title="Feeds the counts rest on" />
          <p className="px-1 text-[0.8125rem] text-dim">Rides are counted from each operator&rsquo;s trip feed. When a feed is failing, records can be missing, and a gap against the operator&rsquo;s report is more likely.</p>
        </aside>
      </div>
    </>
  );
}

async function Administrator({ person }: { person: Person }) {
  const [feeds, pulse, mail, people, alerts] = await Promise.all([feedsNow(person), auditPulse(person), outboxPulse(person), listPeople(), myAlerts(person)]);
  const down = feeds.filter((f) => f.downSince !== null);
  const tiles: Tile[] = [
    ["Feeds not answering", String(down.length), down.length === 0 ? "all three operators answering" : down.map((f) => f.name).join(", "), down.length > 0 ? "var(--color-poor)" : "var(--color-good)", "/health"],
    ["Refused, last 24 hours", String(pulse.refusedDay), "attempts a seat was not allowed to make", pulse.refusedDay > 0 ? "var(--color-fair)" : "var(--color-good)", "/audit?only=refused"],
    ["Changes, last 24 hours", String(pulse.changesDay), `${count(pulse.day)} audit entries in all`, undefined, "/audit?only=change"],
    ["Mail in the outbox", String(mail.total), mail.last ? `last written ${ago(mail.last)}` : "nothing written yet", undefined, "/outbox"],
  ];
  return (
    <>
      <PageHead title="Is the system running">
        The feeds coming in, who holds which seat, and what the audit log has caught. This seat keeps the system running; it sees no cases and no money.
      </PageHead>
      <Tiles tiles={tiles} />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Feeds feeds={feeds} />
          <Latest alerts={alerts} />
        </div>
        <div className="space-y-6">
          <Sheet title="Latest refusals" more={{ href: "/audit?only=refused", label: "Audit log" }}>
            {pulse.refusals.length === 0 ? (
              <p className="py-3 text-dim">No seat has been refused anything.</p>
            ) : (
              <ul>
                {pulse.refusals.map((r, i) => (
                  <li key={i} className="border-b border-line py-2.5 last:border-b-0">
                    <p className="font-medium leading-snug">{sentence({ id: i, at: r.at, userName: r.userName, role: r.role, action: r.action, resource: r.resource, operatorName: null, allowed: false, detail: r.detail })}</p>
                    <p className="text-[0.8125rem] text-faint">
                      {r.userName} · {dateTime(r.at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Sheet>
          <Sheet title="Seats" more={{ href: "/access", label: "Who can do what" }}>
            <ul>
              {people.map((p) => (
                <li key={p.userId} className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-line py-2.5 last:border-b-0">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-[0.8125rem] text-dim">{ROLE_LABELS[p.role]}</span>
                </li>
              ))}
            </ul>
          </Sheet>
        </div>
      </div>
    </>
  );
}

async function Scorecard({ person, now }: { person: Person; now: number }) {
  const [cases, feeds, record, invoices] = await Promise.all([liveCases(person), feedsNow(person), records(person), invoiceList(person)]);
  return (
    <>
      <PageHead title="Operator scorecard">
        How each permitted operator is doing on three things: keeping to the rules, sending the city reliable data, and paying what its rides come to. This seat can look at everything behind these figures and change nothing.
      </PageHead>
      <Sheet title="Operators by standing" note={`furthest up the escalation ladder in the last ${LADDER_WINDOW_MONTHS} months first`}>
        <Standing feeds={feeds} record={record} cases={cases} invoices={latestPerOperator(invoices)} now={now} />
      </Sheet>
      <p className="text-[0.8125rem] text-dim">
        Every figure is measured from the operators&rsquo; own data feeds. The rules and the escalation ladder are set out under{" "}
        <Link href="/rules" className="link text-text">
          Rules
        </Link>
        . This seat is sent no alerts.
      </p>
    </>
  );
}

async function OperatorHome({ person, now }: { person: Person; now: number }) {
  const [cases, feeds, invoices, alerts, [record]] = await Promise.all([liveCases(person), feedsNow(person), invoiceList(person), myAlerts(person), records(person)]);
  const counted = record?.notices ?? 0;
  const yours = cases.filter((c) => c.status === "notified" && !c.replied).sort(byDue);
  const overdue = yours.filter((c) => isOverdue(c, now));
  const withCity = cases.filter((c) => c.status === "disputed" || (c.status === "notified" && c.replied));
  const next = yours.find((c) => !isOverdue(c, now));
  const tiles: Tile[] = [
    ["Waiting on you", String(yours.length), yours.length === 0 ? "no notice needs a reply" : overdue.length > 0 ? `${count(overdue.length)} past the reply date` : next?.dueAt ? `next reply due ${plainDay(dueDate(next.dueAt))}` : "notices to reply to", overdue.length > 0 ? "var(--color-poor)" : yours.length > 0 ? "var(--color-fair)" : "var(--color-good)", "/cases"],
    ["With the city", String(withCity.length), "you replied or disputed; the city decides next", withCity.length > 0 ? "var(--color-disputed)" : undefined, "/cases?status=all"],
    ["Notices that count against you", String(counted), counted === 0 ? "none in the last 12 months" : "in the last 12 months; see what the next one brings", counted > 0 ? "var(--color-fair)" : "var(--color-good)", "/compliance"],
    ["Invoices issued to you", String(invoices.length), invoices[0] ? `latest ${formatCents(invoices[0].totalCents)}, ${monthLabel(invoices[0].year, invoices[0].month)}` : "none yet", undefined, "/invoices"],
  ];
  return (
    <>
      <PageHead title="What the city wants from you, and by when">
        Notices the city has recorded against {person.operatorName}, where you stand on each rule, the state of the feeds you send, and the invoices issued to you. You see your own data only.
      </PageHead>
      <Tiles tiles={tiles} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-6">
          {yours.length === 0 && withCity.length === 0 && <Clear>No notice is open against you.</Clear>}
          <Group title="Reply needed" why="Say what was done, or dispute the notice if a finding is wrong" color="var(--color-fair)" cases={yours} now={now} more="/cases" forOperator />
          <Group title="With the city" why="Nothing is needed from you until the city answers" color={CASE_STATUSES.disputed.color} cases={withCity} now={now} more="/cases?status=all" forOperator />
        </div>
        <aside className="space-y-6">
          <Feeds feeds={feeds} own title="The data you send, last 24 hours" />
          <Latest alerts={alerts} />
        </aside>
      </div>
    </>
  );
}

export default async function HomePage() {
  const person = await currentPerson();
  const now = Date.now();
  return (
    <main className="mx-auto w-full max-w-[84rem] space-y-6 px-4 py-8 lg:px-8">
      {person.role === "analyst" ? (
        <Analyst person={person} now={now} />
      ) : person.role === "program_manager" ? (
        <Manager person={person} now={now} />
      ) : person.role === "finance" ? (
        <Finance person={person} />
      ) : person.role === "admin" ? (
        <Administrator person={person} />
      ) : person.role === "operator" ? (
        <OperatorHome person={person} now={now} />
      ) : (
        <Scorecard person={person} now={now} />
      )}
      <p className="border-t border-line pt-4 text-[0.8125rem] text-faint">
        This is the <strong className="text-dim">{ROLE_LABELS[person.role]}</strong> seat. {ROLE_PURPOSES[person.role]} Use the seat picker at the top to see another seat&rsquo;s home.
      </p>
    </main>
  );
}
