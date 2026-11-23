"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; unread?: number };

export function Nav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Sections" className="-mx-2.5 flex min-w-0 gap-0.5 overflow-x-auto pr-8 [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] [scrollbar-width:none] min-[100rem]:pr-0 min-[100rem]:[mask-image:none]">
      {items.map((item) => {
        const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            aria-label={item.unread ? `${item.label}, ${item.unread} unread` : undefined}
            className={`relative flex items-center gap-2 whitespace-nowrap px-2.5 pb-3 pt-2.5 text-[0.9375rem] transition-colors after:absolute after:inset-x-2.5 after:bottom-0 after:h-[3px] after:rounded-t-full ${
              active ? "font-semibold text-text after:bg-brand" : "text-dim hover:text-text hover:after:bg-rule"
            }`}
          >
            {item.label}
            {item.unread ? <span className="rounded-full bg-signal px-1.5 text-[0.6875rem] font-semibold leading-[1.125rem] text-on-signal">{item.unread > 99 ? "99+" : item.unread}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
