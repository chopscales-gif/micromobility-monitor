import type { Metadata } from "next";
import Link from "next/link";
import { can } from "@mm/core/access";
import { DECISION_WORKING_DAYS, LADDER, LADDER_WINDOW_MONTHS, RESPONSE_WORKING_DAYS } from "@mm/core/cases";
import { RULE_KINDS, RULES, type RuleKind } from "@mm/core/rules";
import { Status } from "@/components/Mark";
import { PageHead } from "@/components/PageHead";
import { Refusal } from "@/components/Refusal";
import { count, dateTime } from "@/lib/format";
import { CASE_STATUSES } from "@/lib/cases";
import { METHODS, ruleSentence } from "@/lib/violations";
import { attempt } from "@/server/attempt";
import { Refused } from "@/server/guard";
import { ruleList } from "@/server/rules";
import { currentPerson } from "@/server/session";
import { save } from "./actions";

export const metadata: Metadata = { title: "Rules" };

type Props = { searchParams: Promise<{ saved?: string; problem?: string; refused?: string }> };

export default async function RulesPage({ searchParams }: Props) {
  const [person, flash] = await Promise.all([currentPerson(), searchParams]);
  const rules = await attempt(() => ruleList(person));
  if (rules instanceof Refused) return <Refusal person={person} permission={rules.permission} />;
  const mayChange = can(person.role, "rules.change");
  const isOperator = person.role === "operator";
  const saved = RULE_KINDS.includes(flash.saved as RuleKind) ? (flash.saved as RuleKind) : null;

  return (
    <main className="mx-auto w-full max-w-[84rem] space-y-8 px-4 py-8 lg:px-8 lg:py-11">
      <PageHead title="The rules operators are held to">
        {isOperator ? (
          <>The rules in your permit, with the settings in force and how each one is measured from the data you send.</>
        ) : (
          <>
            Five rules, each checked against the operators&rsquo; own feeds every ten minutes. A breach is filed, with its evidence, into that operator&rsquo;s case for the week.{" "}
            {mayChange ? "Changing a rule takes effect from that moment: days and weeks already over keep the findings they have." : "Only the program manager can change them."}
          </>
        )}
      </PageHead>

      {saved && (
        <div className="flash text-good">
          <p>{RULES[saved].label} saved. The new settings apply from now.</p>
        </div>
      )}
      {flash.problem && (
        <div className="flash text-poor">
          <p>{flash.problem}</p>
        </div>
      )}
      {flash.refused && (
        <div className="flash text-poor">
          <p>This seat may not change the rules. The attempt has been recorded in the audit log.</p>
        </div>
      )}

      <section className="panel scroll-mt-4 px-6 pb-5 pt-5" id="ladder">
        <h2 className="heading">
          What happens when a rule is broken
          <small>the escalation ladder</small>
        </h2>
        <p className="mt-3 max-w-3xl leading-relaxed">
          Each week in which {isOperator ? "you break" : "an operator breaks"} a rule becomes one case. A notice on that case lands one step higher than the last, counting notices on the same rule over the past{" "}
          {LADDER_WINDOW_MONTHS} months. A notice the city withdraws does not count. {isOperator ? "You have" : "The operator has"} {RESPONSE_WORKING_DAYS} working days to reply, and can dispute a notice instead; the city then has{" "}
          {DECISION_WORKING_DAYS} working days to uphold or withdraw it.
        </p>
        <ol className="mt-3 border-t border-line">
          {LADDER.map((rung) => (
            <li key={rung.step} className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5 border-b border-line py-2.5 md:grid-cols-[1.5rem_13rem_minmax(0,1fr)]">
              <span className="text-faint" aria-label={`Step ${rung.step}`}>
                {rung.step}.
              </span>
              <span className={`font-semibold ${rung.step >= 4 ? "text-poor" : ""}`}>{rung.label}</span>
              <span className="text-[0.8125rem] leading-relaxed text-dim max-md:col-start-2">
                {rung.consequence}
                {rung.needsProgramManager ? " Only the program manager can record this notice." : ""}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-3 max-w-3xl text-[0.8125rem] leading-relaxed text-dim">
          A finding only counts when the data firmly supports it. One that sits inside GPS error, or was made while the operator&rsquo;s feed was losing records, is held for a member of staff to check and is never sent
          as it stands. In this demonstration a fine is recorded on the notice; it is not added to the monthly invoice.
        </p>
      </section>

      {rules.map((r) => (
        <section key={r.kind} id={r.kind} className="panel scroll-mt-4 px-6 pb-6 pt-5">
          <h2 className="heading">
            {RULES[r.kind].label}
            <Status color={r.enabled ? "var(--color-good)" : "var(--color-removed)"} className="aside !font-semibold">
              {r.enabled ? "In force" : "Switched off"}
            </Status>
          </h2>
          <div className={`mt-3 grid gap-x-8 gap-y-5 ${mayChange ? "lg:grid-cols-[minmax(0,1fr)_21rem]" : ""}`}>
            <div className="min-w-0">
              <p className="max-w-3xl leading-relaxed">{ruleSentence(r.kind, r.params)}</p>
              <p className="mt-2 max-w-3xl text-[0.8125rem] leading-relaxed text-dim">
                <span className="font-semibold text-text">How it is measured.</span> {METHODS[r.kind]}
              </p>
              <dl className="mt-4 grid gap-x-8 border-t border-line sm:grid-cols-2 xl:grid-cols-3">
                {RULES[r.kind].params.map((spec) => (
                  <div key={spec.key} className="border-b border-line py-2.5">
                    <dt className="label">{spec.label}</dt>
                    <dd className="mt-0.5 font-semibold">
                      {spec.unit === "h" ? `${r.params[spec.key]}:00` : r.params[spec.key]} {spec.unit !== "h" && <span className="text-[0.8125rem] font-normal text-dim">{spec.unit}</span>}
                    </dd>
                  </div>
                ))}
                {!isOperator && (
                  <div className="col-span-full border-b border-line py-2.5">
                    <dt className="label">Cases being worked</dt>
                    <dd className="mt-0.5 flex flex-wrap gap-x-5 gap-y-1">
                      {(["open", "notified", "disputed", "held"] as const).map((k) => (
                        <Link key={k} href={`/cases?rule=${r.kind}&status=${k}`} className={`link ${r[k] > 0 ? "font-semibold" : ""}`} style={{ color: r[k] > 0 ? CASE_STATUSES[k].color : "var(--color-faint)" }}>
                          {count(r[k])} {CASE_STATUSES[k].label.toLowerCase()}
                        </Link>
                      ))}
                    </dd>
                  </div>
                )}
              </dl>
              {r.adopted && (
                <p className="mt-3 text-[0.8125rem] text-dim">
                  These settings apply from {dateTime(r.effectiveFrom)}. Last changed by {r.updatedBy}.
                </p>
              )}
            </div>

            {mayChange && (
              <form action={save} className="space-y-3 border-line max-lg:border-t max-lg:pt-4 lg:border-l lg:pl-8">
                <input type="hidden" name="kind" value={r.kind} />
                <p className="font-semibold">Change this rule</p>
                {RULES[r.kind].params.map((spec) => (
                  <label key={spec.key} className="block">
                    <span className="label">
                      {spec.label}
                      {spec.unit === "h" ? "" : ` (${spec.min} to ${spec.max} ${spec.unit})`}
                    </span>
                    <input name={spec.key} type="number" inputMode="decimal" required min={spec.min} max={spec.max} step={spec.whole ? 1 : 0.1} defaultValue={r.params[spec.key]} className="field mt-1" />
                  </label>
                ))}
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="enabled" defaultChecked={r.enabled} className="h-4 w-4" />
                  In force
                </label>
                <button type="submit" className="btn btn-signal w-full">
                  Save {RULES[r.kind].label.toLowerCase()}
                </button>
              </form>
            )}
          </div>
        </section>
      ))}

      <section className="panel px-6 pb-5 pt-5">
        <h2 className="heading">What the rules do not cover</h2>
        <ul className="mt-3 max-w-3xl list-disc space-y-1.5 pl-5 leading-relaxed text-dim">
          <li>Required-parking zones are drawn on the map, but no rule checks them yet.</li>
          <li>Findings rest on what each operator reports. A vehicle an operator never reports cannot be seen here; the data health page shows how complete each feed is.</li>
          <li>Switching a rule off stops new findings. Findings already filed stay in the queue until staff resolve them.</li>
        </ul>
      </section>
    </main>
  );
}
