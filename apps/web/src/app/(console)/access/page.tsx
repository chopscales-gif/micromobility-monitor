import type { Metadata } from "next";
import { can, PERMISSION_LABELS, PERMISSIONS, ROLE_LABELS, ROLE_PURPOSES, ROLES } from "@mm/core/access";
import { Operator } from "@/components/Mark";
import { PageHead } from "@/components/PageHead";
import { Refusal } from "@/components/Refusal";
import { OPERATORS } from "@/lib/meaning";
import { seats } from "@/server/access";
import { attempt } from "@/server/attempt";
import { Refused } from "@/server/guard";
import { currentPerson } from "@/server/session";

export const metadata: Metadata = { title: "Seats" };

/** A person's row carries the operator's name only; its mark is keyed by the first word of that name. */
const slugOf = (name: string): string | null => {
  const slug = name.split(" ")[0]?.toLowerCase() ?? "";
  return slug in OPERATORS ? slug : null;
};

export default async function AccessPage() {
  const person = await currentPerson();
  const people = await attempt(() => seats(person));
  if (people instanceof Refused) return <Refusal person={person} permission={people.permission} />;

  return (
    <main className="mx-auto w-full max-w-[84rem] space-y-8 px-4 py-8 lg:px-8 lg:py-11">
      <PageHead title="Who holds which seat, and what each seat can do">
        Six seats, each with a fixed set of permissions that the server checks on every request. In this demonstration a seat is chosen with the picker at the top of the page; the platform is built so that a
        city&rsquo;s own single sign-on (OpenID Connect) takes its place, and nothing else changes.
      </PageHead>

      <section className="panel px-6 pb-3 pt-5">
        <h2 className="heading">
          Seats and who holds them
          <small>
            {people.length} {people.length === 1 ? "person" : "people"}
          </small>
        </h2>
        <ul>
          {ROLES.map((role) => {
            const holders = people.filter((p) => p.role === role);
            return (
              <li key={role} className="grid gap-x-8 gap-y-2 border-b border-line py-4 last:border-b-0 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
                <div>
                  <h3 className="font-semibold">
                    {ROLE_LABELS[role]}
                    {role === person.role && <span className="ml-2 text-[0.8125rem] font-normal text-faint">your seat</span>}
                  </h3>
                  <p className="mt-1 text-[0.8125rem] leading-relaxed text-dim">{ROLE_PURPOSES[role]}</p>
                </div>
                <ul>
                  {holders.length === 0 && <li className="text-dim">No one holds this seat.</li>}
                  {holders.map((p) => {
                    const slug = p.operatorName ? slugOf(p.operatorName) : null;
                    return (
                      <li key={p.userId} className="row grid-cols-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] max-lg:first:pt-1 lg:first:pt-0">
                        <span className="font-medium">{p.name}</span>
                        <span className="min-w-0 text-[0.8125rem] text-dim">
                          {p.title}
                          {slug && p.operatorName && (
                            <>
                              {" · "}
                              <Operator slug={slug} name={p.operatorName} className="!font-normal" />
                            </>
                          )}
                        </span>
                        <span className="break-all text-[0.8125rem] text-faint">{p.email}</span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="panel px-6 pb-5 pt-5">
        <h2 className="heading">What each seat may do</h2>
        <div className="overflow-x-auto">
          <table className="grid-table min-w-[48rem]">
            <thead>
              <tr>
                <th>Permission</th>
                {ROLES.map((role) => (
                  <th key={role} className={role === person.role ? "!font-semibold !text-text" : ""}>
                    {ROLE_LABELS[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((permission) => (
                <tr key={permission}>
                  <td>{PERMISSION_LABELS[permission]}</td>
                  {ROLES.map((role) => (
                    <td key={role}>{can(role, permission) ? <span className="font-semibold text-good">Yes</span> : <span className="text-faint">No</span>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[0.8125rem] leading-relaxed text-dim">An operator seat is further confined to its own operator&rsquo;s data on every one of these. Every refusal is written to the audit log.</p>
      </section>
    </main>
  );
}
