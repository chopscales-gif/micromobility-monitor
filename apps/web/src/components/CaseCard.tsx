import Link from "next/link";
import { CASE_STATUSES, clock, OUTCOMES, ruleLabel, stepLabel, weekLabel } from "@/lib/cases";
import { ago, count } from "@/lib/format";
import type { CaseRow } from "@/server/cases";
import { Operator, Status } from "./Mark";

/** What is in a case, in a line: how many findings stand, how many are waiting on a check. */
export function findingsLine(c: Pick<CaseRow, "counted" | "held" | "setAside">, forOperator = false): string {
  const parts = forOperator || c.counted > 0 || c.held === 0 ? [`${count(c.counted)} finding${c.counted === 1 ? "" : "s"}${forOperator ? "" : " counted"}`] : [];
  if (!forOperator && c.held > 0) parts.push(`${count(c.held)} held for a data check`);
  if (!forOperator && c.setAside > 0) parts.push(`${count(c.setAside)} set aside`);
  return parts.join(" · ");
}

/**
 * One case as a line in a list: its reference, who, which rule and week, where it stands, and by when.
 * The surrounding list item must be a `@container`: in a narrow panel the reference sits under the operator
 * and the deadline under the status, so the rule and week keep a readable line; a wide panel gets five columns.
 */
export function CaseCard({ c, now, forOperator = false }: { c: CaseRow; now: number; forOperator?: boolean }) {
  const s = CASE_STATUSES[c.status];
  const due = clock(c, now, forOperator);
  const step = c.step ?? (c.status === "open" ? c.nextStep : null);
  return (
    <Link href={`/cases/${c.number}`} className="row grid-cols-[1fr_auto] md:grid-cols-[10.5rem_minmax(0,1fr)_11.5rem] md:grid-rows-[auto_1fr] @4xl:grid-rows-none @4xl:grid-cols-[5rem_11.5rem_minmax(0,1fr)_7.5rem_13rem]">
      <span className="text-faint max-md:order-2 max-md:text-right md:col-start-1 md:row-start-2 md:self-start md:text-[0.8125rem] @4xl:col-start-auto @4xl:row-start-auto @4xl:text-[length:inherit]">{c.ref}</span>
      <Operator slug={c.operator} name={c.operatorName} className="max-md:order-1 md:col-start-1 md:row-start-1 @4xl:col-start-auto @4xl:row-start-auto" />
      <span className="min-w-0 max-md:order-3 max-md:col-span-2 md:col-start-2 md:row-span-2 md:row-start-1 @4xl:col-start-auto @4xl:row-span-1 @4xl:row-start-auto">
        <span className="font-medium">{ruleLabel(c.kind)}</span>
        <span className="text-dim">, {weekLabel(c.week)}</span>
        <span className="block text-[0.8125rem] text-dim">
          {findingsLine(c, forOperator)}
          {step !== null && (
            <>
              {" · "}
              {c.step === null ? "a notice now would be " : ""}
              <span className={step >= 4 ? "font-semibold text-poor" : "text-text"}>{stepLabel(step)}</span>
            </>
          )}
        </span>
      </span>
      <Status color={s.color} className="max-md:order-4 md:col-start-3 md:row-start-1 @4xl:col-start-auto @4xl:row-start-auto">
        {s.label}
      </Status>
      <span className="max-md:order-5 max-md:text-right md:col-start-3 md:row-start-2 md:self-start md:text-[0.8125rem] @4xl:col-start-auto @4xl:row-start-auto @4xl:text-right @4xl:text-[length:inherit]">
        {due ? (
          <span className={due.urgent ? "font-semibold" : ""} style={{ color: due.color }}>
            {due.text}
          </span>
        ) : (
          <span className="text-dim">
            {c.status === "resolved" ? `${c.outcome ? OUTCOMES[c.outcome] : "Closed"}${c.statusChangedAt ? ` ${ago(c.statusChangedAt, now)}` : ""}` : c.status === "held" ? "Waiting on a data check" : `Opened ${ago(c.openedAt, now)}`}
          </span>
        )}
      </span>
    </Link>
  );
}
