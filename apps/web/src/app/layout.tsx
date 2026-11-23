import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import { cookies } from "next/headers";
import { THEME_COOKIE, type Theme } from "@/lib/theme";
import "./globals.css";

const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree" });

export const metadata: Metadata = {
  title: { default: "Micromobility Monitor (demonstration)", template: "%s · Micromobility Monitor (demonstration)" },
  description: "A demonstration of a city-side platform for monitoring shared scooters and bikes and auditing operator fees. Simulated data, fictional operators.",
  robots: { index: false },
};
export const viewport: Viewport = { themeColor: "#15181c" };
export const dynamic = "force-dynamic";

// The document itself. The staff console and the public pages each bring their own frame:
// see (console)/layout.tsx and (public)/layout.tsx.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme: Theme = (await cookies()).get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";
  return (
    <html lang="en" data-theme={theme} className={figtree.variable}>
      <body className="flex min-h-dvh flex-col lg:h-dvh">{children}</body>
    </html>
  );
}
