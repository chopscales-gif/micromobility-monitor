import { clock as present } from "@mm/core/clock";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@mm/core/access";
import { caseReference, dueDate, LADDER, LADDER_WINDOW_MONTHS, RESPONSE_WORKING_DAYS, stepInfo, workingDaysAfter, type CaseAction } from "@mm/core/cases";
import { findingsLine } from "@/components/CaseCard";
import { Operator, Status } from "@/components/Mark";
import { PageHead } from "@/components/PageHead";
import { Refusal } from "@/components/Refusal";
import { CASE_STATUSES, caseTitle, clock, EVENTS, OUTCOMES, ruleLabel, stepLabel, weekLabel } from "@/lib/cases";
import { count, dateTime, plainDay } from "@/lib/format";
import { headline, HOLD_LABELS, holdSentence, period, STANDINGS } from "@/lib/violations";
import { attempt } from "@/server/attempt";
import { caseDetail, type CaseDetail, type CaseFinding } from "@/server/cases";
import { Refused } from "@/server/guard";
import { currentPerson } from "@/server/session";
import { ruleOn, step } from "../actions";

type Props = { params: Promise<{ number: string }>; searchParams: Promise<{ done?: string; problem?: string; refused?: string }> };

/** The same states, said to the operator the case is about. */
const OPERATOR_HINTS: Partial<Record<string, string>> = {
  notified: "The city is waiting for your reply",
  disputed: "You have disputed this notice. The city's clock is running",
  resolved: "Closed by the city, with a note saying how",
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const number = Number((await params).number);
  return { title: Number.isInteger(number) ? `Case ${caseReference(number)}` : "Case" };
}

const DONE: Record<string, string> = {
  notice: "Notice recorded. The operator can now see this case, your message and the evidence, and its reply date is running.",
  close: "Closed without a notice. It does not count against the operator on the ladder.",
  reply: "Reply sent to the city. The analyst will check it and close the case or write back.",
  dispute: "Dispute filed. The reply date is suspended; the city now has five working days to decide.",
  uphold: "Decision recorded: the notice stands. The operator has a new reply date.",
  withdraw: "Notice withdrawn. The case is closed and no longer counts against the operator on the ladder.",
  follow_up: "Sent. The operator has a new reply date.",
  resolve: "Closed as put right. The notice stays on the operator's record.",
  reopen: "Reopened. The case is back with the findings to notify.",
  counted: "Finding checked and counted. It can now be put to the operator.",
  set_aside: "Finding set aside. It no longer counts.",
};

function NoteForm({ number, action, label, button, placeholder, value, signal, optional }: { number: number; action: CaseAction; label: string; button: string; placeholder?: string; value?: string; signal?: boolean; optional?: boolean }) {
  return (
    <form action={step} className="space-y-3">
      <input type="hidden" name="number" value={number} />
      <input type="hidden" name="action" value={action} />
      <label className="block">
        <span className="label">{label}</span>
        <textarea name="note" required={!optional} maxLength={1200} rows={value ? 9 : 3} defaultValue={value} placeholder={placeholder} className="field mt-1.5 leading-relaxed" />
      </label>
      <button type="submit" className={`btn w-full ${signal ? "btn-signal" : ""}`}>
        {button}
      </button>
    </form>
  );
}

function More({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="border-t border-line pt-3">
      <summary className="cursor-pointer font-medium text-dim hover:text-text">{summary}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

/** A message one side wrote to the other, quoted with who wrote it and when. */
function Quote({ note, by, at }: { note: string; by: string; at: number }) {
  return (
    <blockquote className="note">
      <p className="whitespace-pre-line leading-relaxed">{note}</p>
      <footer className="mt-1.5 text-[0.8125rem] text-faint">
        {by}, {dateTime(at)}
      </footer>
    </blockquote>
  );
}

/** One of the action sheets in the side column: a heading that says whose move it is, then the forms. */
function Action({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section className="panel p-6">
      <h2 className="heading">{title}</h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

/** The four rungs, top to bottom, with the one this case sits on, or would land on, marked. */
function Ladder({ c, forOperator }: { c: CaseDetail; forOperator: boolean }) {
  const at = c.step ?? c.nextStep;
  const counted = c.history.filter((h) => h.counts);
  const withdrawn = c.history.filter((h) => !h.counts);
  return (
    <section className="panel px-6 pb-5 pt-5">
      <h2 className="heading">
        Escalation ladder
        <small>{ruleLabel(c.kind)}</small>
      </h2>
      <p className="mt-3 text-dim">
        {c.step !== null ? "This notice was recorded at" : c.status === "resolved" ? "No notice was recorded. One would have been" : "A notice recorded now would be"} <strong className="font-semibold text-text">step {at}</strong>.
      </p>
      <ol className="mt-3">
        {LADDER.map((rung, i) => {
          const here = rung.step === at;
          const passed = rung.step < at;
          const upNext = rung.step === at + 1;
          const color = rung.step >= 4 ? "var(--color-poor)" : rung.step >= 2 ? "var(--color-fair)" : "var(--color-text)";
          const earlier = counted.filter((h) => h.step === rung.step);
          return (
            <li key={rung.step} className={`relative pb-4 pl-7 last:pb-0 ${passed ? "text-faint" : here ? "" : "text-dim"}`} aria-current={here ? "step" : undefined}>
              {i < LADDER.length - 1 && <span aria-hidden="true" className="absolute bottom-0 left-[0.3125rem] top-2 w-px bg-line" />}
              <span
                aria-hidden="true"
                className={`absolute left-0 top-[0.3125rem] h-[0.6875rem] w-[0.6875rem] rounded-full border ${here ? "" : passed ? "border-rule bg-rule" : "border-rule bg-panel"}`}
                style={here ? { background: color, borderColor: color } : undefined}
              />
              <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className={here ? "text-[0.9375rem] font-semibold text-text" : passed ? "" : "font-medium"}>
                  Step {rung.step} · {rung.label}
                </span>
                {here ? (
                  <Status color={color}>{c.step !== null ? "This notice" : c.status === "resolved" ? "Where a notice would have landed" : "Where a notice would land now"}</Status>
                ) : passed ? (
                  <span className="text-[0.8125rem]">Already used</span>
                ) : null}
              </p>
              <p className="mt-0.5 text-[0.8125rem]">
                {rung.consequence}
                {rung.needsProgramManager ? " Only the program manager can record it." : ""}
              </p>
              {upNext && (
                <p className="mt-0.5 text-[0.8125rem]">
                  {c.step !== null
                    ? `Reached by the next notice on this rule, if one is recorded within ${LADDER_WINDOW_MONTHS} months of this one.`
                    : `Reached by the notice after this one, if both are recorded within ${LADDER_WINDOW_MONTHS} months.`}
                </p>
              )}
              {earlier.length > 0 && (
                <p className="mt-0.5 text-[0.8125rem]">
                  {here ? "Also recorded at this step: " : "Recorded in "}
                  {earlier.map((h, n) => (
                    <span key={h.number}>
                      {n > 0 ? ", " : ""}
                      <Link href={`/cases/${h.number}`} className="link">
                        {h.ref}
                      </Link>{" "}
                      ({weekLabel(h.week).replace(/^Week/, "week")})
                    </span>
                  ))}
                  .
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-4 border-t border-line pt-3 text-[0.8125rem] leading-relaxed text-dim">
        {counted.length === 0
          ? `${forOperator ? "You have" : `${c.operatorName} has`} had no earlier notice on this rule in the last ${LADDER_WINDOW_MONTHS} months, so the ladder starts at the bottom.`
          : `The step is set by earlier notices on this same rule in the last ${LADDER_WINDOW_MONTHS} months: ${count(counted.length)} so far. A notice that is withdrawn does not count.`}
        {withdrawn.length > 0 && (
          <>
            {" "}
            Withdrawn, so not counted:{" "}
            {withdrawn.map((h, n) => (
              <span key={h.number}>
                {n > 0 ? ", " : ""}
                <Link href={`/cases/${h.number}`} className="link">
                  {h.ref}
                </Link>{" "}
                ({weekLabel(h.week).replace(/^Week/, "week")})
              </span>
            ))}
            .
          </>
        )}
      </p>
    </section>
  );
}

function FindingRow({ f, caseNumber, mayRule, closed }: { f: CaseFinding; caseNumber: number; mayRule: boolean; closed: boolean }) {
  const s = STANDINGS[f.standing];
  return (
    <li className="border-b border-line py-3 last:border-b-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 md:grid-cols-[minmax(0,1fr)_6.5rem_auto]">
        <div className="min-w-0 max-md:col-span-2">
          <p className="font-medium leading-snug">{headline(f)}</p>
          <p className="mt-0.5 text-[0.8125rem] text-faint">
            {f.ref} · {period(f)}
          </p>
        </div>
        <Status color={s.color}>{s.label}</Status>
        <Link href={`/violations/${f.number}`} className="link whitespace-nowrap text-right font-medium" aria-label={`Evidence for ${f.ref}`}>
          Evidence
        </Link>
      </div>
      {f.hold.length > 0 && f.standing !== "counted" && (
        <ul className="note mt-2.5 space-y-1.5">
          {f.hold.map((h) => (
            <li key={h.code} className="text-[0.8125rem] leading-relaxed">
              <strong className="font-semibold">{HOLD_LABELS[h.code]}.</strong> <span className="text-dim">{holdSentence(h)}</span>
            </li>
          ))}
        </ul>
      )}
      {f.standingBy && (
        <p className="mt-2 text-[0.8125rem] text-dim">
          {f.standing === "counted" ? "Checked and counted" : "Set aside"} by <strong className="font-semibold text-text">{f.standingBy}</strong>
          {f.standingAt ? `, ${dateTime(f.standingAt)}` : ""}
          {f.standingNote ? `: “${f.standingNote}”` : ""}
        </p>
      )}
      {mayRule && !closed && f.standing === "held" && (
        <form action={ruleOn} className="mt-3 grid items-end gap-2 sm:grid-cols-[1fr_auto_auto]">
          <input type="hidden" name="finding" value={f.number} />
          <input type="hidden" name="case" value={caseNumber} />
          <label className="block">
            <span className="label">What you checked for {f.ref}</span>
            <input name="note" required maxLength={300} placeholder="What you checked, in a line" className="field mt-1.5" />
          </label>
          <button name="to" value="counted" className="btn">
            It stands: count it
          </button>
          <button name="to" value="set_aside" className="btn">
            Set aside
          </button>
        </form>
      )}
      {mayRule && !closed && f.standing === "counted" && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[0.8125rem] font-medium text-dim hover:text-text">Set this finding aside</summary>
          <form action={ruleOn} className="mt-2 grid items-end gap-2 sm:grid-cols-[1fr_auto]">
            <input type="hidden" name="finding" value={f.number} />
            <input type="hidden" name="case" value={caseNumber} />
            <label className="block">
              <span className="label">Why {f.ref} should not count</span>
              <input name="note" required maxLength={300} placeholder="Why it should not count" className="field mt-1.5" />
            </label>
            <button name="to" value="set_aside" className="btn">
              Set aside
            </button>
          </form>
        </details>
      )}
    </li>
  );
}

/** A note in the history: one line, with the rest a click away when there is more. */
function Detail({ note }: { note: string }) {
  const firstLine = note.split("\n")[0]!.trim();
  if (!note.includes("\n") && note.length <= 140) return <p className="mt-1 text-dim">{note}</p>;
  return (
    <details className="group mt-1 text-dim">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">
          {firstLine.length > 110 ? `${firstLine.slice(0, 110).trimEnd()}…` : firstLine} <span className="link whitespace-nowrap font-medium text-text">Read it all</span>
        </span>
        <span className="link hidden font-medium text-text group-open:inline">Show less</span>
      </summary>
      <p className="mt-1 whitespace-pre-line leading-relaxed">{note}</p>
    </details>
  );
}

export default async function CasePage({ params, searchParams }: Props) {
  const [person, { number: raw }, flash] = await Promise.all([currentPerson(), params, searchParams]);
  const number = /^\d{1,9}$/.test(raw) ? Number(raw) : Number.NaN;
  if (Number.isNaN(number)) notFound();

  const c = await attempt(() => caseDetail(person, number));
  if (c instanceof Refused) return <Refusal person={person} permission={c.permission} />;
  if (c === null) notFound();

  const now = present();
  const s = CASE_STATUSES[c.status];
  const isOperator = person.role === "operator";
  const mayAct = can(person.role, "violations.change");
  const mayEscalate = can(person.role, "violations.escalate");
  const due = clock(c, now, isOperator);
  const next = stepInfo(c.nextStep);
  const replyBy = plainDay(workingDaysAfter(now, RESPONSE_WORKING_DAYS));
  const notice = [...c.events].reverse().find((e) => e.kind === "notice");
  const lastFromOperator = [...c.events].reverse().find((e) => e.fromOperator);
  // Held first for staff, because they are the ones that need a decision.
  const order = { held: 0, counted: 1, set_aside: 2 } as const;
  const findings = [...c.findings].sort((a, b) => order[a.standing] - order[b.standing] || a.periodStart - b.periodStart);
  const draft = `${caseTitle(c.kind, c.operatorName)} in the ${weekLabel(c.week).replace(/^Week/, "week")}: ${count(c.counted)} finding${c.counted === 1 ? "" : "s"}, each listed in this case with its evidence.

This is step ${next.step} on the escalation ladder for this rule. ${next.consequence}

Please put this right and tell the city what was done by ${replyBy}. If you believe a finding is wrong, dispute the notice and say which finding and why.`;

  // What has to happen next, and whose move it is, said once at the top of the page.
  const staff = mayAct ? "Your move" : "With the compliance analyst";
  const move: { what: string; who: string } = isOperator
    ? c.status === "notified"
      ? c.replied
        ? { what: "The city checks your reply, then closes the case or writes back.", who: "With the city" }
        : { what: "Reply to the city, or dispute the notice.", who: "Your move" }
      : c.status === "disputed"
        ? { what: "The city decides your dispute: it upholds the notice or withdraws it.", who: "With the city" }
        : c.status === "resolved"
          ? { what: "Nothing. The case is closed.", who: "No one's move" }
          : { what: "Nothing is needed from you.", who: "With the city" }
    : c.status === "held"
      ? { what: "Check the held findings, then count each one or set it aside.", who: staff }
      : c.status === "open"
        ? next.needsProgramManager && !mayEscalate
          ? { what: `Record the notice at step ${next.step}. It puts the permit at risk, so only the program manager can.`, who: "With the program manager" }
          : { what: `Tell ${c.operatorName}: record the notice at step ${next.step}.`, who: staff }
        : c.status === "notified"
          ? c.replied
            ? { what: "Read the operator's reply, then close the case or write back.", who: staff }
            : due?.urgent
              ? { what: "No reply came by the reply date. Follow up.", who: staff }
              : { what: "Reply to the notice.", who: `With ${c.operatorName}` }
          : c.status === "disputed"
            ? { what: "Decide the dispute: uphold the notice or withdraw it.", who: staff }
            : { what: "Nothing. The case is closed.", who: "No one's move" };
  const cell = "border-line px-5 py-4 max-lg:border-b max-lg:last:border-b-0 sm:max-lg:odd:border-r sm:max-lg:[&:nth-last-child(2)]:border-b-0 lg:border-r lg:last:border-r-0";

  return (
    <main className="mx-auto w-full max-w-[84rem] space-y-8 px-4 py-8 lg:px-8 lg:py-11">
      <PageHead
        title={caseTitle(c.kind, c.operatorName)}
        above={
          <>
            <Link href="/cases" className="link">
              {isOperator ? "All notices" : "All cases"}
            </Link>{" "}
            · Case {c.ref}
          </>
        }
      >
        <Operator slug={c.operator} name={c.operatorName} className="align-baseline text-text" />
        <span aria-hidden="true"> · </span>
        {ruleLabel(c.kind)}, {weekLabel(c.week).replace(/^Week/, "week")}. <strong>{findingsLine(c, isOperator)}.</strong>
      </PageHead>

      <dl className="panel grid overflow-hidden sm:grid-cols-2 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className={cell}>
          <dt className="label">State</dt>
          <dd className="mt-1 text-[0.9375rem]">
            <Status color={s.color}>{s.label}</Status>
          </dd>
          <dd className="mt-1 text-[0.8125rem] text-dim">{isOperator ? OPERATOR_HINTS[c.status] ?? s.hint : s.hint}.</dd>
        </div>
        <div className={cell}>
          <dt className="label">Next action</dt>
          <dd className="mt-1 text-[0.9375rem] font-semibold leading-snug">{move.what}</dd>
          <dd className="mt-1 text-[0.8125rem] text-dim">{move.who}</dd>
        </div>
        <div className={cell}>
          <dt className="label">Deadline</dt>
          {due ? (
            <dd className="mt-1 text-[0.9375rem] font-semibold leading-snug" style={{ color: due.color === "var(--color-dim)" ? undefined : due.color }}>
              {due.text}
            </dd>
          ) : (
            <dd className="mt-1 text-[0.9375rem] font-semibold leading-snug">{c.status === "open" && !isOperator ? `None yet. A notice today would be due a reply ${replyBy}` : "None running"}</dd>
          )}
          <dd className="mt-1 text-[0.8125rem] text-dim">
            {c.status === "resolved"
              ? `${c.outcome ? OUTCOMES[c.outcome] : "Closed"}${c.statusChangedAt ? `, ${dateTime(c.statusChangedAt)}` : ""}.`
              : c.notifiedAt
                ? `Notice recorded ${dateTime(c.notifiedAt)}.`
                : "No notice has been recorded."}
          </dd>
        </div>
        <div className={cell}>
          <dt className="label">Escalation step</dt>
          <dd className={`mt-1 text-[0.9375rem] font-semibold leading-snug ${(c.step ?? 0) >= 4 ? "text-poor" : ""}`}>{c.step !== null ? stepLabel(c.step) : "No notice recorded"}</dd>
          <dd className="mt-1 text-[0.8125rem] text-dim">
            {c.step !== null ? stepInfo(c.step).consequence : `${c.status === "resolved" ? "One would have been" : "One recorded now would be"} ${stepLabel(c.nextStep).replace(/^Step/, "step")}.`}
          </dd>
        </div>
      </dl>

      {flash.done && DONE[flash.done] && (
        <div className="flash text-good" role="status">
          <p>{DONE[flash.done]}</p>
        </div>
      )}
      {flash.problem && (
        <div className="flash text-poor" role="alert">
          <p>{flash.problem}</p>
        </div>
      )}
      {flash.refused && (
        <div className="flash text-poor" role="alert">
          <p>This seat may not do that. The attempt has been recorded in the audit log.</p>
        </div>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="min-w-0 space-y-6">
          <Ladder c={c} forOperator={isOperator} />

          <section id="findings" className="panel scroll-mt-4 px-6 pb-3 pt-5">
            <h2 className="heading">
              Findings in this case
              <small>{isOperator ? `${count(c.findings.length)} put to you` : `${count(c.counted)} counted · ${count(c.held)} held · ${count(c.setAside)} set aside`}</small>
            </h2>
            {!isOperator && c.held > 0 && (
              <p className="note mt-3 text-[0.8125rem] leading-relaxed text-dim">
                <strong className="font-semibold text-text">{count(c.held)} held.</strong> The rule engine found {c.held === 1 ? "this" : "these"} but the data behind {c.held === 1 ? "it is" : "them is"} not firm enough to put to an operator. Open the
                evidence, then count {c.held === 1 ? "it" : "each one"} or set it aside. A held finding is never sent.
              </p>
            )}
            {findings.length === 0 ? (
              <p className="py-3 text-dim">No findings are attached to this case.</p>
            ) : (
              <ul className={!isOperator && c.held > 0 ? "mt-1" : ""}>
                {findings.map((f) => (
                  <FindingRow key={f.number} f={f} caseNumber={c.number} mayRule={mayAct} closed={c.status === "resolved"} />
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-6">
          {isOperator ? (
            <>
              <Action title="What the city has told you">
                {notice?.note ? <Quote note={notice.note} by={notice.actorName} at={notice.at} /> : <p className="text-dim">The notice carried no message.{notice ? ` ${notice.actorName}, ${dateTime(notice.at)}.` : ""}</p>}
                {c.step !== null && (
                  <p className="leading-relaxed">
                    <strong className="font-semibold">Step {c.step} of 4.</strong> <span className="text-dim">{stepInfo(c.step).consequence}</span>
                  </p>
                )}
              </Action>
              {c.status === "notified" ? (
                <Action title={c.replied ? "You have replied. The city is checking it" : `Your move: reply by ${c.dueAt ? plainDay(dueDate(c.dueAt)) : "the date given"}`}>
                  <NoteForm number={c.number} action="reply" label={c.replied ? "Add to your reply" : "What was done to put it right"} button="Send reply to the city" signal placeholder="For example: the vehicles were collected on Tuesday and the overnight crew now checks this block." />
                  <More summary="Dispute this notice instead">
                    <p className="mb-3 text-[0.8125rem] leading-relaxed text-dim">Use this if a finding is wrong. Say which finding and why. The reply date stops, and the city has five working days to uphold or withdraw the notice.</p>
                    <NoteForm number={c.number} action="dispute" label="Which finding is wrong, and why" button="File dispute" />
                  </More>
                </Action>
              ) : c.status === "disputed" ? (
                <Action title="Disputed: the city decides next">
                  <p className="leading-relaxed text-dim">
                    Your dispute is with the city, which must uphold or withdraw the notice{c.dueAt ? ` by ${plainDay(dueDate(c.dueAt))}` : ""}. Nothing is needed from you until then.
                  </p>
                </Action>
              ) : (
                <Action title="Closed">
                  <p className="leading-relaxed text-dim">
                    {c.outcome ? `${OUTCOMES[c.outcome]}.` : "This case is closed."} {c.outcome === "withdrawn" ? "It does not count against you on the ladder." : "Nothing more is needed."}
                  </p>
                </Action>
              )}
            </>
          ) : !mayAct ? (
            <Action title="Acting on this case">
              <p className="leading-relaxed text-dim">This seat can read cases and their evidence. Notices, decisions and closures are recorded by the compliance analyst or the program manager.</p>
            </Action>
          ) : c.status === "held" ? (
            <Action title="Your move: check the held findings">
              <p className="leading-relaxed text-dim">
                Every finding here is waiting on a check of the data, so there is nothing firm to put to {c.operatorName}. Count a finding and the case moves to <strong className="font-semibold text-text">To notify</strong>.
              </p>
              <More summary="Close the case without a notice">
                <NoteForm number={c.number} action="close" label="Why it is being closed" button="Close without notice" placeholder="For example: all findings fall in the hours the operator's feed was down." />
              </More>
            </Action>
          ) : c.status === "open" ? (
            <Action title={next.needsProgramManager && !mayEscalate ? "The program manager's move: tell the operator" : "Your move: tell the operator"}>
              {next.needsProgramManager && !mayEscalate ? (
                <div className="note leading-relaxed">
                  <Status color="var(--color-poor)">Program manager only</Status>
                  <p className="mt-1">
                    A notice on this case would be <strong className="font-semibold">step {next.step}: {next.label.toLowerCase()}</strong>. That puts the permit at risk, so only the program manager can record it. They have been alerted that this case is waiting.
                  </p>
                </div>
              ) : (
                <>
                  <p className="leading-relaxed">
                    This notice will be <strong className={`font-semibold ${next.step >= 4 ? "text-poor" : ""}`}>{stepLabel(next.step)}</strong>. Reply due <strong className="font-semibold">{replyBy}</strong>.
                  </p>
                  <NoteForm number={c.number} action="notice" label={`Notice to ${c.operatorName}`} button={`Record notice at step ${next.step}`} signal value={draft} />
                  <p className="text-[0.8125rem] leading-relaxed text-dim">
                    Recording the notice shows this case, your message and the evidence for the {count(c.counted)} counted finding{c.counted === 1 ? "" : "s"} to {c.operatorName}, and sets a reply date of {replyBy}, five
                    working days from today. Held findings are not shown. The email it would send goes to the demonstration outbox.
                  </p>
                </>
              )}
              <More summary="Close the case without a notice">
                <NoteForm number={c.number} action="close" label="Why no notice is needed" button="Close without notice" placeholder="For example: already corrected before a notice was needed." />
              </More>
            </Action>
          ) : c.status === "notified" ? (
            <Action title={c.replied ? "Your move: read the reply, then close or write back" : due?.urgent ? "Your move: no reply came. Follow up" : `Waiting on ${c.operatorName}`}>
              {c.replied && lastFromOperator?.note ? (
                <Quote note={lastFromOperator.note} by={lastFromOperator.actorName} at={lastFromOperator.at} />
              ) : (
                <p className="leading-relaxed text-dim">
                  {c.operatorName} was notified {c.notifiedAt ? dateTime(c.notifiedAt) : ""}
                  {c.dueAt ? ` and has until ${plainDay(dueDate(c.dueAt))} to reply` : ""}. The case stays here until a member of staff closes it.
                </p>
              )}
              {c.replied || !due?.urgent ? (
                <>
                  <NoteForm number={c.number} action="resolve" label="How it was put right" button="Close as put right" signal={c.replied} placeholder="For example: operator confirmed the vehicles were collected; checked on the map." />
                  <More summary="Write to the operator again">
                    <NoteForm number={c.number} action="follow_up" label={`Message to ${c.operatorName}`} button="Send and set a new reply date" />
                  </More>
                </>
              ) : (
                <>
                  <NoteForm number={c.number} action="follow_up" label={`Message to ${c.operatorName}`} button="Send and set a new reply date" signal value={`The city has had no reply to this notice, which was due ${c.dueAt ? plainDay(dueDate(c.dueAt)) : "earlier"}. Please reply by ${replyBy}.`} />
                  <More summary="Close as put right">
                    <NoteForm number={c.number} action="resolve" label="How it was put right" button="Close as put right" />
                  </More>
                </>
              )}
              <More summary="Withdraw the notice">
                <p className="mb-3 text-[0.8125rem] leading-relaxed text-dim">Use this when the notice should not have been sent. A withdrawn notice does not count on the ladder.</p>
                <NoteForm number={c.number} action="withdraw" label="Why it is being withdrawn" button="Withdraw notice" />
              </More>
            </Action>
          ) : c.status === "disputed" ? (
            <Action title={`Your move: decide the dispute${c.dueAt ? ` by ${plainDay(dueDate(c.dueAt))}` : ""}`}>
              {lastFromOperator?.note && <Quote note={lastFromOperator.note} by={lastFromOperator.actorName} at={lastFromOperator.at} />}
              <p className="text-[0.8125rem] leading-relaxed text-dim">Check the finding they name against its evidence. If one finding is wrong but the rest stand, set that finding aside and uphold the notice.</p>
              <NoteForm number={c.number} action="uphold" label="The notice stands, because" button="Uphold the notice" signal />
              <NoteForm number={c.number} action="withdraw" label="The operator is right, because" button="Withdraw the notice" />
            </Action>
          ) : (
            <Action title={`Closed${c.outcome ? `: ${OUTCOMES[c.outcome].toLowerCase()}` : ""}`}>
              <p className="leading-relaxed text-dim">
                Closed by <strong className="font-semibold text-text">{c.statusChangedBy}</strong>
                {c.statusChangedAt ? ` on ${dateTime(c.statusChangedAt)}` : ""}.{" "}
                {c.step === null ? "No notice was recorded, so it does not count on the ladder." : c.outcome === "withdrawn" ? "The notice was withdrawn, so it does not count on the ladder." : "The notice stays on the operator's record."}
              </p>
              <More summary="Reopen this case">
                <NoteForm number={c.number} action="reopen" label="Why it is being reopened" button="Reopen" />
              </More>
            </Action>
          )}

          <section className="panel px-6 pb-6 pt-5">
            <h2 className="heading">
              {isOperator ? "Between you and the city" : "History"}
              {c.events.length > 1 && <small>oldest first</small>}
            </h2>
            {c.events.length === 0 ? (
              <p className="mt-3 text-dim">Nothing has been recorded yet.</p>
            ) : (
              <ol className="ml-1 mt-4 space-y-4 border-l border-line">
                {c.events.map((e, i) => (
                  <li key={i} className="relative pl-5">
                    <span aria-hidden="true" className="absolute -left-[0.28125rem] top-[0.3125rem] h-2 w-2 rounded-full" style={{ background: EVENTS[e.kind].color }} />
                    <p className="text-[0.8125rem] text-faint">{dateTime(e.at)}</p>
                    <p className="font-medium">{EVENTS[e.kind].label}</p>
                    <p className="text-[0.8125rem] text-dim">
                      {e.actorName}
                      {e.fromOperator ? " (operator)" : ""}
                    </p>
                    {e.note && e.kind !== "opened" && e.kind !== "finding" && <Detail note={e.note} />}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
