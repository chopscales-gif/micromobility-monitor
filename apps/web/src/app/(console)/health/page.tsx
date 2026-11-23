import type { Metadata } from "next";
import { SLOW_MS } from "@mm/core/health";
import { Operator, Status } from "@/components/Mark";
import { Choice, PageHead } from "@/components/PageHead";
import { Refusal } from "@/components/Refusal";
import { count, dateTime, duration, percent, plainDate } from "@/lib/format";
import { feedLabel, GRADES } from "@/lib/meaning";
import { attempt } from "@/server/attempt";
import { Refused } from "@/server/guard";
import { dataHealth, type OperatorHealth } from "@/server/health";
import { currentPerson } from "@/server/session";

export const metadata: Metadata = { title: "Data health" };

const MEASURED: Record<string, string> = {
  uptime: "of requests answered",
  latency: `of answers within ${SLOW_MS / 1000} seconds`,
  records: "of records valid and complete",
  freshness: "of live answers within their stated lifetime",
};
const gradeColor = (score: number | null) => (score === null ? GRADES.no_data.color : score >= 90 ? GRADES.good.color : score >= 70 ? GRADES.fair.color : GRADES.poor.color);
const OUTCOMES: Record<string, string> = { ok: "Answered", http_error: "Server error", timeout: "Timed out", invalid_envelope: "Unreadable answer" };

function OperatorCard({ o, days }: { o: OperatorHealth; days: number }) {
  const grade = GRADES[o.health.grade];
  const flaws = o.counts.invalidRecords + o.counts.incompleteRecords;
  return (
    <section className="panel px-5 pb-4 pt-4" aria-labelledby={`${o.slug}-name`}>
      <h2 id={`${o.slug}-name`} className="heading">
        <Operator slug={o.slug} name={o.name} className="!font-semibold" />
        <Status color={grade.color} className="ml-auto">
          {o.health.score !== null ? `${o.health.score} · ` : ""}
          {grade.label}
        </Status>
      </h2>
      <p className="mt-2.5 text-[0.8125rem] text-dim">Score out of 100, last {days === 1 ? "24 hours" : `${days} days`}.</p>

      <dl className="mt-1">
        {o.health.components.map((c) => (
          <div key={c.key} className="row grid-cols-[minmax(0,1fr)_auto]">
            <dt className="font-medium">{c.label}</dt>
            <dd className="font-semibold" style={{ color: gradeColor(c.score) }}>
              {percent(c.rate)}
            </dd>
            <dd className="col-span-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-raise" role="presentation">
                <div className="h-full rounded-full" style={{ width: `${c.score ?? 0}%`, background: gradeColor(c.score) }} />
              </div>
              <p className="mt-1.5 text-[0.8125rem] text-faint">
                {MEASURED[c.key]} · scores zero at {percent(c.floor, 0)} · {c.weight}% of the score
              </p>
            </dd>
          </div>
        ))}
      </dl>

      <div className="border-t border-line pt-3">
        <p className="label">Score by day, last 14 days</p>
        <div className="mt-2 flex h-14 items-end gap-[3px]">
          {o.daily.map((d) => (
            <div key={d.date} className="flex h-full flex-1 items-end" title={`${plainDate(d.date)}: ${d.score ?? "no data"}`}>
              <div className="w-full rounded-t-sm" style={{ height: `${Math.max(6, d.score ?? 0)}%`, background: gradeColor(d.score) }} />
            </div>
          ))}
        </div>
        {o.daily.length > 0 && (
          <p className="mt-1 flex justify-between text-[0.8125rem] text-faint">
            <span>{plainDate(o.daily[0]!.date)}</span>
            <span>{plainDate(o.daily.at(-1)!.date)}</span>
          </p>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-x-4 border-t border-line pt-3">
        {[
          ["Requests", count(o.counts.polls)],
          ["Unanswered", count(o.counts.failedPolls)],
          ["Flawed records", count(flaws)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="label">{label}</dt>
            <dd className="font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function OperatorDetail({ o }: { o: OperatorHealth }) {
  return (
    <section className="space-y-6" aria-labelledby={`${o.slug}-detail`}>
      <div className="panel px-5 pb-2 pt-4">
        <h2 id={`${o.slug}-detail`} className="heading">
          <Operator slug={o.slug} name={o.name} className="!font-semibold" />
          <small>feed by feed</small>
        </h2>
        <div className="overflow-x-auto">
          <table className="grid-table min-w-[52rem]">
            <caption className="sr-only">{o.name}, feed by feed</caption>
            <thead>
              <tr>
                <th>Feed</th>
                <th className="r">Requests</th>
                <th className="r">Unanswered</th>
                <th className="r">Typical wait</th>
                <th className="r">Records</th>
                <th className="r">Failed schema</th>
                <th className="r">Missing fields</th>
                <th>Last request</th>
              </tr>
            </thead>
            <tbody>
              {o.feeds.map((f) => (
                <tr key={f.feed}>
                  <td>
                    <span className="font-medium">{feedLabel(f.feed)}</span>
                    <span className="block text-[0.8125rem] text-faint">{f.checkedAgainst ? `Checked against the ${f.checkedAgainst}` : "Not schema-checked"}</span>
                  </td>
                  <td className="r">{count(f.polls)}</td>
                  <td className={`r ${f.failed > 0 ? "font-semibold text-poor" : "text-faint"}`}>{count(f.failed)}</td>
                  <td className={`r ${f.medianMs !== null && f.medianMs > SLOW_MS ? "font-semibold text-fair" : ""}`}>{f.medianMs === null ? "–" : `${count(f.medianMs)} ms`}</td>
                  <td className="r">{count(f.records)}</td>
                  <td className={`r ${f.invalid > 0 ? "font-semibold text-poor" : "text-faint"}`}>{count(f.invalid)}</td>
                  <td className={`r ${f.incomplete > 0 ? "font-semibold text-fair" : "text-faint"}`}>{count(f.incomplete)}</td>
                  <td className="whitespace-nowrap">
                    <span className={f.lastOutcome === "ok" ? "" : "font-semibold text-poor"}>{OUTCOMES[f.lastOutcome] ?? f.lastOutcome}</span>
                    <span className="block text-[0.8125rem] text-faint">{dateTime(f.lastPolled)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="panel min-w-0 px-5 pb-2 pt-4">
          <h3 className="heading">
            Schema errors, grouped by cause <small>{o.name}</small>
          </h3>
          {o.errors.length === 0 ? (
            <p className="py-3 text-dim">Every record passed its schema in this period.</p>
          ) : (
            <ul>
              {o.errors.map((e) => (
                <li key={`${e.feed}|${e.path}|${e.keyword}|${e.message}`} className="border-b border-line py-3 last:border-b-0">
                  <div className="flex items-baseline justify-between gap-4">
                    <div className="min-w-0">
                      <p className="break-words">
                        <strong className="font-semibold text-poor">{e.path || "(whole record)"}</strong> <span className="font-medium">{e.message}</span>
                      </p>
                      <p className="mt-0.5 text-[0.8125rem] text-dim">
                        {feedLabel(e.feed)} · last seen {dateTime(e.lastSeen)}
                      </p>
                    </div>
                    <p className="shrink-0 whitespace-nowrap text-right">
                      <strong className="font-semibold text-poor">{count(e.count)}</strong> <span className="text-[0.8125rem] text-faint">records</span>
                    </p>
                  </div>
                  {e.sample != null && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[0.8125rem] text-dim hover:text-text">Show one rejected record{e.sampleId ? ` (${e.sampleId})` : ""}</summary>
                      <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-raise p-3 text-[0.8125rem] leading-relaxed text-dim">{JSON.stringify(e.sample, null, 2)}</pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="panel px-5 pb-2 pt-4">
          <h3 className="heading">
            Outages <small>{o.name}</small>
          </h3>
          {o.outages.length === 0 ? (
            <p className="py-3 text-dim">No unanswered requests in this period.</p>
          ) : (
            <ul>
              {o.outages.slice(0, 8).map((x) => (
                <li key={x.from} className="border-b border-line py-2.5 last:border-b-0">
                  <p className="font-medium">{dateTime(x.from)}</p>
                  <p className="text-[0.8125rem] text-dim">
                    {x.to === x.from ? "one request" : `for ${duration(x.to - x.from)}`} · <span className="text-poor">{count(x.polls)} unanswered</span>
                  </p>
                </li>
              ))}
              {o.outages.length > 8 && <li className="py-2.5 text-[0.8125rem] text-faint">and {o.outages.length - 8} earlier</li>}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const person = await currentPerson();
  const { days } = await searchParams;
  const result = await attempt(() => dataHealth(person, Number(days ?? 7)));
  if (result instanceof Refused) return <Refusal person={person} permission={result.permission} />;

  return (
    <main className="mx-auto w-full max-w-[84rem] space-y-6 px-4 py-8 lg:px-8">
      <PageHead
        title="Can the city trust what each operator is sending?"
        aside={<Choice current={String(result.days)} options={[1, 7, 14].map((d) => ({ key: String(d), href: `/health?days=${d}`, label: d === 1 ? "24 hours" : `${d} days` }))} />}
      >
        Every request to an operator&rsquo;s feeds is logged, and every record is checked against the published schema: GBFS 3.0 for public feeds, and MDS 2.0 with the 2.1 changes applied for
        agency feeds (MDS 2.1 has no official machine-readable schema). The score is built from four measurements, shown with the arithmetic.
      </PageHead>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        {result.operators.map((o) => (
          <OperatorCard key={o.slug} o={o} days={result.days} />
        ))}
      </div>
      {result.operators.map((o) => (
        <OperatorDetail key={o.slug} o={o} />
      ))}
    </main>
  );
}
