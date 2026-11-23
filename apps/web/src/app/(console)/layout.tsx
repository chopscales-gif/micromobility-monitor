import { cookies } from "next/headers";
import Link from "next/link";
import { can, ROLE_LABELS, type Permission } from "@mm/core/access";
import { CITY_NAME } from "@mm/core/city";
import { DemoReset } from "@/components/DemoReset";
import { Nav } from "@/components/Nav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ViewAs } from "@/components/ViewAs";
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

// The staff console: the demonstration strip with the seat picker, the sidebar, and the page beside it.
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
        <div className="no-print text-[0.8125rem] text-white" style={{ background: "var(--strip)" }}>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 px-4 py-1.5">
            <p className="leading-snug">
              <strong className="font-semibold">Demonstration.</strong> <span className="text-white/75">Simulated data from three fictional operators. Not used by, or affiliated with, any city.</span>
              {demoResetEnabled() && (
                <>
                  {" "}
                  <span className="text-white/75">Other visitors see what you change here, until it is put back each night.</span> <DemoReset />
                </>
              )}
            </p>
            <ViewAs current={person.userId} people={people.map((p) => ({ userId: p.userId, name: p.name, title: p.title, roleLabel: ROLE_LABELS[p.role] }))} />
          </div>
        </div>
        <div className="frame flex min-h-0 flex-1 flex-col lg:flex-row">
          <header style={{ background: "var(--side)" }} className="no-print relative z-10 flex shrink-0 shadow-[var(--shadow-sm)] items-center gap-3 max-lg:flex-wrap max-lg:gap-y-0 border-b border-line px-4 lg:w-56 lg:flex-col lg:items-stretch lg:gap-6 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-3 lg:py-5">
            <Link href="/" className="shrink-0 max-lg:py-2 lg:px-2.5">
              <span className="block text-[0.9375rem] font-semibold leading-tight tracking-tight">Micromobility Monitor</span>
              <span className="block text-[0.8125rem] text-faint max-lg:hidden">{CITY_NAME}, simulated</span>
            </Link>
            <Nav items={items} />
            <div className="max-lg:ml-auto lg:mt-auto lg:border-t lg:border-line lg:pt-3">
              <p className="px-2.5 pb-2 max-lg:hidden">
                <span className="block font-medium">{person.name}</span>
                <span className="block text-[0.8125rem] text-faint">{ROLE_LABELS[person.role]}</span>
              </p>
              <Link href="/open-data" className="link block px-2.5 pb-2 text-[0.8125rem] text-dim max-lg:hidden">
                Public open-data page
              </Link>
              <ThemeToggle initial={theme} />
            </div>
          </header>
          <div className="frame-main flex min-h-0 min-w-0 flex-1 flex-col lg:overflow-y-auto">{children}</div>
        </div>
    </>
  );
}
