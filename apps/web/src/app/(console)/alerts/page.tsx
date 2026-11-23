import type { Metadata } from "next";
import Link from "next/link";
import { ROLE_LABELS, type Role } from "@mm/core/access";
import { Status } from "@/components/Mark";
import { PageHead } from "@/components/PageHead";
import { count, dateTime } from "@/lib/format";
import { myAlerts } from "@/server/alerts";
import { currentPerson } from "@/server/session";
import { open, readAll } from "./actions";

export const metadata: Metadata = { title: "Alerts" };

/** What each seat is alerted about. Fixed by the seat: there is no preferences page. */
const SENT: Record<Role, string> = {
  analyst: "A new case, an operator's reply or dispute, a reply date coming up or missed, and findings held because a feed is in trouble.",
  program_manager: "A case reaching the permit-review step, a feed that stops answering, an invoice that does not reconcile, and changes to rules, zones or fees.",
  finance: "An invoice ready to sign off, and one where the operator's report disagrees with the city's count.",
  admin: "A feed that stops answering, and a day on which a feed performed badly.",
  read_only: "Nothing. This seat is sent no alerts.",
  operator: "A notice from the city, a decision on your dispute, a reply date coming up or missed, trouble with your feed, and an invoice issued to you. These arrive by email as one digest a day, not one message each.",
};

export default async function AlertsPage() {
  const person = await currentPerson();
  const alerts = await myAlerts(person);
  const unread = alerts.filter((a) => !a.read).length;
  return (
    <main className="mx-auto w-full max-w-[60rem] space-y-6 px-4 py-8 lg:px-8">
      <PageHead
        above={`${ROLE_LABELS[person.role]} seat`}
        title={unread === 0 ? "Nothing unread" : `${count(unread)} unread alert${unread === 1 ? "" : "s"}`}
        aside={
          unread > 0 ? (
            <form action={readAll}>
              <button className="btn">Mark all as read</button>
            </form>
          ) : undefined
        }
      >
        <strong>What this seat is alerted about.</strong> {SENT[person.role]}
      </PageHead>

      <section className="panel px-5 pb-2 pt-4">
        <h2 className="heading">
          Alerts
          <small>{alerts.length === 0 ? "none yet" : `${count(alerts.length)} in all, newest first`}</small>
        </h2>
        {alerts.length === 0 ? (
          <p className="py-3 text-dim">No alerts have been raised for this seat.</p>
        ) : (
          <ul>
            {alerts.map((a) => (
              <li key={a.id} className="border-b border-line last:border-b-0">
                {/* Opening an alert marks it read and goes to what it is about. */}
                <form action={open}>
                  <input type="hidden" name="id" value={a.id} />
                  <button className="group -mx-1.5 grid w-[calc(100%+0.75rem)] cursor-pointer grid-cols-[0.5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 rounded-[3px] px-1.5 py-3 text-left transition-colors hover:bg-raise md:grid-cols-[0.5rem_minmax(0,1fr)_auto]">
                    <span className="self-start pt-[0.4rem]">
                      {a.read ? <span className="sr-only">Read</span> : <span className="block h-2 w-2 rounded-full bg-text" role="img" aria-label="Unread" />}
                    </span>
                    <span className="min-w-0">
                      {a.urgent && (
                        <Status color="var(--color-poor)" className="mr-2.5">
                          Urgent
                        </Status>
                      )}
                      <span className={`leading-snug ${a.read ? "text-dim" : "font-semibold"}`}>{a.title}</span>
                      <span className="mt-0.5 block text-[0.8125rem] leading-relaxed text-dim">{a.body}</span>
                    </span>
                    <span className="col-start-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[0.8125rem] text-faint md:col-start-3 md:flex-col md:items-end">
                      <span className="whitespace-nowrap">{dateTime(a.at)}</span>
                      {a.emailedAt !== null && <span>also in the outbox as email</span>}
                      <span className="link font-medium text-text group-hover:decoration-current">Open</span>
                    </span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-[0.8125rem] leading-relaxed text-faint">
        Demonstration: no email is sent. Every message this seat would have received is in the{" "}
        <Link href="/outbox" className="link text-dim">
          outbox
        </Link>
        .
      </p>
    </main>
  );
}
