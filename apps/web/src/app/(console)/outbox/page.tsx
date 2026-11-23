import type { Metadata } from "next";
import { can } from "@mm/core/access";
import { Choice, PageHead } from "@/components/PageHead";
import { Refusal } from "@/components/Refusal";
import { count, dateTime } from "@/lib/format";
import { outbox } from "@/server/alerts";
import { attempt } from "@/server/attempt";
import { Refused } from "@/server/guard";
import { currentPerson } from "@/server/session";

export const metadata: Metadata = { title: "Outbox" };

const KINDS = { alert: "Alert", digest: "Daily digest", report: "Report" } as const;

export default async function OutboxPage({ searchParams }: { searchParams: Promise<{ of?: string }> }) {
  const [person, search] = await Promise.all([currentPerson(), searchParams]);
  const mayAll = can(person.role, "outbox.view");
  // Asking for everyone's mail without the permission is refused and logged, not quietly narrowed.
  const everyone = search.of === "all" || (mayAll && search.of !== "mine");
  const mail = await attempt(() => outbox(person, everyone));
  if (mail instanceof Refused) return <Refusal person={person} permission={mail.permission} />;

  return (
    <main className="mx-auto w-full max-w-[60rem] space-y-8 px-4 py-8 lg:px-8 lg:py-11">
      <PageHead
        above="Demonstration outbox"
        title={everyone ? "Every email the system would have sent" : "Emails this seat would have received"}
        aside={mayAll ? <Choice current={everyone ? "all" : "mine"} options={[{ key: "all", label: "Everyone's", href: "/outbox" }, { key: "mine", label: "Mine", href: "/outbox?of=mine" }]} /> : undefined}
      >
        No email leaves this demonstration. Each message that a live system would hand to a mail server is written here instead, exactly as it would be sent: urgent alerts one at a time, operators&rsquo;
        notices gathered into one digest a day, and the monthly report on the first of each month.
      </PageHead>

      <section className="panel px-6 pb-3 pt-5">
        <h2 className="heading">
          {mail.length === 0 ? "Messages" : `${count(mail.length)} message${mail.length === 1 ? "" : "s"}`}
          {mail.length > 0 && <small>newest first; none of them was sent</small>}
        </h2>
        {mail.length === 0 ? (
          <p className="py-3 text-dim">Nothing has been written to the outbox{everyone ? "" : " for this seat"} yet.</p>
        ) : (
          <ul>
            {mail.map((m) => (
              <li key={m.id} className="border-b border-line last:border-b-0">
                <details className="group">
                  <summary className="-mx-1.5 grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 rounded-[3px] px-1.5 py-3 transition-colors hover:bg-raise md:grid-cols-[minmax(0,1fr)_7rem_9.5rem_3rem] [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0 max-md:col-span-2">
                      <span className="font-medium leading-snug">{m.subject}</span>
                      <span className="block break-words text-[0.8125rem] text-dim">
                        To <span className="font-medium text-text">{m.toName}</span> &lt;{m.toEmail}&gt;
                      </span>
                    </span>
                    <span className="text-[0.8125rem] text-dim max-md:hidden">{KINDS[m.kind] ?? KINDS.alert}</span>
                    <span className="text-[0.8125rem] text-faint md:text-right">
                      <span className="md:hidden">{KINDS[m.kind] ?? KINDS.alert} · </span>
                      {dateTime(m.at)}
                    </span>
                    <span className="link text-right text-[0.8125rem] font-medium">
                      <span className="group-open:hidden">Read</span>
                      <span className="hidden group-open:inline">Close</span>
                    </span>
                  </summary>
                  <div className="note mb-4 mt-1 text-[0.8125rem] leading-relaxed text-dim">
                    <pre className="whitespace-pre-wrap break-words font-sans">{m.body}</pre>
                    {m.attachment && (
                      <p className="mt-3 border-t border-line pt-3">
                        Attached:{" "}
                        <a className="link font-medium text-text" href={m.attachment.href}>
                          {m.attachment.name}
                        </a>{" "}
                        <span className="text-faint">(PDF, drawn from the records when opened)</span>
                      </p>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
