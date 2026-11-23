import { cookies } from "next/headers";
import Link from "next/link";
import { can, ROLE_LABELS, type Permission } from "@mm/core/access";
import { CITY_NAME } from "@mm/core/city";
import { DemoReset } from "@/components/DemoReset";
import { Nav } from "@/components/Nav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ViewAs } from "@/components/ViewAs";
import { Wordmark } from "@/components/Wordmark";
import { THEME_COOKIE, type Theme } from "@/lib/theme";
import { unreadCount } from "@/server/alerts";
import { demoResetEnabled } from "@/server/demo";
import { currentPerson, listPeople } from "@/server/session";

type Section = { href: string; label: string; needs?: Permission; operatorLabel?: string; operatorOnly?: boolean };
const SECTIONS: Section[] = [
  { href: "/", label: "Home" },
  { href: "/cases", label: "Cases", operatorLabel: "Notices", needs: "violations.view" },
  // City staff read each operator's standing on their own home screen; the operator has this page for it.
  { href: "/compliance", label: "Compliance", needs: "violations.view", operatorOnly: true },
  { href: "/map", label: "Live map", needs: "map.view" },
  { href: "/zones", label: "Zones", needs: "zones.view" },
  { href: "/rules", label: "Rules", needs: "rules.view" },
  { href: "/health", label: "Data health", needs: "health.view" },
  { href: "/invoices", label: "Invoices", needs: "invoices.view" },
  { href: "/fees", label: "Fee schedule", needs: "fees.view" },
  { href: "/reports", label: "Reports", needs: "reports.view" },
  { href: "/audit", label: "Audit log", needs: "audit.view" },
  { href: "/access", label: "Seats", needs: "access.view" },
  { href: "/outbox", label: "Outbox" },
];

// The staff console: the demonstration strip with the seat picker, the header with its tabs, and the page under it.
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const [person, people, jar] = await Promise.all([currentPerson(), listPeople(), cookies()]);
  const theme: Theme = jar.get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";
  // The council liaison reads the scorecard and is sent nothing, so that seat has no alerts.
  const alerted = person.role !== "read_only";
  const unread = alerted ? await unreadCount(person) : 0;
  const sections = SECTIONS.filter((s) => (!s.needs || can(person.role, s.needs)) && (!s.operatorOnly || person.role === "operator") && (s.href !== "/outbox" || alerted || can(person.role, "outbox.view")));
  const items = sections.map((s) => ({ href: s.href, label: person.role === "operator" && s.operatorLabel ? s.operatorLabel : s.label }));
  if (alerted) items.splice(1, 0, { href: "/alerts", label: "Alerts", unread } as (typeof items)[number]);
  return (
    <>
        <div className="no-print text-[0.8125rem] text-text" style={{ background: "var(--strip)" }}>
          <div className="mx-auto flex w-full max-w-[100rem] flex-wrap items-center justify-between gap-x-6 gap-y-1.5 px-4 py-2 lg:px-8">
            <p className="leading-snug">
              <a href="https://chopmedia.vercel.app/#city-micromobility" className="mr-3 whitespace-nowrap font-semibold underline underline-offset-4">
                ← All demos
              </a>{" "}
              <strong className="font-semibold">Demonstration.</strong> <span className="text-dim">Simulated data from three fictional operators. Not used by, or affiliated with, any city.</span>
              {demoResetEnabled() && (
                <>
                  {" "}
                  <span className="text-dim">Other visitors see what you change here, until it is put back each night.</span> <DemoReset />
                </>
              )}
            </p>
            <ViewAs current={person.userId} people={people.map((p) => ({ userId: p.userId, name: p.name, title: p.title, roleLabel: ROLE_LABELS[p.role] }))} />
          </div>
        </div>
        <div className="frame flex min-h-0 flex-1 flex-col">
          <header style={{ background: "var(--side)" }} className="no-print relative z-10 shrink-0 border-b border-line shadow-[var(--shadow-sm)] backdrop-blur">
            <div className="mx-auto w-full max-w-[100rem] px-4 lg:px-8">
              <div className="flex items-center gap-x-5 pb-1 pt-3">
                <Link href="/" className="flex min-w-0 shrink-0 items-center gap-2.5">
                  <Wordmark />
                  <span className="min-w-0">
                    <span className="block font-display text-[1.0625rem] font-semibold leading-tight tracking-[-0.02em]">Micromobility Monitor</span>
                    <span className="block text-[0.8125rem] leading-tight text-faint">{CITY_NAME}, simulated</span>
                  </span>
                </Link>
                <div className="ml-auto flex min-w-0 items-center gap-x-4">
                  <Link href="/open-data" className="link whitespace-nowrap text-[0.875rem] text-dim max-md:hidden">
                    Public open-data page
                  </Link>
                  <p className="min-w-0 border-l border-line pl-4 text-right leading-tight max-sm:hidden">
                    <span className="block truncate font-semibold">{person.name}</span>
                    <span className="block truncate text-[0.8125rem] text-faint">{ROLE_LABELS[person.role]}</span>
                  </p>
                  <ThemeToggle initial={theme} />
                </div>
              </div>
              <Nav items={items} />
            </div>
          </header>
          <div className="frame-main flex min-h-0 min-w-0 flex-1 flex-col lg:overflow-y-auto">{children}</div>
        </div>
    </>
  );
}
