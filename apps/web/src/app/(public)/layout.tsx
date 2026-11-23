import { cookies } from "next/headers";
import Link from "next/link";
import { CITY_NAME } from "@mm/core/city";
import { ThemeToggle } from "@/components/ThemeToggle";
import { THEME_COOKIE, type Theme } from "@/lib/theme";

// The public side: no seat, no sidebar, nothing that needs a sign-in.
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const theme: Theme = (await cookies()).get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";
  return (
    <>
      <div className="no-print text-[0.8125rem] text-white" style={{ background: "var(--strip)" }}>
        <p className="px-4 py-1.5 leading-snug">
          <strong className="font-semibold">Demonstration.</strong> <span className="text-white/75">Simulated data from three fictional operators. Not published by, or affiliated with, any city.</span>
        </p>
      </div>
      <div className="frame-main flex min-h-0 flex-1 flex-col lg:overflow-y-auto">
        <header style={{ background: "var(--side)" }} className="no-print border-b border-line shadow-[var(--shadow-sm)]">
          <div className="mx-auto flex w-full max-w-[72rem] flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3 lg:px-8">
            <Link href="/open-data" className="min-w-0">
              <span className="block text-[0.9375rem] font-semibold leading-tight tracking-tight">Shared mobility open data</span>
              <span className="block text-[0.8125rem] text-faint">{CITY_NAME}, simulated</span>
            </Link>
            <div className="flex items-center gap-2">
              <Link href="/" className="link text-[0.8125rem] text-dim">
                Staff console
              </Link>
              <ThemeToggle initial={theme} />
            </div>
          </div>
        </header>
        {children}
      </div>
    </>
  );
}
