"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; unread?: number };

export function Nav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Sections" className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto max-lg:order-3 max-lg:-mx-1.5 max-lg:basis-full max-lg:pb-1.5 max-lg:pr-8 max-lg:[mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] lg:flex-none lg:flex-col lg:overflow-visible">
      {items.map((item) => {
        const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            aria-label={item.unread ? `${item.label}, ${item.unread} unread` : undefined}
            className={`flex items-center justify-between gap-3 whitespace-nowrap rounded-md px-2.5 py-1.5 transition-colors ${
              active ? "bg-raise font-semibold text-text" : "text-dim hover:bg-raise hover:text-text"
            }`}
          >
            {item.label}
            {item.unread ? <span className="rounded-full bg-text px-1.5 text-[0.6875rem] font-semibold leading-[1.125rem] text-ink">{item.unread > 99 ? "99+" : item.unread}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
