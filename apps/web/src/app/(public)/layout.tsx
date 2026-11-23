import { cookies } from "next/headers";
import Link from "next/link";
import { CITY_NAME } from "@mm/core/city";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Wordmark } from "@/components/Wordmark";
import { THEME_COOKIE, type Theme } from "@/lib/theme";

// The public side: no seat, no sidebar, nothing that needs a sign-in.
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const theme: Theme = (await cookies()).get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";
  return (
    <>
      <div className="no-print text-[0.8125rem] text-text" style={{ background: "var(--strip)" }}>
        <p className="mx-auto w-full max-w-[76rem] px-4 py-2 leading-snug lg:px-8">
          <a href="https://chopmedia.vercel.app/#city-micromobility" className="mr-3 whitespace-nowrap font-semibold underline underline-offset-4">
            ← All demos
          </a>{" "}
          <strong className="font-semibold">Demonstration.</strong> <span className="text-dim">Simulated data from three fictional operators. Not published by, or affiliated with, any city.</span>
        </p>
      </div>
      <div className="frame-main flex min-h-0 flex-1 flex-col lg:overflow-y-auto">
        <header style={{ background: "var(--side)" }} className="no-print sticky top-0 z-30 border-b border-line shadow-[var(--shadow-sm)] backdrop-blur">
          <div className="mx-auto flex w-full max-w-[76rem] flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3 lg:px-8">
            <Link href="/open-data" className="flex min-w-0 items-center gap-2.5">
              <Wordmark />
              <span className="min-w-0">
                <span className="block font-display text-[1.0625rem] font-semibold leading-tight tracking-[-0.02em]">Shared mobility open data</span>
                <span className="block text-[0.8125rem] leading-tight text-faint">{CITY_NAME}, simulated</span>
              </span>
            </Link>
            <div className="flex items-center gap-3">
              <Link href="/" className="btn !py-1.5 text-[0.875rem]">
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
