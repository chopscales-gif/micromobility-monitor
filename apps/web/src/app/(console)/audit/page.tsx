import type { Metadata } from "next";
import { ROLE_LABELS } from "@mm/core/access";
import { Operator, Status } from "@/components/Mark";
import { Choice, PageHead } from "@/components/PageHead";
import { Refusal } from "@/components/Refusal";
import { particulars, sentence } from "@/lib/audit";
import { count, dateTime } from "@/lib/format";
import { OPERATORS } from "@/lib/meaning";
import { attempt } from "@/server/attempt";
import { auditTrail } from "@/server/audit";
import { Refused } from "@/server/guard";
import { currentPerson } from "@/server/session";

export const metadata: Metadata = { title: "Audit log" };

const FILTERS = [
  { key: "all", label: "Everything", href: "/audit" },
  { key: "refused", label: "Refused", href: "/audit?only=refused" },
  { key: "export", label: "Exports", href: "/audit?only=export" },
  { key: "change", label: "Changes", href: "/audit?only=change" },
];
const KIND: Record<string, string> = { read: "Viewed", export: "Exported", change: "Changed" };

/** An entry carries the operator's name only; its mark is keyed by the first word of that name. */
const slugOf = (name: string): string | null => {
  const slug = name.split(" ")[0]?.toLowerCase() ?? "";
  return slug in OPERATORS ? slug : null;
};

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ only?: string }> }) {
  const person = await currentPerson();
  const asked = (await searchParams).only;
  const only = asked === "refused" || asked === "export" || asked === "change" ? asked : null;
  const trail = await attempt(() => auditTrail(person, { only }));
  if (trail instanceof Refused) return <Refusal person={person} permission={trail.permission} />;

  return (
    <main className="mx-auto w-full max-w-[84rem] space-y-6 px-4 py-8 lg:px-8">
      <PageHead title="Who looked at what, and what they were refused" aside={<Choice options={FILTERS} current={only ?? "all"} />}>
        Every read, export and change of operator data is written here before the data is returned, including the attempts that were turned away. Entries cannot be edited or removed from the
        application. Repeated automatic refreshes of the same screen are folded into one entry with a count.
      </PageHead>

      <dl className="panel grid divide-line overflow-hidden max-sm:divide-y sm:grid-cols-3 sm:divide-x">
        {(
          [
            ["Entries on record", count(trail.total), undefined],
            ["Refused", count(trail.refused), trail.refused > 0 ? "var(--color-poor)" : undefined],
            ["Shown below", count(trail.entries.length), undefined],
          ] as const
        ).map(([label, value, color]) => (
          <div key={label} className="px-5 py-4">
            <dt className="label">{label}</dt>
            <dd className="figure mt-1 text-[1.75rem]" style={{ color }}>
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <section className="panel px-5 pb-2 pt-4">
        <h2 className="heading">
          Entries
          <small>newest first</small>
        </h2>
        {trail.entries.length === 0 ? (
          <p className="py-3 text-dim">Nothing of this kind on record yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="grid-table stack sm:min-w-[58rem] [&_tbody_tr:last-child_td]:border-b-0">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Kind</th>
                  <th>What</th>
                  <th>Operator&rsquo;s data</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {trail.entries.map((e) => {
                  const more = particulars(e);
                  const slug = e.operatorName ? slugOf(e.operatorName) : null;
                  return (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap text-dim">{dateTime(e.at)}</td>
                      <td className="whitespace-nowrap" data-label="Who">
                        <div>
                          <span className="font-medium">{e.userName}</span>
                          <span className="block text-[0.8125rem] text-dim">{ROLE_LABELS[e.role as keyof typeof ROLE_LABELS] ?? e.role}</span>
                        </div>
                      </td>
                      <td className={`whitespace-nowrap ${e.action === "read" ? "text-dim" : "font-medium"}`} data-label="Kind">{KIND[e.action] ?? e.action}</td>
                      <td className="sm:min-w-[16rem]">
                        {sentence(e)}
                        {more && <span className="block text-[0.8125rem] text-dim">{more}</span>}
                      </td>
                      <td className="whitespace-nowrap" data-label="Operator&rsquo;s data">
                        {e.operatorName === null ? <span className="text-dim">All operators</span> : slug ? <Operator slug={slug} name={e.operatorName} className="!font-normal" /> : e.operatorName}
                      </td>
                      <td data-label="Outcome">{e.allowed ? <span className="text-dim">Allowed</span> : <Status color="var(--color-poor)">Refused</Status>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
